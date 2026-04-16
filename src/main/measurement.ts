/**
 * Deterministic measurement orchestration.
 *
 * For each pay item, this module calls the AutoCAD tools directly (no LLM),
 * extracts the relevant quantity, runs flagging heuristics, and emits a
 * patch for the renderer to merge into the item's state.
 *
 * The Agent SDK only gets involved during the resolution-chat phase
 * (see `src/main/agent.ts`).
 */

import type {
  MeasurementResult,
  PayItem,
  PayItemUpdate,
} from '@shared/types';
import {
  OBJECT_TYPE_ALIASES,
  DXF_TYPE_NAMES,
  MEASUREMENT_UNITS,
  SQ_FT_PER_SY,
} from '@shared/constants';

import { getEntitiesOnLayer } from './tools/autocad/entities';
import { countEntities } from './tools/autocad/selection';
import { listLayerNames } from './tools/autocad/layers';
import { detectIssues } from './flagging';

/**
 * Measure a single pay item and return the update to apply to its row.
 * Never throws — failures surface through the item's status=error state.
 */
export function measureOne(item: PayItem): PayItemUpdate {
  try {
    const result = measureCore(item);
    return toUpdate(item, result);
  } catch (e) {
    return {
      id: item.id,
      patch: {
        status: 'error',
        errorMessage: (e as Error).message,
      },
    };
  }
}

/**
 * Measure a list of pay items sequentially. Runs in the main process, on
 * the same COM thread — AutoCAD COM is single-threaded, so we can't
 * parallelise this.
 *
 * Yields patches as each item completes so the UI can render progress.
 *
 * Clears the sibling-layer scan cache at the start and end of each batch
 * so it doesn't serve stale results when the user switches drawings.
 */
export function* measureAll(items: PayItem[]): Generator<PayItemUpdate> {
  clearSiblingScanCache();
  try {
    for (const item of items) {
      if (item.status === 'complete') continue;
      yield { id: item.id, patch: { status: 'processing' } };
      yield measureOne(item);
    }
  } finally {
    clearSiblingScanCache();
  }
}

// ---- internals ----

function measureCore(item: PayItem): MeasurementResult {
  const aliases = OBJECT_TYPE_ALIASES[item.objectType];
  const dxfTypes = DXF_TYPE_NAMES[item.objectType];
  const closedFilter =
    item.objectType === 'closedPolyline'
      ? true
      : item.objectType === 'polyline'
        ? false
        : undefined;

  const { summary, entities } = getEntitiesOnLayer({
    layer_name: item.layer,
    dxf_types: dxfTypes,
    object_name_filter: aliases,
    closed_filter: closedFilter,
  });

  // Sibling-layer discovery is expensive (14+ seconds on a 372-layer
  // drawing because every layer enumeration is a ~60ms COM round-trip).
  // Only do it when we have reason to — i.e., when the user's layer
  // returned zero entities. If we found entities on the user's chosen
  // layer, trust the choice. The resolution chat can explore siblings
  // on demand via the `list_layers` MCP tool.
  const siblingLayers =
    summary.total_entities === 0
      ? findSiblingLayers(item, dxfTypes, aliases)
      : [];

  const quantity = computeQuantity(item, summary);
  const issue = detectIssues({ item, summary, entities, siblingLayers });

  if (issue) {
    return {
      success: true,
      quantity,
      unit: MEASUREMENT_UNITS[item.measurement],
      details: summary,
      issues: [issue],
    };
  }

  if (quantity === 0 || quantity === null) {
    return {
      success: true,
      quantity: 0,
      unit: MEASUREMENT_UNITS[item.measurement],
      details: summary,
      issues: [
        {
          type: 'zero_quantity',
          message: `Measurement returned 0 ${MEASUREMENT_UNITS[item.measurement]}. Check the layer name and object type.`,
          suggestedOptions: ['Set quantity manually', 'Skip this item'],
        },
      ],
    };
  }

  return {
    success: true,
    quantity,
    unit: MEASUREMENT_UNITS[item.measurement],
    details: summary,
  };
}

function toUpdate(
  item: PayItem,
  result: MeasurementResult,
): PayItemUpdate {
  if (!result.success) {
    return {
      id: item.id,
      patch: { status: 'error', errorMessage: result.errorMessage },
    };
  }
  if (result.issues && result.issues.length > 0) {
    const issue = result.issues[0];
    return {
      id: item.id,
      patch: {
        status: 'flagged',
        quantity: result.quantity ?? null,
        flagMessage: issue.message,
        flagOptions: issue.suggestedOptions,
      },
    };
  }
  return {
    id: item.id,
    patch: {
      status: 'complete',
      quantity: result.quantity ?? null,
      flagMessage: null,
      flagOptions: null,
    },
  };
}

/**
 * Sum the right dimension out of the summary for this item's measurement type.
 * Respects the AutoCAD ObjectName aliases we used for the query.
 */
