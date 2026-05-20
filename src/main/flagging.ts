/**
 * Heuristics that decide whether a measurement result needs human review.
 *
 * Each check either returns `null` (all good) or a MeasurementIssue with a
 * human-readable message and suggested resolution options that the UI can
 * render as quick-pick buttons.
 */

import type {
  EntityRecord,
  EntitySummary,
  MeasurementIssue,
  PayItem,
} from '@shared/types';
import { OBJECT_TYPE_ALIASES } from '@shared/constants';
import { SHORT_SEGMENT_THRESHOLD_FT } from '@shared/constants';

export interface FlagContext {
  item: PayItem;
  summary: EntitySummary;
  entities: EntityRecord[];
  /** Layer names that also have entities matching the object type. */
  siblingLayers?: string[];
  /**
   * True when auto-diameter is enabled, polylines exist on the layer, and
   * none of them carry a non-zero ConstantWidth. The multi-diameter split
   * handles the "several diameters on one layer" case, so the only
   * remaining auto-diameter ambiguity is widths missing entirely.
   */
  autoDiameterWidthsMissing?: boolean;
  /**
   * True when "Auto-extract from part feature" is enabled for a `pipe`
   * preset, the layer returned AECC pipes, but none of them produced a
   * parseable (diameter, material) tuple from PartSizeName or Description.
   * Drafters can leave parts un-tagged — when they do, we need the user
   * to enter diameter manually.
   */
  autoPartsMissing?: boolean;
  /**
   * Names of user-supplied layers (from `item.layer` / `item.extraLayers`)
   * that returned zero entities. When only some of a multi-layer item's
   * layers are empty, we flag them individually without blocking the
   * partial measurement.
   */
  emptyLayers?: string[];
}

/**
 * Run every flagging check against a measurement result and return the
 * first issue encountered. Order matters — we surface the most likely
 * user intent first.
 */
export function detectIssues(ctx: FlagContext): MeasurementIssue | null {
  const checks = [
    checkNoEntities,
    checkStyleFilteredZero,
    checkSiblingLayers,
    checkUnexpectedTypes,
    checkMixedClosed,
    checkAutoDiameterAmbiguous,
    checkAutoPartsMissing,
    checkStyleSkippedSome,
    checkShortSegments,
  ];
  for (const check of checks) {
    const issue = check(ctx);
    if (issue) return issue;
  }
  return null;
}

function checkNoEntities(ctx: FlagContext): MeasurementIssue | null {
  const allLayers = [
    ctx.item.layer,
    ...(ctx.item.extraLayers ?? []),
  ].filter((s) => s && s.trim());
  // All layers came back empty — same severity as the single-layer case.
  if (ctx.summary.total_entities === 0) {
    const quoted = allLayers.map((l) => `"${l}"`).join(', ');
    const noun = allLayers.length > 1 ? 'layers' : 'layer';
    return {
      type: 'no_entities',
      message:
        allLayers.length === 0
          ? 'No layer specified for this item.'
          : `No entities found on ${noun} ${quoted}. The name${allLayers.length > 1 ? 's' : ''} may be off or the geometry may live on a different layer.`,
      suggestedOptions: [
        'Search similar layer names',
        'Set quantity manually',
        'Skip this item',
      ],
    };
  }
  // Partial empty: some layers had matches, others didn't. Flag the empty
  // ones without blocking the partial measurement.
  if (
    ctx.emptyLayers &&
    ctx.emptyLayers.length > 0 &&
    allLayers.length > 1
  ) {
    const empties = ctx.emptyLayers.map((l) => `"${l}"`).join(', ');
    return {
      type: 'no_entities',
      message: `No entities on ${empties}, but I did find matches on the other layer${allLayers.length - ctx.emptyLayers.length > 1 ? 's' : ''}. Keep it this way, or drop the empty layer${ctx.emptyLayers.length > 1 ? 's' : ''}?`,
      suggestedOptions: [
        'Keep as measured',
        ...ctx.emptyLayers.map((l) => `Drop ${l}`),
        'Set quantity manually',
      ],
      metadata: { emptyLayers: ctx.emptyLayers },
    };
  }
  return null;
}

function checkSiblingLayers(ctx: FlagContext): MeasurementIssue | null {
  if (!ctx.siblingLayers || ctx.siblingLayers.length === 0) return null;
  const others = ctx.siblingLayers.slice(0, 3);
  return {
    type: 'multiple_layers',
    message: `I found matching geometry on "${ctx.item.layer}", but similar entities also live on ${others
      .map((l) => `"${l}"`)
      .join(', ')}. Should I include those or stick with the layer you chose?`,
    suggestedOptions: [
      `Only ${ctx.item.layer}`,
      ...others.map((l) => `Include ${l}`),
      'Set quantity manually',
    ],
    metadata: { siblingLayers: ctx.siblingLayers },
  };
}

function checkUnexpectedTypes(ctx: FlagContext): MeasurementIssue | null {
  const expectedTypes = new Set(OBJECT_TYPE_ALIASES[ctx.item.objectType]);
  const found = Object.keys(ctx.summary.type_counts);
  const unexpected = found.filter((t) => !expectedTypes.has(t));
  if (unexpected.length === 0) return null;
  // Count the mismatched entities.
  const unexpectedCount = unexpected.reduce(
    (sum, t) => sum + (ctx.summary.type_counts[t] ?? 0),
    0,
  );
  const expectedCount = found
    .filter((t) => expectedTypes.has(t))
    .reduce((sum, t) => sum + (ctx.summary.type_counts[t] ?? 0), 0);
  // If the expected type dominates, don't flag.
  if (expectedCount >= unexpectedCount * 4) return null;
  return {
    type: 'unexpected_types',
    message: `You said "${ctx.item.objectType}" for this item, but the layer also has ${unexpectedCount} ${
      unexpected.length === 1 ? unexpected[0] : 'entities of other types'
    }. Should I include them?`,
    suggestedOptions: [
      `Only ${ctx.item.objectType}`,
      'Include all types',
      'Set quantity manually',
    ],
    metadata: { unexpectedTypes: unexpected },
  };
}

