/**
 * Discover plan-sheet boundary polygons in the active drawing.
 *
 * Convention: each sheet in a Michigan project has a closed polyline on a
 * dedicated layer named like `Sheet1`, `Sheet2`, … (prefix configurable).
 * At export time we read these polygons, then allocate each measured
 * entity to the sheet whose polygon contains it (or splits it — see
 * `clipping.ts`).
 *
 * This module only handles discovery — the geometric clipping happens in
 * the export-time measurement driver.
 */

import type { Ring, SheetPolygon } from '../../clipping';
import { flatCoordsToPairs } from '../../clipping';

import { listLayerNames } from './layers';
import { selectEntities } from './selection';
import { safeGet, variantToArray } from './helpers';

export interface SheetBoundary {
  /** Sheet number parsed out of the layer name. 1-based. */
  number: number;
  /** The AutoCAD layer the boundary polygon lives on. */
  layer: string;
  /** Closed-polyline vertex ring, in XY. Z dropped if present. */
  ring: Ring;
}

/**
 * Scan all layers in the active drawing for ones matching the user's
 * sheet-prefix pattern, then read the boundary polygon from each.
 *
 * Matches layers like `Sheet1`, `sheet 2`, `SHEET_03`, `Sheet-4`. Doesn't
 * match `Sheets`, `Sheet1A`, `Sheetlist` — the prefix must be followed
 * only by optional space/underscore/dash separators and digits.
 *
 * Layers with no closed polyline are silently skipped (caller can compare
 * the returned count against expected). The result is sorted by sheet
 * number, so consumers can rely on order = page order.
 */
export function findSheetBoundaries(prefix: string): SheetBoundary[] {
  const trimmed = prefix.trim();
  if (!trimmed) return [];

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const layerRegex = new RegExp(`^${escaped}[\\s_-]*(\\d+)$`, 'i');

  const matches: { layer: string; number: number }[] = [];
  for (const layer of listLayerNames()) {
    const m = layer.match(layerRegex);
    if (!m) continue;
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n)) matches.push({ layer, number: n });
  }
  matches.sort((a, b) => a.number - b.number);

  const out: SheetBoundary[] = [];
  for (const { layer, number } of matches) {
    const ring = readBoundaryRing(layer);
    if (ring) out.push({ number, layer, ring });
  }
  return out;
}

/**
 * Read the first closed polyline on `layer` and return its vertex ring.
 * Tries LWPolyline first (the common case for sheet boundaries) and falls
 * back to legacy 2D/3D Polyline. Z coordinates are dropped — sheet
 * boundaries are evaluated in the XY plane.
 */
function readBoundaryRing(layer: string): Ring | null {
  const entities = selectEntities({
    layer,
    dxfTypes: ['LWPOLYLINE', 'POLYLINE'],
  });
  for (const ent of entities as Record<string, unknown>[]) {
    const closed = safeGet<boolean>(ent, 'Closed', false) ?? false;
    if (!closed) continue;
    const objName = safeGet<string>(ent, 'ObjectName', '') ?? '';
    const coords = variantToArray(safeGet(ent, 'Coordinates'));
    if (!coords || coords.length < 4) continue;
    const stride: 2 | 3 =
      objName === 'AcDbPolyline' || objName.includes('LW') ? 2 : 3;
    const pairs = flatCoordsToPairs(coords, stride);
    if (pairs.length >= 3) return pairs;
  }
  return null;
}

/** Convert sheet boundaries into the shape the clipping allocators expect. */
export function toSheetPolygons(
  boundaries: SheetBoundary[],
): SheetPolygon[] {
  return boundaries.map((b) => ({
    id: sheetIdFromNumber(b.number),
    ring: b.ring,
  }));
}

/** Stable id used for a sheet across the discovery → allocation → export pipeline. */
export function sheetIdFromNumber(n: number): string {
  return `sheet-${n}`;
}
