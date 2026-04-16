/**
 * Low-level helpers for working with COM objects via winax.
 *
 * These are the TypeScript ports of the Python utility functions in
 * AutoCAD-MCP's `src/utils.py`: `_safe_get`, `_extract_summary_props`,
 * and `extract_detailed_properties`.
 */

import type { EntityRecord } from '@shared/types';

/**
 * Safely read a property off a COM entity.
 *
 * COM property access can throw for a variety of reasons (property doesn't
 * exist on this entity type, entity has been deleted, wrong VARIANT type,
 * etc.). This mirrors Python's `_safe_get` — return the default on any
 * failure instead of crashing the whole iteration.
 */
export function safeGet<T>(entity: unknown, prop: string): T | undefined;
export function safeGet<T>(entity: unknown, prop: string, defaultVal: T): T;
export function safeGet<T>(
  entity: unknown,
  prop: string,
  defaultVal?: T,
): T | undefined {
  try {
    // winax exposes COM properties as ordinary JS properties on the proxy.
    const val = (entity as Record<string, unknown>)[prop];
    if (val === undefined || val === null) return defaultVal;
    return val as T;
  } catch {
    return defaultVal;
  }
}

/** Round a number to a fixed precision without introducing floating noise. */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Convert a VARIANT array (safe-array of doubles) to a plain number[].
 * winax surfaces these as array-like objects; normalize them here.
 */
export function variantToArray(v: unknown): number[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) return v.map(Number);
  // winax returns safe-arrays as array-like objects with a length property
  const al = v as ArrayLike<unknown>;
  if (typeof al.length === 'number') {
    const out: number[] = [];
    for (let i = 0; i < al.length; i++) out.push(Number(al[i]));
    return out;
  }
  return undefined;
}

/**
 * Extract a compact summary of an entity — the equivalent of the Python
 * `_extract_summary_props`. Used when listing many entities on a layer.
 */
export function extractSummaryProps(entity: unknown): EntityRecord {
  const e = entity as Record<string, unknown>;
  const objName = safeGet<string>(e, 'ObjectName', '') ?? '';
  const info: EntityRecord = {
    id: safeGet<number>(e, 'ObjectID', 0) ?? 0,
    type: objName,
  };

  // Length (polylines, lines, arcs, splines, pipes)
  const length = safeGet<number>(e, 'Length');
  if (typeof length === 'number') info.length = round4(length);

  // Area (polylines, circles, hatches, regions)
  const area = safeGet<number>(e, 'Area');
  if (typeof area === 'number') info.area = round4(area);

  // Polyline-specific: global width (used to encode pipe diameter), closed flag
  if (objName.includes('Polyline')) {
    const cw = safeGet<number>(e, 'ConstantWidth');
    if (typeof cw === 'number') info.constant_width = round4(cw);
    const closed = safeGet<boolean>(e, 'Closed');
    if (typeof closed === 'boolean') info.closed = closed;
  }

  // Block references
  if (objName === 'AcDbBlockReference') {
    info.block_name = safeGet<string>(e, 'Name', '');
    const eff = safeGet<string>(e, 'EffectiveName');
    if (eff && eff !== info.block_name) info.effective_name = eff;
    const ins = variantToArray(safeGet(e, 'InsertionPoint'));
    if (ins) info.insertion_point = ins;
  }

  // Hatch pattern
  if (objName === 'AcDbHatch') {
    info.pattern_name = safeGet<string>(e, 'PatternName', '');
  }

  // Point coordinates
  if (objName === 'AcDbPoint') {
    const coords = variantToArray(safeGet(e, 'Coordinates'));
    if (coords) info.coordinates = coords;
  }

  // Text / MText
  if (objName === 'AcDbText' || objName === 'AcDbMText') {
    let text = safeGet<string>(e, 'TextString', '') ?? '';
    if (text.length > 100) text = text.slice(0, 100) + '...';
    info.text = text;
  }

  // Circle
  if (objName === 'AcDbCircle') {
    info.radius = safeGet<number>(e, 'Radius');
    const center = variantToArray(safeGet(e, 'Center'));
    if (center) info.center = center;
  }

  // Line
  if (objName === 'AcDbLine') {
    const sp = variantToArray(safeGet(e, 'StartPoint'));
    const ep = variantToArray(safeGet(e, 'EndPoint'));
    if (sp) info.start_point = sp;
    if (ep) info.end_point = ep;
  }

  // Arc
  if (objName === 'AcDbArc') {
    info.radius = safeGet<number>(e, 'Radius');
    info.start_angle = safeGet<number>(e, 'StartAngle');
    info.end_angle = safeGet<number>(e, 'EndAngle');
  }

  return info;
}

