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
}

/**
 * Run every flagging check against a measurement result and return the
 * first issue encountered. Order matters — we surface the most likely
 * user intent first.
 */
export function detectIssues(ctx: FlagContext): MeasurementIssue | null {
  const checks = [
    checkNoEntities,
    checkSiblingLayers,
    checkUnexpectedTypes,
    checkMixedClosed,
    checkShortSegments,
  ];
  for (const check of checks) {
    const issue = check(ctx);
    if (issue) return issue;
  }
  return null;
}

function checkNoEntities(ctx: FlagContext): MeasurementIssue | null {
  if (ctx.summary.total_entities === 0) {
    return {
      type: 'no_entities',
      message: `No entities found on layer "${ctx.item.layer}". The layer name may be off or the geometry may live on a different layer.`,
      suggestedOptions: [
        'Search similar layer names',
        'Set quantity manually',
        'Skip this item',
      ],
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
