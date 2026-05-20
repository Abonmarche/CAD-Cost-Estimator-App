/**
 * Pure-JS geometry layer for allocating measured entities to plan sheets.
 *
 * The Michigan workflow breaks a cost estimate down per plan sheet. Each
 * sheet's boundary lives in the drawing as a closed polyline on a layer
 * like `Sheet1`, `Sheet2`, …. At export time we re-allocate each entity's
 * quantity across these polygons.
 *
 * Strategy: return per-sheet *fractions* of the entity's quantity, not
 * absolute lengths or areas. The measurement layer multiplies these
 * fractions against AutoCAD's authoritative `Length` / `Area` values
 * (which correctly account for polyline bulges, true hatch boundaries,
 * etc.) so per-sheet sums always reconcile to the total exactly — even
 * when our straight-line approximation of vertex Coordinates underestimates
 * the true geometry.
 *
 * Sheet polygons may be arbitrary shapes (convex, concave, or with holes).
 * Area clipping delegates to `polygon-clipping` for robustness. Linear
 * clipping is implemented here because it's a different problem (line
 * segment vs polygon) and is small enough to keep in-tree.
 */

import polygonClipping from 'polygon-clipping';

/** A 2D point. */
export type Pair = [number, number];

/** A closed ring of points. First and last may or may not coincide. */
export type Ring = Pair[];

/** A sheet polygon with a stable id (e.g. "sheet-1") and its boundary ring. */
export interface SheetPolygon {
  id: string;
  ring: Ring;
}

/**
 * Per-sheet allocation. `bySheet` keys correspond to `SheetPolygon.id`.
 * `unassigned` covers the portion outside every sheet polygon. The sum
 * of all values is always 1 (or 0 for degenerate input).
 */
export interface SheetAllocation {
  bySheet: Record<string, number>;
  unassigned: number;
}

/** Sentinel id used when reporting an entity that doesn't fit any sheet. */
export const UNASSIGNED_ID = '__unassigned__';

// ---------- Coordinate helpers ----------

/**
 * Convert a flat AutoCAD coordinate array `[x1, y1, x2, y2, …]` (LWPolyline)
 * or `[x1, y1, z1, x2, y2, z2, …]` (3D polyline) into 2D pairs. The Z
 * coordinate is dropped — plan-sheet boundaries are always evaluated in
 * the XY plane.
 */
export function flatCoordsToPairs(
  coords: number[],
  stride: 2 | 3 = 2,
): Pair[] {
  const out: Pair[] = [];
  for (let i = 0; i + 1 < coords.length; i += stride) {
    out.push([coords[i], coords[i + 1]]);
  }
  return out;
}

/** Total length of a polyline given its vertex sequence. */
export function polylineLength(vertices: Pair[]): number {
  let total = 0;
  for (let i = 1; i < vertices.length; i++) {
    const dx = vertices[i][0] - vertices[i - 1][0];
    const dy = vertices[i][1] - vertices[i - 1][1];
    total += Math.hypot(dx, dy);
  }
  return total;
}

