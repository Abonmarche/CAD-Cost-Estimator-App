import { useCallback, useState } from 'react';

import type {
  EstimateExport,
  PayItem,
  PayItemUpdate,
} from '@shared/types';
import { MEASUREMENT_UNITS } from '@shared/constants';
import { buildPayItemDescription } from '@shared/presets';

/**
 * High-level lifecycle hook that drives measure → price → export.
 *
 * Strategy:
 *   1. Send pending items to main for deterministic measurement.
 *   2. As each `complete` item comes back, fetch unit price from CostEstDB.
 *   3. Once all items are complete or flagged, user can export.
 */
export function useEstimate(
  items: PayItem[],
  applyUpdate: (u: PayItemUpdate) => void,
) {
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);

  const measure = useCallback(() => {
    const pending = items.filter((i) => i.status === 'pending');
    if (pending.length === 0) return;

    setRunning(true);
    const unsubscribe = window.costEstimator.measure(
      { items: pending },
      async (update) => {
        if ('__done' in update && update.__done) {
          setRunning(false);
          unsubscribe();
          return;
        }
        if ('__error' in update && update.__error) {
          console.error('Measurement failed:', update.__error);
          setRunning(false);
          unsubscribe();
          return;
        }

        const u = update as PayItemUpdate;
        applyUpdate(u);

        // Kick off pricing for newly-complete items (skip flagged — user
        // will resolve first). Merge the measurement patch into the item
        // before pricing so the description reflects auto-detected fields
        // like the inferred diameter.
        if (u.patch.status === 'complete' && u.patch.quantity !== null) {
          const item = pending.find((p) => p.id === u.id);
          if (item) {
            const qty = u.patch.quantity ?? 0;
            const measured = { ...item, ...u.patch };
            void fetchPrice(measured, qty).then((patch) =>
              applyUpdate({ id: u.id, patch }),
            );
          }
        }

        // Any spawned items (e.g. auto-diameter split) arrive already
        // `complete` with their own quantity — price each one directly.
        if (u.spawn) {
          for (const spawned of u.spawn) {
            const qty = spawned.quantity ?? 0;
            if (qty > 0) {
              void fetchPrice(spawned, qty).then((patch) =>
                applyUpdate({ id: spawned.id, patch }),
              );
            }
          }
        }
      },
    );
  }, [items, applyUpdate]);

  const exportEstimate = useCallback(async (payload: EstimateExport) => {
    setExporting(true);
    try {
      return await window.costEstimator.exportEstimate(payload);
    } finally {
      setExporting(false);
    }
  }, []);

  return { running, exporting, measure, exportEstimate };
}

async function fetchPrice(
  item: PayItem,
  quantity: number,
): Promise<Partial<PayItem>> {
  try {
    const description = buildPayItemDescription(item);
    const result = await window.costEstimator.priceLookup({
      description,
      unit: MEASUREMENT_UNITS[item.measurement],
      quantity,
    });
    if (result.unitPrice !== null) {
      return {
        unitPrice: result.unitPrice,
        totalCost:
          Math.round(quantity * result.unitPrice * 100) / 100,
        priceSource: result.source,
      };
    }
    return { unitPrice: null };
  } catch {
    return { unitPrice: null };
  }
}
