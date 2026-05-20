/**
 * Extract per-entity geometry needed for sheet-boundary clipping.
 *
 * Each entity exposes some combination of:
 *   - a representative point (for count-based allocation / fallback)
 *   - a polyline vertex sequence (for linear allocation: pipes, polylines, lines)
 *   - a closed polygon loop (for area allocation: hatches, closed polylines)
 *
 * The measurement layer picks which to use based on `item.measurement`.
 *
 * Why a separate extractor (vs. extending `extractSummaryProps`):
 *   - Summary props are reused across the deterministic measurement pass
 *     and the LLM resolution chat, where extra vertex arrays would bloat
 *     payloads.
 *   - This extractor is only invoked at export time, and only when sheet
 *     breakdown is enabled. Keeping it isolated means zero overhead for
 *     the Indiana flow.
 */

import type { Pair } from '../../clipping';
import { approximateArc, flatCoordsToPairs } from '../../clipping';
import { safeGet, variantToArray } from './helpers';

export interface ClipGeometry {
  /** Representative point for count/fallback allocation. Always present. */
  point: Pair;
  /** Open or closed polyline vertices, in XY. Present for line-like entities. */
  polyline?: Pair[];
  /** Closed polygon outer loop, in XY. Present for hatches and closed polylines. */
  polygon?: Pair[];
}

/**
 * Extract clipping geometry from a live COM entity proxy. Returns null
 * when the entity has no geometry we can use (e.g. an unrecognised type
 * with no bounding box).
 */
export function extractClipGeometry(entity: unknown): ClipGeometry | null {
  const e = entity as Record<string, unknown>;
  const objName = safeGet<string>(e, 'ObjectName', '') ?? '';

  if (objName === 'AcDbBlockReference') return blockReference(e);
  if (objName === 'AeccDbStructure') return structureLike(e);
  if (objName === 'AeccDbPipe') return pipe(e);
  if (objName === 'AcDbLine') return line(e);
  if (objName.includes('Polyline')) return polylineLike(e, objName);
  if (objName === 'AcDbHatch') return hatch(e);
  if (objName === 'AcDbCircle') return circle(e);
  if (objName === 'AcDbArc') return arc(e);
  if (objName === 'AcDbPoint') return pointEntity(e);
  if (objName === 'AcDbText' || objName === 'AcDbMText') return textLike(e);

  // Unknown type — fall back to bounding-box centre. Works for anything
  // visible in the drawing.
  const point = boundingBoxCentre(e);
  return point ? { point } : null;
}

// ---------- per-type extractors ----------

function blockReference(e: Record<string, unknown>): ClipGeometry | null {
  const ins = variantToArray(safeGet(e, 'InsertionPoint'));
  if (!ins || ins.length < 2) {
    const bb = boundingBoxCentre(e);
    return bb ? { point: bb } : null;
  }
  return { point: [ins[0], ins[1]] };
}

function structureLike(e: Record<string, unknown>): ClipGeometry | null {
  // Civil 3D structures expose Position (the catalog-anchored point).
  // Fall back to InsertionPoint, then bounding-box centre.
  const pos =
    variantToArray(safeGet(e, 'Position')) ??
    variantToArray(safeGet(e, 'InsertionPoint'));
  if (pos && pos.length >= 2) return { point: [pos[0], pos[1]] };
  const bb = boundingBoxCentre(e);
  return bb ? { point: bb } : null;
}

function pipe(e: Record<string, unknown>): ClipGeometry | null {
  const sp = variantToArray(safeGet(e, 'StartPoint'));
  const ep = variantToArray(safeGet(e, 'EndPoint'));
  if (sp && ep && sp.length >= 2 && ep.length >= 2) {
    const start: Pair = [sp[0], sp[1]];
    const end: Pair = [ep[0], ep[1]];
    return {
      point: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2],
      polyline: [start, end],
    };
  }
  const bb = boundingBoxCentre(e);
  return bb ? { point: bb } : null;
}

function line(e: Record<string, unknown>): ClipGeometry | null {
  const sp = variantToArray(safeGet(e, 'StartPoint'));
  const ep = variantToArray(safeGet(e, 'EndPoint'));
  if (!sp || !ep || sp.length < 2 || ep.length < 2) return null;
  const start: Pair = [sp[0], sp[1]];
  const end: Pair = [ep[0], ep[1]];
  return {
    point: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2],
    polyline: [start, end],
  };
}

function polylineLike(
  e: Record<string, unknown>,
  objName: string,
): ClipGeometry | null {
  const coords = variantToArray(safeGet(e, 'Coordinates'));
  if (!coords || coords.length < 4) return null;
  const stride: 2 | 3 =
    objName === 'AcDbPolyline' || objName.includes('LW') ? 2 : 3;
  const vertices = flatCoordsToPairs(coords, stride);
  if (vertices.length < 2) return null;
  const closed = safeGet<boolean>(e, 'Closed', false) ?? false;
  const centroid = centroidOfVertices(vertices);
  const geom: ClipGeometry = { point: centroid, polyline: vertices };
  if (closed && vertices.length >= 3) geom.polygon = vertices;
  return geom;
}

function hatch(e: Record<string, unknown>): ClipGeometry | null {
  const loop = readOuterHatchLoop(e);
  if (!loop || loop.length < 3) {
    const bb = boundingBoxCentre(e);
    return bb ? { point: bb } : null;
  }
  return { point: centroidOfVertices(loop), polygon: loop };
}

