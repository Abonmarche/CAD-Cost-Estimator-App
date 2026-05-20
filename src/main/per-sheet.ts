/**
 * Per-sheet allocation orchestrator (Michigan workflow only).
 *
 * Runs at export time, never at Quantify time. For each completed pay
 * item, picks up the same candidate entities the Quantify pass selected,
 * extracts their clipping geometry, and asks the geometric allocators
 * what fraction of the item belongs to each sheet polygon.
 *
 * Output is *fractions*, not absolute quantities. The export layer
 * multiplies them by `item.quantity` so per-sheet sums always reconcile
 * to the project total — even if our straight-line vertex approximation
 * underestimates real polyline/hatch geometry.
 */

import type { PayItem } from '@shared/types';
import {
  OBJECT_TYPE_ALIASES,
  DXF_TYPE_NAMES,
} from '@shared/constants';

import {
  allocatePoint,
  allocatePolygonArea,
  allocatePolylineLength,
  UNASSIGNED_ID,
  type SheetAllocation,
  type SheetPolygon,
} from './clipping';
import { resolveLayers } from './measurement';
import { selectEntities } from './tools/autocad/selection';
import { extractClipGeometry } from './tools/autocad/clip-geometry';
import { polylineLength, ringArea } from './clipping';
import { safeGet } from './tools/autocad/helpers';

export interface PerSheetMeasurement {
  itemId: string;
  /** Fraction of `item.quantity` belonging to each sheet id. */
  bySheet: Record<string, number>;
  /** Fraction outside every sheet polygon. */
  unassigned: number;
}

/**
 * Allocate every item's quantity across sheet polygons. Skips items that
 * aren't `complete` — pending/error/flagged items have nothing to break
 * down. Returns one entry per processed item.
 */
export function measurePerSheet(
  items: PayItem[],
  sheets: SheetPolygon[],
): PerSheetMeasurement[] {
  const out: PerSheetMeasurement[] = [];
  for (const item of items) {
    if (item.status !== 'complete') continue;
    if (item.quantity === null || item.quantity === 0) continue;
    out.push(allocateItem(item, sheets));
  }
  return out;
}

/**
 * Allocate a single item. Falls back to `{ unassigned: 1 }` when the
 * item has no measurable geometry (manual quantity, no matching
 * entities, or extraction failed).
 */
function allocateItem(item: PayItem, sheets: SheetPolygon[]): PerSheetMeasurement {
  const proxies = selectCandidateProxies(item);
  if (proxies.length === 0) {
    return unassignedAll(item);
  }

  // Accumulate per-sheet contributions weighted by each entity's quantity.
  // The denominator is the SUM of per-entity contributions, not item.quantity —
  // this means we proportionally rescale to whatever geometry was actually
  // extractable. If no entity had usable geometry, denom=0 → all unassigned.
  const buckets: Record<string, number> = {};
  let unassigned = 0;
  let denom = 0;

  for (const proxy of proxies) {
    const contribution = allocateEntity(proxy, item, sheets);
    if (!contribution) continue;
    denom += contribution.weight;
    for (const [id, frac] of Object.entries(contribution.allocation.bySheet)) {
      buckets[id] = (buckets[id] ?? 0) + frac * contribution.weight;
    }
    unassigned += contribution.allocation.unassigned * contribution.weight;
  }

  if (denom === 0) return unassignedAll(item);

  const bySheet: Record<string, number> = {};
  for (const [id, n] of Object.entries(buckets)) bySheet[id] = n / denom;
  return {
    itemId: item.id,
    bySheet,
    unassigned: unassigned / denom,
  };
}

function unassignedAll(item: PayItem): PerSheetMeasurement {
  return { itemId: item.id, bySheet: {}, unassigned: 1 };
}

/**
 * Run the same DXF + ObjectName + closed + style-keyword filters Quantify
 * uses, but return the live COM proxies instead of EntityRecord summaries.
 * The clip-geometry extractor needs proxy access to call GetBoundingBox,
 * read InsertionPoint as a VARIANT, etc.
 */