/**
 * Extract comprehensive properties for a single entity (for the
 * `get_entity_details` tool). Equivalent of the Python
 * `extract_detailed_properties`.
 */
export function extractDetailedProperties(
  entity: unknown,
): Record<string, unknown> {
  const e = entity as Record<string, unknown>;
  const objName = safeGet<string>(e, 'ObjectName', '') ?? '';

  const props: Record<string, unknown> = {
    id: safeGet(e, 'ObjectID'),
    type: objName,
    layer: safeGet(e, 'Layer'),
    color: safeGet(e, 'Color'),
    linetype: safeGet(e, 'Linetype'),
    lineweight: safeGet(e, 'Lineweight'),
    linetype_scale: safeGet(e, 'LinetypeScale'),
    visible: safeGet(e, 'Visible'),
    handle: safeGet(e, 'Handle'),
  };

  // Bounding box — two output params via a COM method, winax binds them as a tuple.
  // Don't detach the method; winax's COM method proxies must be called on the
  // original object (see iterateCollection comment in connection.ts).
  try {
    const ent = e as { GetBoundingBox?: () => unknown[] };
    if (ent.GetBoundingBox) {
      const result = ent.GetBoundingBox();
      if (Array.isArray(result) && result.length >= 2) {
        const min = variantToArray(result[0]);
        const max = variantToArray(result[1]);
        if (min && max)
          props.bounding_box = { min_point: min, max_point: max };
      }
    }
  } catch {
    /* ignore */
  }

  if (objName.includes('Polyline')) {
    props.length = safeGet(e, 'Length');
    props.area = safeGet(e, 'Area');
    props.closed = safeGet(e, 'Closed');
    props.constant_width = safeGet(e, 'ConstantWidth');
    props.elevation = safeGet(e, 'Elevation');
    props.thickness = safeGet(e, 'Thickness');
    const coords = variantToArray(safeGet(e, 'Coordinates'));
    if (coords) {
      // Lightweight polyline coords are 2D (x,y pairs); 2d/3d polylines vary.
      const step =
        objName === 'AcDbPolyline' || objName.includes('LW') ? 2 : 3;
      const vertices: number[][] = [];
      for (let i = 0; i + step <= coords.length; i += step) {
        vertices.push(coords.slice(i, i + step));
      }
      props.vertex_count = vertices.length;
      props.vertices = vertices;
    }
  } else if (objName === 'AcDbLine') {
    props.length = safeGet(e, 'Length');
    const sp = variantToArray(safeGet(e, 'StartPoint'));
    const ep = variantToArray(safeGet(e, 'EndPoint'));
    if (sp) props.start_point = sp;
    if (ep) props.end_point = ep;
    props.thickness = safeGet(e, 'Thickness');
    props.angle = safeGet(e, 'Angle');
  } else if (objName === 'AcDbCircle') {
    const center = variantToArray(safeGet(e, 'Center'));
    if (center) props.center = center;
    props.radius = safeGet(e, 'Radius');
    props.diameter = safeGet(e, 'Diameter');
    props.area = safeGet(e, 'Area');
    props.circumference = safeGet(e, 'Circumference');
  } else if (objName === 'AcDbArc') {
    const center = variantToArray(safeGet(e, 'Center'));
    if (center) props.center = center;
    props.radius = safeGet(e, 'Radius');
    props.start_angle = safeGet(e, 'StartAngle');
    props.end_angle = safeGet(e, 'EndAngle');
    props.arc_length = safeGet(e, 'ArcLength');
    props.total_angle = safeGet(e, 'TotalAngle');
  } else if (objName === 'AcDbBlockReference') {
    props.block_name = safeGet(e, 'Name');
    props.effective_name = safeGet(e, 'EffectiveName');
    const ins = variantToArray(safeGet(e, 'InsertionPoint'));
    if (ins) props.insertion_point = ins;
    props.rotation = safeGet(e, 'Rotation');
    props.x_scale = safeGet(e, 'XScaleFactor');
    props.y_scale = safeGet(e, 'YScaleFactor');
    props.z_scale = safeGet(e, 'ZScaleFactor');
    props.is_dynamic = safeGet(e, 'IsDynamicBlock');
    if (safeGet<boolean>(e, 'HasAttributes')) {
      try {
        const ent = e as { GetAttributes?: () => unknown[] };
        if (ent.GetAttributes) {
          // Call on the object directly — winax COM methods can't be detached.
          const attrs = ent.GetAttributes();
          if (Array.isArray(attrs)) {
            props.attributes = attrs.map((a) => ({
              tag: safeGet<string>(a, 'TagString', ''),
              value: safeGet<string>(a, 'TextString', ''),
              invisible: safeGet<boolean>(a, 'Invisible', false),
            }));
          }
        }
      } catch {
        /* ignore attribute read failures */
      }
    }
  } else if (objName === 'AcDbHatch') {
    props.pattern_name = safeGet(e, 'PatternName');
    props.pattern_type = safeGet(e, 'PatternType');
    props.area = safeGet(e, 'Area');
    props.pattern_scale = safeGet(e, 'PatternScale');
    props.pattern_angle = safeGet(e, 'PatternAngle');
    props.number_of_loops = safeGet(e, 'NumberOfLoops');
    props.associative = safeGet(e, 'AssociativeHatch');
  } else if (objName === 'AcDbPoint') {
    const coords = variantToArray(safeGet(e, 'Coordinates'));
    if (coords) props.coordinates = coords;
  } else if (objName === 'AcDbText') {
    props.text = safeGet(e, 'TextString');
    props.height = safeGet(e, 'Height');
    props.rotation = safeGet(e, 'Rotation');
    props.style = safeGet(e, 'StyleName');
    const ins = variantToArray(safeGet(e, 'InsertionPoint'));
    if (ins) props.insertion_point = ins;
  } else if (objName === 'AcDbMText') {
    props.text = safeGet(e, 'TextString');
    props.height = safeGet(e, 'Height');
    props.width = safeGet(e, 'Width');
    props.rotation = safeGet(e, 'Rotation');
    props.style = safeGet(e, 'StyleName');
    const ins = variantToArray(safeGet(e, 'InsertionPoint'));
    if (ins) props.insertion_point = ins;
  } else if (objName === 'AcDbSpline') {
    props.length = safeGet(e, 'Length');
    props.area = safeGet(e, 'Area');
    props.closed = safeGet(e, 'Closed');
    props.degree = safeGet(e, 'Degree');
    props.number_of_control_points = safeGet(e, 'NumberOfControlPoints');
    props.number_of_fit_points = safeGet(e, 'NumberOfFitPoints');
  } else if (objName === 'AcDbEllipse') {
    const center = variantToArray(safeGet(e, 'Center'));
    if (center) props.center = center;
    props.area = safeGet(e, 'Area');
    props.major_radius = safeGet(e, 'MajorRadius');
    props.minor_radius = safeGet(e, 'MinorRadius');
    props.start_angle = safeGet(e, 'StartAngle');
    props.end_angle = safeGet(e, 'EndAngle');
  } else if (objName === 'AcDb3dSolid') {
    props.volume = safeGet(e, 'Volume');
    props.area = safeGet(e, 'Area');
  } else {
    // Fallback — probe common property names.
    for (const p of [
      'Length',
      'Area',
      'Volume',
      'Radius',
      'Coordinates',
      'TextString',
      'Name',
      'InsertionPoint',
    ]) {
      const val = safeGet<unknown>(e, p);
      if (val !== undefined && val !== null) {
        const key = p[0].toLowerCase() + p.slice(1);
        props[key] = Array.isArray(val) ? val : val;
      }
    }
  }

  // Strip null/undefined for cleaner output, matching Python behavior.
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v !== null && v !== undefined) cleaned[k] = v;
  }
  return cleaned;
}
