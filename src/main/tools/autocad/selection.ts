/**
 * Fast entity selection via AutoCAD's SelectionSet + DXF filter.
 *
 * Iterating ModelSpace by index (`ms.Item(i)`) is catastrophically slow —
 * each COM call takes ~60 ms, so a 2,000-entity drawing runs for minutes.
 * SelectionSet.Select with a DXF filter pushes filtering down to AutoCAD,
 * which returns only the matching entities. A full "select all polylines
 * on a layer" drops from ~150s to ~40ms.
 *
 * Two winax/VARIANT gotchas we hit during discovery:
 *   1. `FilterType` must be a SAFEARRAY of Int16. Plain JS arrays marshal
 *      as VT_VARIANT arrays and AutoCAD rejects them. Use
 *      `new Variant(codes, 'short')`. `'i2'` (the canonical COM tag) is
 *      also rejected — only `'short'` works with this winax build.
 *   2. COM method proxies from winax cannot be detached via `.call` —
 *      call `ss.Select(...)` directly on the object.
 */

import { getAutocadInstance } from './connection';

// winax is loaded via require() so we can access the Variant constructor
// without polluting module scope with a top-level import that would fire
// at app boot.
type WinaxModule = {
  Variant: new (value: unknown, type: string) => unknown;
};
let winaxMod: WinaxModule | null = null;
function getWinax(): WinaxModule {
  if (winaxMod) return winaxMod;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  winaxMod = require('winax') as WinaxModule;
  return winaxMod;
}

export interface EntityFilter {
  /** DXF group 8 — exact layer name. Omit to match every layer. */
  layer?: string;
  /** DXF group 0 — entity type names, e.g. `['LWPOLYLINE', 'POLYLINE']`. */
  dxfTypes?: string[];
}

/** Unique name for our short-lived selection set. Keeps us from colliding
 *  with any that a LISP script or other addon may have left behind. */
const SS_NAME = 'abmCostEstimator';

/**
 * Count how many entities match a filter WITHOUT materialising them.
 *
 * Reading `ss.Count` is a single cheap COM call. Iterating `ss.Item(i)`
 * — as `selectEntities` below does — is ~60ms per entity, so avoid it
 * when you only need the count (e.g. sibling-layer probing, flagging
 * heuristics).
 */
export function countEntities(filter: EntityFilter): number {
  const { doc } = getAutocadInstance();
  const winax = getWinax();

  const setsCollection = (doc as { SelectionSets: Record<string, unknown> })
    .SelectionSets;
  try {
    (setsCollection as { Item: (name: string) => { Delete: () => void } })
      .Item(SS_NAME)
      .Delete();
  } catch {
    /* no prior set */
  }
  const ss = (
    setsCollection as { Add: (name: string) => Record<string, unknown> }
  ).Add(SS_NAME);

  try {
    const codes: number[] = [];
    const values: string[] = [];
    if (filter.layer) {
      codes.push(8);
      values.push(filter.layer);
    }
    if (filter.dxfTypes && filter.dxfTypes.length > 0) {
      codes.push(0);
      values.push(filter.dxfTypes.join(','));
    }

    if (codes.length === 0) {
      (ss as { Select: (mode: number) => void }).Select(5);
    } else {
      const codesV = new winax.Variant(codes, 'short');
      const valuesV = new winax.Variant(values, 'bstr');
      (
        ss as {
          Select: (
            mode: number,
            p1: unknown,
            p2: unknown,
            codes: unknown,
            values: unknown,
          ) => void;
        }
      ).Select(5, null, null, codesV, valuesV);
    }
    return (ss as { Count: number }).Count ?? 0;
  } finally {
    try {
      (ss as { Delete: () => void }).Delete();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Run a DXF-filtered selection and return the matched entities as live
 * COM proxies. The selection set is deleted on exit so repeated calls
 * don't accumulate state in the drawing.
 */
export function selectEntities(filter: EntityFilter): unknown[] {
  const { doc } = getAutocadInstance();
  const winax = getWinax();

  // Clean up an orphan set from a previous crashed run, then re-add.
  const setsCollection = (doc as { SelectionSets: Record<string, unknown> })
    .SelectionSets;
  try {
    (setsCollection as { Item: (name: string) => { Delete: () => void } })
      .Item(SS_NAME)
      .Delete();
  } catch {
    /* no prior set — ignore */
  }
  const ss = (setsCollection as {
    Add: (name: string) => Record<string, unknown>;
  }).Add(SS_NAME);

  try {
    const codes: number[] = [];
    const values: string[] = [];
    if (filter.layer) {
      codes.push(8);
      values.push(filter.layer);
    }
    if (filter.dxfTypes && filter.dxfTypes.length > 0) {
      codes.push(0);
      values.push(filter.dxfTypes.join(','));
    }

    const selectFn = (
      ss as {
        Select: (
          mode: number,
          p1: unknown,
          p2: unknown,
          codes: unknown,
          values: unknown,
        ) => void;
      }
    ).Select;
    // Don't detach selectFn — call Select on ss directly (see file header).
    if (codes.length === 0) {
      (ss as { Select: (mode: number) => void }).Select(5);
    } else {
      const codesV = new winax.Variant(codes, 'short');
      const valuesV = new winax.Variant(values, 'bstr');
      (
        ss as {
          Select: (
            mode: number,
            p1: unknown,
            p2: unknown,
            codes: unknown,
            values: unknown,
          ) => void;
        }
      ).Select(5, null, null, codesV, valuesV);
    }
    void selectFn; // silence unused — TypeScript helped us audit the shape

    const count = (ss as { Count: number }).Count ?? 0;
    const itemFn = ss as { Item: (i: number) => unknown };
    const out: unknown[] = [];
    for (let i = 0; i < count; i++) {
      try {
        out.push(itemFn.Item(i));
      } catch {
        /* skip individual marshal failures */
      }
    }
    return out;
  } finally {
    try {
      (ss as { Delete: () => void }).Delete();
    } catch {
      /* ignore */
    }
  }
}