function checkMixedClosed(ctx: FlagContext): MeasurementIssue | null {
  if (
    ctx.item.objectType !== 'polyline' &&
    ctx.item.objectType !== 'closedPolyline'
  ) {
    return null;
  }
  const polylines = ctx.entities.filter((e) =>
    e.type.includes('Polyline'),
  );
  if (polylines.length === 0) return null;
  const closedCount = polylines.filter((e) => e.closed === true).length;
  const openCount = polylines.length - closedCount;
  if (closedCount > 0 && openCount > 0) {
    const wanted = ctx.item.objectType === 'closedPolyline' ? 'closed' : 'open';
    return {
      type: 'mixed_closed',
      message: `The layer has ${closedCount} closed and ${openCount} open polylines. You wanted ${wanted} polylines — should I include only those?`,
      suggestedOptions: [
        `Only ${wanted} polylines`,
        'Include all',
        'Set quantity manually',
      ],
      metadata: { closedCount, openCount, wanted },
    };
  }
  return null;
}

function checkAutoDiameterAmbiguous(
  ctx: FlagContext,
): MeasurementIssue | null {
  if (!ctx.autoDiameterWidthsMissing) return null;
  const polylineCount = ctx.entities.filter((e) =>
    e.type.includes('Polyline'),
  ).length;
  if (polylineCount === 0) return null;
  return {
    type: 'ambiguous_diameter',
    message:
      'No polyline widths are set on this layer, so I can\'t infer a pipe diameter. Uncheck "Auto-diameter from polyline width" and enter one manually, or assign global widths in AutoCAD.',
    suggestedOptions: ['Set quantity manually', 'Skip this item'],
  };
}

function checkAutoPartsMissing(ctx: FlagContext): MeasurementIssue | null {
  if (!ctx.autoPartsMissing) return null;
  return {
    type: 'ambiguous_diameter',
    message:
      'I found pipe-network entities but couldn\'t read a diameter or material from any of them. The drafter may not have tagged the parts. Uncheck "Auto-extract from feature" and enter the diameter manually.',
    suggestedOptions: ['Set quantity manually', 'Skip this item'],
  };
}

function checkStyleFilteredZero(ctx: FlagContext): MeasurementIssue | null {
  const kw = ctx.item.styleKeyword?.trim();
  if (!kw) return null;
  // Selection returned entities but the style filter dropped all of them.
  // `total_entities` reflects post-filter count; `skipped_by_style` is the
  // count of entities that were dropped.
  if (ctx.summary.total_entities > 0) return null;
  const skipped = ctx.summary.skipped_by_style ?? 0;
  if (skipped === 0) return null;
  return {
    type: 'style_filtered_zero',
    message: `I found ${skipped} pipe-network entit${skipped === 1 ? 'y' : 'ies'} on "${ctx.item.layer}" but none matched the style keyword "${kw}". Edit the style keyword or clear it to include everything.`,
    suggestedOptions: [
      `Clear style filter`,
      'Set quantity manually',
      'Skip this item',
    ],
    metadata: { skippedByStyle: skipped, styleKeyword: kw },
  };
}

function checkStyleSkippedSome(ctx: FlagContext): MeasurementIssue | null {
  const skipped = ctx.summary.skipped_by_style ?? 0;
  if (skipped === 0) return null;
  // Only mention this when the user has an active style filter AND we have
  // matches. (The all-skipped case is handled by checkStyleFilteredZero.)
  if (!ctx.item.styleKeyword?.trim()) return null;
  if (ctx.summary.total_entities === 0) return null;
  // Don't flag if a tiny number was dropped — that's noise. Only surface
  // when a meaningful share was filtered out.
  if (skipped / Math.max(1, skipped + ctx.summary.total_entities) < 0.25) {
    return null;
  }
  return {
    type: 'style_skipped_some',
    message: `Heads up — I dropped ${skipped} other pipe-network entit${skipped === 1 ? 'y' : 'ies'} on this layer that didn't match style "${ctx.item.styleKeyword}". If they belong to a different pay item, add one with the matching style keyword.`,
    suggestedOptions: ['OK, keep this measurement', 'Set quantity manually'],
    metadata: { skippedByStyle: skipped, styleKeyword: ctx.item.styleKeyword },
  };
}

function checkShortSegments(ctx: FlagContext): MeasurementIssue | null {
  if (ctx.item.measurement !== 'linear') return null;
  const shortSegs = ctx.entities.filter(
    (e) =>
      typeof e.length === 'number' &&
      e.length > 0 &&
      e.length < SHORT_SEGMENT_THRESHOLD_FT,
  );
  if (shortSegs.length === 0) return null;
  // Only flag if short segments are a meaningful fraction of the total.
  if (shortSegs.length / Math.max(1, ctx.entities.length) < 0.15) {
    return null;
  }
  return {
    type: 'artifacts',
    message: `I measured ${shortSegs.length} segments shorter than ${SHORT_SEGMENT_THRESHOLD_FT} ft. These might be drafting artifacts — want me to ignore them?`,
    suggestedOptions: [
      'Ignore short segments',
      'Keep them all',
      'Set quantity manually',
    ],
    metadata: { shortSegmentCount: shortSegs.length },
  };
}