function selectCandidateProxies(item: PayItem): unknown[] {
  const aliases = OBJECT_TYPE_ALIASES[item.objectType];
  const dxfTypes = DXF_TYPE_NAMES[item.objectType];
  const nameSet = new Set(aliases);
  const closedFilter =
    item.objectType === 'closedPolyline'
      ? true
      : item.objectType === 'polyline'
        ? false
        : undefined;
  const styleNeedle =
    typeof item.styleKeyword === 'string' &&
    item.styleKeyword.trim().length > 0
      ? item.styleKeyword.trim().toLowerCase()
      : null;

  const layers = resolveLayers(item);
  if (layers.length === 0) return [];

  const out: unknown[] = [];
  for (const layer of layers) {
    const raw = selectEntities({ layer, dxfTypes });
    for (const proxy of raw as Record<string, unknown>[]) {
      const objName = safeGet<string>(proxy, 'ObjectName', '') ?? '';
      if (!nameSet.has(objName)) continue;
      if (closedFilter !== undefined && objName.includes('Polyline')) {
        const closed = safeGet<boolean>(proxy, 'Closed', false) ?? false;
        if (closed !== closedFilter) continue;
      }
      if (styleNeedle) {
        const style = safeGet<Record<string, unknown>>(proxy, 'Style');
        const styleName =
          style ? safeGet<string>(style, 'Name') : undefined;
        if (
          typeof styleName === 'string' &&
          !styleName.toLowerCase().includes(styleNeedle)
        ) {
          continue;
        }
      }
      out.push(proxy);
    }
  }
  return out;
}

/**
 * One entity's contribution to the per-sheet allocation. `weight` is the
 * absolute quantity the entity contributes (length, area, or 1 for count
 * items) — used by the caller as the denominator when normalising.
 *
 * Returns null when the entity has no usable geometry.
 */
interface EntityContribution {
  allocation: SheetAllocation;
  weight: number;
}

function allocateEntity(
  proxy: unknown,
  item: PayItem,
  sheets: SheetPolygon[],
): EntityContribution | null {
  const geom = extractClipGeometry(proxy);
  if (!geom) return null;

  if (item.measurement === 'count') {
    const owner = allocatePoint(geom.point, sheets);
    if (owner === UNASSIGNED_ID) {
      return { allocation: { bySheet: {}, unassigned: 1 }, weight: 1 };
    }
    return {
      allocation: { bySheet: { [owner]: 1 }, unassigned: 0 },
      weight: 1,
    };
  }

  if (item.measurement === 'linear') {
    if (!geom.polyline || geom.polyline.length < 2) {
      // Linear item with no polyline geometry — fall back to point so the
      // entity isn't dropped, but it contributes only as a weight of 1
      // entity. Rare path; covers e.g. a stray AeccDbStructure on a pipe
      // layer.
      const owner = allocatePoint(geom.point, sheets);
      const allocation: SheetAllocation =
        owner === UNASSIGNED_ID
          ? { bySheet: {}, unassigned: 1 }
          : { bySheet: { [owner]: 1 }, unassigned: 0 };
      return { allocation, weight: 0 };
    }
    const length = polylineLength(geom.polyline);
    if (length === 0) return null;
    const allocation = allocatePolylineLength(geom.polyline, sheets);
    return { allocation, weight: length };
  }

  if (item.measurement === 'area') {
    if (!geom.polygon || geom.polygon.length < 3) {
      const owner = allocatePoint(geom.point, sheets);
      const allocation: SheetAllocation =
        owner === UNASSIGNED_ID
          ? { bySheet: {}, unassigned: 1 }
          : { bySheet: { [owner]: 1 }, unassigned: 0 };
      return { allocation, weight: 0 };
    }
    const area = ringArea(geom.polygon);
    if (area === 0) return null;
    const allocation = allocatePolygonArea(geom.polygon, sheets);
    return { allocation, weight: area };
  }

  return null;
}
