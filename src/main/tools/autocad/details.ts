import { getAutocadInstance, iterateCollection } from './connection';
import { extractDetailedProperties, safeGet } from './helpers';

/**
 * Look up a single entity by its ObjectID and return a full property bag.
 *
 * AutoCAD's COM API has `doc.HandleToObject(handle)` but no direct lookup
 * by ObjectID, so we iterate ModelSpace. Most drawings are small enough
 * that this is fine; for large drawings the agent typically already has
 * a specific handful of ids to inspect.
 */
export function getEntityDetails(entityId: number): Record<string, unknown> {
  const { modelspace } = getAutocadInstance();
  for (const entity of iterateCollection<Record<string, unknown>>(modelspace)) {
    const id = safeGet<number>(entity, 'ObjectID');
    if (id === entityId) {
      return extractDetailedProperties(entity);
    }
  }
  throw new Error(`Entity with ObjectID ${entityId} not found in ModelSpace`);
}