/** Signed polygon area via the shoelace formula. */
export function ringArea(ring: Ring): number {
  if (ring.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/**
 * Approximate an arc as a sequence of chord points. Used when reading
 * hatch boundary loops that include arc curves. `maxAngleStepRad` controls
 * the chord density — ~10° per chord (π/18) is well below the precision
 * civil cost estimating needs.
 */
export function approximateArc(
  center: Pair,
  radius: number,
  startAngleRad: number,
  endAngleRad: number,
  maxAngleStepRad = Math.PI / 18,
): Pair[] {
  let sweep = endAngleRad - startAngleRad;
  // Normalize to a positive sweep — arcs in AutoCAD go counter-clockwise.
  while (sweep < 0) sweep += 2 * Math.PI;
  if (sweep === 0) sweep = 2 * Math.PI;
  const steps = Math.max(1, Math.ceil(sweep / maxAngleStepRad));
  const out: Pair[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = startAngleRad + (sweep * i) / steps;
    out.push([center[0] + radius * Math.cos(a), center[1] + radius * Math.sin(a)]);
  }
  return out;
}

// ---------- Point-in-polygon ----------

/**
 * Ray-casting point-in-polygon test. Works for arbitrary simple polygons
 * (convex, concave, doesn't matter). Points exactly on the boundary may
 * report either side — that's fine for our use case (engineering drawings
 * rarely have entities sitting exactly on a sheet boundary).
 */
export function pointInPolygon(point: Pair, ring: Ring): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 0) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// ---------- Point allocator (blocks, structures) ----------

/**
 * Allocate a single point (e.g. block insertion point, structure center)
 * to the first sheet polygon that contains it. Returns `UNASSIGNED_ID`
 * when the point is outside every sheet.
 *
 * Sheets are tested in order, so overlapping polygons resolve to the
 * earlier-listed sheet — caller should pass sheets sorted by number to
 * get deterministic results.
 */
export function allocatePoint(
  point: Pair,
  sheets: SheetPolygon[],
): string {
  for (const sheet of sheets) {
    if (pointInPolygon(point, sheet.ring)) return sheet.id;
  }
  return UNASSIGNED_ID;
}

// ---------- Polyline length allocator ----------

/**
 * Allocate a polyline's length across sheet polygons. Returns fractions
 * that sum to 1 (or 0 if the polyline has zero length).
 *
 * Algorithm:
 *   1. Walk each segment of the polyline.
 *   2. Find all parameter values t in [0,1] where the segment crosses
 *      any sheet polygon edge.
 *   3. Sort the parameters and split the segment into sub-segments.
 *   4. Classify each sub-segment by its midpoint — assign to the first
 *      sheet whose polygon contains it, else to "unassigned".
 *   5. Accumulate sub-segment length per bucket and normalise.
 *
 * Handles concave polygons correctly because each sub-segment between
 * consecutive intersections has a definite inside/outside status that
 * the midpoint test reveals — no convexity assumption.
 */
export function allocatePolylineLength(
  vertices: Pair[],
  sheets: SheetPolygon[],
): SheetAllocation {
  if (vertices.length < 2) {
    return { bySheet: {}, unassigned: 0 };
  }

  // Fast path — if the whole polyline fits inside one sheet (bounding-box
  // contained AND every vertex inside), skip the segment-clip work.
  const fast = fastWholePolylineSheet(vertices, sheets);
  if (fast) return { bySheet: { [fast]: 1 }, unassigned: 0 };

  const buckets: Record<string, number> = {};
  let unassignedLen = 0;
  let totalLen = 0;

  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1];
    const b = vertices[i];
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    totalLen += segLen;
    if (segLen === 0) continue;

    // Collect parameter values where the segment crosses any sheet's edges.
    const params = new Set<number>([0, 1]);
    for (const sheet of sheets) {
      collectSegmentPolygonIntersections(a, b, sheet.ring, params);
    }
    const sorted = Array.from(params).sort((p, q) => p - q);

    for (let k = 1; k < sorted.length; k++) {
      const t0 = sorted[k - 1];
      const t1 = sorted[k];
      if (t1 - t0 < 1e-12) continue;
      const tMid = (t0 + t1) / 2;
      const midX = a[0] + (b[0] - a[0]) * tMid;
      const midY = a[1] + (b[1] - a[1]) * tMid;
      const owner = allocatePoint([midX, midY], sheets);
      const pieceLen = segLen * (t1 - t0);
      if (owner === UNASSIGNED_ID) {
        unassignedLen += pieceLen;
      } else {
        buckets[owner] = (buckets[owner] ?? 0) + pieceLen;
      }
    }
  }

  if (totalLen === 0) return { bySheet: {}, unassigned: 0 };
  const out: Record<string, number> = {};
  for (const [id, len] of Object.entries(buckets)) out[id] = len / totalLen;
  return { bySheet: out, unassigned: unassignedLen / totalLen };
}

function fastWholePolylineSheet(
  vertices: Pair[],
  sheets: SheetPolygon[],
): string | null {
  for (const sheet of sheets) {
    let allIn = true;
    for (const v of vertices) {
      if (!pointInPolygon(v, sheet.ring)) {
        allIn = false;
        break;
      }
    }
    if (allIn) return sheet.id;
  }
  return null;
}

