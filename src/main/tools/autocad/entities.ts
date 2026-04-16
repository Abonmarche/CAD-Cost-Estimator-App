/**
 * Core measurement tool — select entities on a layer matching a given
 * object type, then accumulate counts/lengths/areas per type.
 *
 * Ported from Python `get_entities_on_layer` but switched from
 * ModelSpace iteration to a DXF-filtered SelectionSet for speed.
 * See `selection.ts` for the reason.
 */

import type { EntityRecord, EntitySummary } from '@shared/types';
import { extractSummaryProps, safeGet } from './helpers';
import { selectEntities } from './selection';

export interface GetEntitiesOptions {
  layer_name: string;
  /**
   * DXF-style entity-type names to filter by server-side. e.g.
   * `['LWPOLYLINE', 'POLYLINE']`. Accepts multiple — values are joined
   * with commas inside the AutoCAD filter.
   */
  dxf_types?: string[];
  /**
   * AcDb* ObjectName names to keep after selection. Used to narrow
   * further when the DXF filter is broader than what we actually want
   * (e.g. `LWPOLYLINE,POLYLINE` matches 2D and 3D polylines but the
   * user might only want `AcDbPolyline`).
   */
  object_name_filter?: string[];
  /**
   * If provided, only include closed (true) or open (false) polylines.
   * Non-polyline entities ignore this filter.
   */
  closed_filter?: boolean;
}

export interface GetEntitiesResult {
  summary: EntitySummary;
  entities: EntityRecord[];
}

/**
 * Fetch every entity on a layer that matches the supplied filters.
 */
export function getEntitiesOnLayer(
  opts: GetEntitiesOptions,
): GetEntitiesResult {
  const { layer_name, dxf_types, object_name_filter, closed_filter } = opts;

  // Server-side filter: drops 99%+ of entities before they ever cross COM.
  const raw = selectEntities({
    layer: layer_name,
    dxfTypes: dxf_types,
  });

  // Optional post-filter to narrow ObjectName further (e.g. exclude 3D
  // polylines when the user said "polyline (open)").
  const nameSet =
    object_name_filter && object_name_filter.length > 0
      ? new Set(object_name_filter)
      : null;

  const entities: EntityRecord[] = [];
  const typeCounts: Record<string, number> = {};
  const typeLengths: Record<string, number> = {};
  const typeAreas: Record<string, number> = {};

  for (const entity of raw as Record<string, unknown>[]) {
    const objName = safeGet<string>(entity, 'ObjectName', '') ?? '';
    if (nameSet && !nameSet.has(objName)) continue;

    if (closed_filter !== undefined && objName.includes('Polyline')) {
      const closed = safeGet<boolean>(entity, 'Closed', false) ?? false;
      if (closed !== closed_filter) continue;
    }

    typeCounts[objName] = (typeCounts[objName] ?? 0) + 1;

    const info = extractSummaryProps(entity);
    entities.push(info);

    if (typeof info.length === 'number') {
      typeLengths[objName] = (typeLengths[objName] ?? 0) + info.length;
    }
    if (typeof info.area === 'number') {
      typeAreas[objName] = (typeAreas[objName] ?? 0) + info.area;
    }
  }

  const summary: EntitySummary = {
    layer: layer_name,
    total_entities: entities.length,
    type_counts: typeCounts,
  };
  if (Object.keys(typeLengths).length > 0) {
    summary.total_lengths_by_type = roundMap(typeLengths);
  }
  if (Object.keys(typeAreas).length > 0) {
    summary.total_areas_by_type = roundMap(typeAreas);
  }

  // Polyline constant-width breakdown (civil drafting uses polyline width
  // to visually encode pipe diameter).
  const widthGroups: Record<
    string,
    { count: number; total_length: number }
  > = {};
  for (const ent of entities) {
    if (typeof ent.constant_width === 'number') {
      const key = String(ent.constant_width);
      const g =
        widthGroups[key] ??
        (widthGroups[key] = { count: 0, total_length: 0 });
      g.count += 1;
      if (typeof ent.length === 'number') g.total_length += ent.length;
    }
  }
  if (Object.keys(widthGroups).length > 0) {
    const sorted = Object.entries(widthGroups).sort(
      ([a], [b]) => Number(a) - Number(b),
    );
    summary.polyline_width_breakdown = Object.fromEntries(
      sorted.map(([w, g]) => [
        w,
        { count: g.count, total_length: round4(g.total_length) },
      ]),
    );
  }

  return { summary, entities };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function roundMap(m: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(m)) out[k] = round4(v);
  return out;
}