function circle(e: Record<string, unknown>): ClipGeometry | null {
  const centerArr = variantToArray(safeGet(e, 'Center'));
  const radius = safeGet<number>(e, 'Radius');
  if (!centerArr || centerArr.length < 2 || typeof radius !== 'number') {
    return null;
  }
  const centre: Pair = [centerArr[0], centerArr[1]];
  // 36-step tessellation (~10° per chord) — same density as our arc
  // approximation, and well below the precision construction cost
  // estimating cares about.
  const ring = approximateArc(centre, radius, 0, 2 * Math.PI);
  return { point: centre, polygon: ring };
}

function arc(e: Record<string, unknown>): ClipGeometry | null {
  const centerArr = variantToArray(safeGet(e, 'Center'));
  const radius = safeGet<number>(e, 'Radius');
  const startAng = safeGet<number>(e, 'StartAngle');
  const endAng = safeGet<number>(e, 'EndAngle');
  if (
    !centerArr ||
    centerArr.length < 2 ||
    typeof radius !== 'number' ||
    typeof startAng !== 'number' ||
    typeof endAng !== 'number'
  ) {
    return null;
  }
  const centre: Pair = [centerArr[0], centerArr[1]];
  const polyline = approximateArc(centre, radius, startAng, endAng);
  return { point: centroidOfVertices(polyline), polyline };
}

function pointEntity(e: Record<string, unknown>): ClipGeometry | null {
  const coords = variantToArray(safeGet(e, 'Coordinates'));
  if (!coords || coords.length < 2) return null;
  return { point: [coords[0], coords[1]] };
}

function textLike(e: Record<string, unknown>): ClipGeometry | null {
  const ins = variantToArray(safeGet(e, 'InsertionPoint'));
  if (!ins || ins.length < 2) return null;
  return { point: [ins[0], ins[1]] };
}

// ---------- helpers ----------

function centroidOfVertices(vertices: Pair[]): Pair {
  let sx = 0;
  let sy = 0;
  for (const [x, y] of vertices) {
    sx += x;
    sy += y;
  }
  return [sx / vertices.length, sy / vertices.length];
}

function boundingBoxCentre(e: Record<string, unknown>): Pair | null {
  try {
    const ent = e as { GetBoundingBox?: () => unknown[] };
    if (!ent.GetBoundingBox) return null;
    const result = ent.GetBoundingBox();
    if (!Array.isArray(result) || result.length < 2) return null;
    const min = variantToArray(result[0]);
    const max = variantToArray(result[1]);
    if (!min || !max || min.length < 2 || max.length < 2) return null;
    return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  } catch {
    return null;
  }
}

/**
 * Read the outer boundary loop of an AcDbHatch as a flat XY polygon.
 *
 * AutoCAD hatch boundaries are loops of mixed curve types — lines, arcs,
 * polylines, ellipses, splines. We walk the loop returned by `GetLoopAt(0)`
 * and tessellate any non-linear pieces:
 *   - AcDbLine / AcDbXLine pieces contribute their endpoint
 *   - AcDbPolyline pieces contribute their vertices
 *   - AcDbArc / AcDbCircle pieces are approximated via `approximateArc`
 *
 * Returns null when the loop can't be reduced to a polygon (e.g. spline
 * boundary — rare in civil hatches).
 */
function readOuterHatchLoop(e: Record<string, unknown>): Pair[] | null {
  const numLoops = safeGet<number>(e, 'NumberOfLoops');
  if (typeof numLoops !== 'number' || numLoops < 1) return null;
  let pieces: unknown[];
  try {
    const ent = e as { GetLoopAt?: (i: number) => unknown };
    if (!ent.GetLoopAt) return null;
    const result = ent.GetLoopAt(0);
    if (!Array.isArray(result)) return null;
    pieces = result;
  } catch {
    return null;
  }

  const ring: Pair[] = [];
  for (const piece of pieces) {
    const p = piece as Record<string, unknown>;
    const objName = safeGet<string>(p, 'ObjectName', '') ?? '';

    if (objName === 'AcDbLine') {
      const sp = variantToArray(safeGet(p, 'StartPoint'));
      const ep = variantToArray(safeGet(p, 'EndPoint'));
      if (sp && sp.length >= 2) appendIfDistinct(ring, [sp[0], sp[1]]);
      if (ep && ep.length >= 2) appendIfDistinct(ring, [ep[0], ep[1]]);
    } else if (objName.includes('Polyline')) {
      const coords = variantToArray(safeGet(p, 'Coordinates'));
      if (coords) {
        const stride: 2 | 3 =
          objName === 'AcDbPolyline' || objName.includes('LW') ? 2 : 3;
        for (const v of flatCoordsToPairs(coords, stride)) {
          appendIfDistinct(ring, v);
        }
      }
    } else if (objName === 'AcDbArc' || objName === 'AcDbCircle') {
      const centerArr = variantToArray(safeGet(p, 'Center'));
      const radius = safeGet<number>(p, 'Radius');
      const startAng =
        objName === 'AcDbCircle' ? 0 : (safeGet<number>(p, 'StartAngle') ?? 0);
      const endAng =
        objName === 'AcDbCircle'
          ? 2 * Math.PI
          : (safeGet<number>(p, 'EndAngle') ?? 0);
      if (centerArr && centerArr.length >= 2 && typeof radius === 'number') {
        const centre: Pair = [centerArr[0], centerArr[1]];
        for (const v of approximateArc(centre, radius, startAng, endAng)) {
          appendIfDistinct(ring, v);
        }
      }
    }
    // Splines / ellipses / unknown — skipped. The result is null'd by the
    // caller if not enough vertices were collected.
  }
  return ring.length >= 3 ? ring : null;
}

function appendIfDistinct(ring: Pair[], v: Pair): void {
  const last = ring[ring.length - 1];
  if (last && Math.abs(last[0] - v[0]) < 1e-9 && Math.abs(last[1] - v[1]) < 1e-9) {
    return;
  }
  ring.push(v);
}