/**
 * Find every parameter t in (0, 1) where the segment a→b crosses any edge
 * of `ring`. Results are accumulated into `out`. Endpoints (t=0, t=1) are
 * seeded by the caller — we only care about strictly interior crossings
 * here, because endpoint behaviour is handled by the t=0/t=1 sub-segment
 * midpoint tests.
 */
function collectSegmentPolygonIntersections(
  a: Pair,
  b: Pair,
  ring: Ring,
  out: Set<number>,
): void {
  for (let i = 0; i < ring.length; i++) {
    const c = ring[i];
    const d = ring[(i + 1) % ring.length];
    const t = segmentSegmentIntersectionParam(a, b, c, d);
    if (t !== null && t > 1e-12 && t < 1 - 1e-12) {
      out.add(t);
    }
  }
}

/**
 * Return parameter t in [0,1] along the a→b segment where it crosses the
 * c→d segment, or null if they don't cross (including collinear/parallel).
 * Standard 2D segment intersection — solves for t and u, requires both in
 * [0,1].
 */
function segmentSegmentIntersectionParam(
  a: Pair,
  b: Pair,
  c: Pair,
  d: Pair,
): number | null {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const denom = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(denom) < 1e-12) return null; // parallel / collinear
  const qmp = [c[0] - a[0], c[1] - a[1]];
  const t = (qmp[0] * s[1] - qmp[1] * s[0]) / denom;
  const u = (qmp[0] * r[1] - qmp[1] * r[0]) / denom;
  if (t < -1e-12 || t > 1 + 1e-12) return null;
  if (u < -1e-12 || u > 1 + 1e-12) return null;
  return Math.max(0, Math.min(1, t));
}

// ---------- Polygon area allocator (hatches, closed polylines) ----------

/**
 * Allocate a closed shape's area across sheet polygons. Returns fractions
 * that sum to 1 (or 0 if the shape has zero area).
 *
 * Uses `polygon-clipping` to compute the intersection per sheet. Handles
 * arbitrary subject and clip polygons — convex, concave, with holes.
 *
 * The total area is computed from the same vertex list (shoelace) rather
 * than from a separately-supplied value, so the ratios sum to exactly 1
 * regardless of whether our vertex sequence matches AutoCAD's `Area`
 * property. The measurement layer scales the AutoCAD-reported area by
 * these fractions — so any discrepancy washes out in the multiplication.
 */
export function allocatePolygonArea(
  loop: Ring,
  sheets: SheetPolygon[],
): SheetAllocation {
  if (loop.length < 3) return { bySheet: {}, unassigned: 0 };

  const totalArea = ringArea(loop);
  if (totalArea === 0) return { bySheet: {}, unassigned: 0 };

  // polygon-clipping expects a closed ring (first vertex repeated as last).
  const closedLoop = ensureClosedRing(loop);
  const subject: Pair[][] = [closedLoop];

  const buckets: Record<string, number> = {};
  let assignedArea = 0;

  for (const sheet of sheets) {
    const sheetClosed = ensureClosedRing(sheet.ring);
    let result;
    try {
      result = polygonClipping.intersection(subject, [sheetClosed]);
    } catch {
      // polygon-clipping can throw on degenerate input — skip this sheet.
      continue;
    }
    let area = 0;
    for (const poly of result) {
      // poly is a polygon: outer ring + optional holes. Outer minus holes.
      if (poly.length === 0) continue;
      area += ringArea(poly[0]);
      for (let h = 1; h < poly.length; h++) area -= ringArea(poly[h]);
    }
    if (area > 0) {
      buckets[sheet.id] = area;
      assignedArea += area;
    }
  }

  const out: Record<string, number> = {};
  for (const [id, a] of Object.entries(buckets)) out[id] = a / totalArea;
  const unassignedFrac = Math.max(0, (totalArea - assignedArea) / totalArea);
  return { bySheet: out, unassigned: unassignedFrac };
}

function ensureClosedRing(ring: Ring): Ring {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, [first[0], first[1]]];
}