function computeQuantity(
  item: PayItem,
  summary: { type_counts: Record<string, number>; total_lengths_by_type?: Record<string, number>; total_areas_by_type?: Record<string, number> },
): number {
  const aliases = OBJECT_TYPE_ALIASES[item.objectType];
  if (item.measurement === 'linear') {
    let total = 0;
    for (const t of aliases) {
      total += summary.total_lengths_by_type?.[t] ?? 0;
    }
    return round2(total);
  }
  if (item.measurement === 'area') {
    let total = 0;
    for (const t of aliases) {
      total += summary.total_areas_by_type?.[t] ?? 0;
    }
    // AutoCAD areas are in square drawing units (square feet for civil work).
    // Convert to square yards.
    return round2(total / SQ_FT_PER_SY);
  }
  if (item.measurement === 'count') {
    let total = 0;
    for (const t of aliases) {
      total += summary.type_counts[t] ?? 0;
    }
    return total;
  }
  return 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Look for other layers whose names suggest they hold the same kind of
 * geometry as the target layer. A sibling is any layer that:
 *   - is not the target layer itself
 *   - shares a name token with the target (e.g. both contain "WATER")
 *   - has at least one entity matching the target's ObjectName aliases
 *
 * Previously this called `getEntitiesOnLayer` per candidate layer, which
 * iterated the full ModelSpace each time — catastrophic on a 2k-entity
 * drawing with 10 similar-named layers. Now we make ONE pass through
 * ModelSpace and build a layer → hasMatchingEntity map. Within the same
 * `measureAll` run we reuse this map via a module-level cache keyed by
 * the active document name.
 */
/**
 * Sibling-layer result cache. Per-batch via `clearSiblingScanCache`.
 */
const siblingCache = new Map<string, string[]>();

/**
 * Layer-name cache — once per measurement batch. Enumerating layers is
 * O(n) COM calls (~60ms each), so we absolutely do not want to call it
 * per pay item.
 */
let layerNameCache: string[] | null = null;

function getLayerNames(): string[] {
  if (layerNameCache) return layerNameCache;
  layerNameCache = listLayerNames();
  return layerNameCache;
}

function cacheKey(layerName: string, dxfTypes: string[]): string {
  return `${layerName}::${[...dxfTypes].sort().join(',')}`;
}

export function clearSiblingScanCache(): void {
  siblingCache.clear();
  layerNameCache = null;
}

/**
 * Find up to 3 layers that share at least one token with `item.layer`
 * AND have at least one entity matching the requested DXF types.
 *
 * Strategy: list all layers (cheap), filter by name similarity (free),
 * then run a per-candidate SelectionSet probe for each to check whether
 * any entities match. Each probe is ~40ms regardless of how many
 * entities live on the layer — the SelectionSet does the filtering
 * server-side, and we just read `.Count`, never iterate.
 */
function findSiblingLayers(
  item: PayItem,
  dxfTypes: string[],
  // aliases are unused here but kept in the signature because a future
  // refinement could post-filter on ObjectName for borderline cases.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _aliases: string[],
): string[] {
  try {
    const tokens = tokenize(item.layer);
    if (tokens.length === 0) return [];

    const key = cacheKey(item.layer, dxfTypes);
    const cached = siblingCache.get(key);
    if (cached) return cached;

    const candidates = getLayerNames().filter(
      (name) => name !== item.layer && sharesToken(name, tokens),
    );

    const siblings: string[] = [];
    for (const cand of candidates) {
      if (siblings.length >= 3) break;
      try {
        // Probe: one DXF-filtered selection set per candidate. Read
        // `.Count` only — materialising entities is 60ms each.
        const count = countEntities({ layer: cand, dxfTypes });
        if (count > 0) siblings.push(cand);
      } catch {
        /* skip layers that throw (e.g. frozen/locked-in-a-weird-way) */
      }
    }
    siblingCache.set(key, siblings);
    return siblings;
  } catch {
    return [];
  }
}

/**
 * Generic / structural tokens we strip before matching layer names. These
 * appear in almost every civil utility layer and would cause false-positive
 * sibling matches — e.g. every "P-UTIL ..." layer sharing "UTIL" with the
 * target. Keep only the distinctive words (WATER, SAN, STM, HMA, etc).
 */
const GENERIC_TOKENS = new Set([
  'P',
  'X',
  'UTIL',
  'UG',
  'AG',
  'EX',
  'EXIST',
  'EXISTING',
  'PROP',
  'PROPOSED',
  'DEMO',
  'BASE',
  'STR',
  'ANNO',
  'GND',
  'SYMB',
  'NEW',
  'OLD',
]);

/** Break a layer name into distinctive tokens. E.g. "P-UTIL Water UG" → ["WATER"]. */
function tokenize(name: string): string[] {
  return name
    .split(/[-_\s|]+/)
    .map((t) => t.toUpperCase())
    .filter((t) => t.length >= 2 && !GENERIC_TOKENS.has(t));
}

function sharesToken(layerName: string, tokens: string[]): boolean {
  const otherTokens = new Set(tokenize(layerName));
  return tokens.some((t) => otherTokens.has(t));
}
