import type { LayerInfo } from '@shared/types';
import { getAutocadInstance, iterateCollection } from './connection';
import { safeGet } from './helpers';

/**
 * Enumerate every layer in the active document with its key properties.
 * Equivalent of the Python `get_all_layers`.
 *
 * Caveat: each property read is a ~60ms COM round-trip on winax. For a
 * drawing with 100+ layers this can cost 6+ seconds per call. Use
 * `listLayerNames` below when you only need the names (e.g. sibling-
 * layer discovery).
 */
export function listLayers(): LayerInfo[] {
  const { doc } = getAutocadInstance();
  const collection = (doc as { Layers?: Record<string, unknown> }).Layers;
  if (!collection) return [];

  const out: LayerInfo[] = [];
  for (const layer of iterateCollection<Record<string, unknown>>(collection)) {
    const info: LayerInfo = {
      name: safeGet<string>(layer, 'Name', '') ?? '',
      on: safeGet<boolean>(layer, 'LayerOn', true) ?? true,
      frozen: safeGet<boolean>(layer, 'Freeze', false) ?? false,
      locked: safeGet<boolean>(layer, 'Lock', false) ?? false,
      color: safeGet<number>(layer, 'Color', 7) ?? 7,
    };
    const linetype = safeGet<string>(layer, 'Linetype');
    if (linetype) info.linetype = linetype;
    const lineweight = safeGet<number>(layer, 'Lineweight');
    if (typeof lineweight === 'number') info.lineweight = lineweight;
    const desc = safeGet<string>(layer, 'Description');
    if (desc) info.description = desc;
    out.push(info);
  }
  // Sort alphabetically — easier to scan in the UI dropdowns.
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Return just the layer names. 1 COM call per layer instead of 8, which
 * matters when iterating 100+ layers to discover siblings during a
 * measurement batch.
 */
export function listLayerNames(): string[] {
  const { doc } = getAutocadInstance();
  const collection = (doc as { Layers?: Record<string, unknown> }).Layers;
  if (!collection) return [];
  const names: string[] = [];
  for (const layer of iterateCollection<Record<string, unknown>>(collection)) {
    const name = safeGet<string>(layer, 'Name');
    if (name) names.push(name);
  }
  names.sort((a, b) => a.localeCompare(b));
  return names;
}
