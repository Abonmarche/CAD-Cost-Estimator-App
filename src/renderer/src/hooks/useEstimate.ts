import { useCallback, useState } from 'react';

import type {
  EstimateExport,
  PayItem,
  PayItemUpdate,
} from '@shared/types';
import { MEASUREMENT_UNITS } from '@shared/constants';
import { buildPayItemDescription } from '@shared/presets';

/**
 * Workflow lifecycle hook. Splits the estimating pipeline into three
 * discrete user-driven steps:
 *
 *   1. measure()        — IPC-driven measurement against the open AutoCAD
 *                          drawing. Sets quantity + status='complete' on
 *                          each item. Does NOT price anything anymore.
 *   2. priceAll()       — Walks every complete-but-unpriced item and asks
 *                          CostEstDB for a unit price. Sets unitPrice,
 *                          totalCost, priceSource, and marks
 *                          pricingAttempted=true regardless of outcome.
 *   3. exportEstimate() — Writes the Excel file via the main process.
 *
 * Earlier versions chained measurement → pricing automatically inside
 * measure(). That was convenient but blurred the user's mental model
 * (and made the "Generate estimate" button feel meaningless). v0.5.0
 * separates them so each button click does one well-defined thing.
 */
export function useEstimate(
  items: PayItem[],
  applyUpdate: (u: PayItemUpdate) => void,
) {
  const [running, setRunning] = useState(false);
  const [pricing, setPricing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const measure = useCallback(() => {
    const pending = items.filter((i) => i.status === 'pending');
    if (pending.length === 0) return;

    setRunning(true);
    const unsubscribe = window.costEstimator.measure(
      { items: pending },
      (update) => {
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

        // Apply the measurement patch. Pricing intentionally does NOT
        // run here anymore — the user kicks it off explicitly via the
        // "Generate estimate" button.
        applyUpdate(update as PayItemUpdate);
      },
    );
  }, [items, applyUpdate]);

  /**
   * Look up unit prices for every complete item that hasn't been priced
   * yet (or whose previous lookup wasn't attempted). Idempotent — re-
   * clicking only retries items still missing a successful lookup.
   *
   * Items where CostEstDB has no match keep `unitPrice: null` but get
   * `pricingAttempted: true` so the workflow can advance to export.
   */
  const priceAll = useCallback(() => {
    const targets = items.filter(
      (i) =>
        i.status === 'complete' &&
        i.unitPrice === null &&
        !i.pricingAttempted,
    );
    if (targets.length === 0) return;

    setPricing(true);
    Promise.allSettled(
      targets.map(async (item) => {
        const qty = item.quantity ?? 0;
        const patch = await fetchPrice(item, qty);
        applyUpdate({
          id: item.id,
          patch: { ...patch, pricingAttempted: true },
        });
      }),
    ).finally(() => setPricing(false));
  }, [items, applyUpdate]);

  const exportEstimate = useCallback(async (payload: EstimateExport) => {
    setExporting(true);
    try {
      return await window.costEstimator.exportEstimate(payload);
    } finally {
      setExporting(false);
    }
  }, []);

  return {
    running,
    pricing,
    exporting,
    measure,
    priceAll,
    exportEstimate,
  };
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
