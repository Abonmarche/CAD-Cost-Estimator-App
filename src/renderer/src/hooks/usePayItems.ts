import { useCallback, useState } from 'react';

import type {
  PayItem,
  PayItemPreset,
  PayItemUpdate,
  ResolveMessage,
} from '@shared/types';
import { OBJECT_TYPE_OPTIONS } from '@shared/constants';

/**
 * Unique id generator — good enough for a client-side list.
 */
function makeId(): string {
  return `item_${Math.random().toString(36).slice(2, 10)}`;
}

export function usePayItems() {
  const [items, setItems] = useState<PayItem[]>([]);

  const addItem = useCallback((preset: PayItemPreset) => {
    const newItem: PayItem = {
      ...preset,
      id: makeId(),
      layer: preset.defaultLayer || '',
      status: 'pending',
      quantity: null,
      unitPrice: null,
      totalCost: null,
      flagMessage: null,
      flagOptions: null,
    };
    setItems((prev) => [...prev, newItem]);
  }, []);

  const updateItem = useCallback(
    (id: string, patch: Partial<PayItem>) => {
      setItems((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item;
          const merged = { ...item, ...patch };
          // If the user edits the object type, keep measurement in sync.
          if (patch.objectType && !patch.measurement) {
            const opt = OBJECT_TYPE_OPTIONS.find(
              (o) => o.value === patch.objectType,
            );
            if (opt) merged.measurement = opt.measurement;
          }
          // Edits reset the measurement state so we can re-measure cleanly.
          if (
            patch.layer !== undefined ||
            patch.objectType !== undefined ||
            patch.material !== undefined ||
            patch.diameter !== undefined ||
            patch.thickness !== undefined
          ) {
            // Only reset if it wasn't already in a terminal state; resolution
            // updates come through this path too, so guard on explicit fields.
            const resetTriggered =
              patch.layer !== undefined || patch.objectType !== undefined;
            if (resetTriggered && merged.status === 'complete') {
              merged.status = 'pending';
              merged.quantity = null;
              merged.flagMessage = null;
              merged.flagOptions = null;
            }
          }
          return merged;
        }),
      );
    },
    [],
  );

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const applyUpdate = useCallback((update: PayItemUpdate) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === update.id ? { ...item, ...update.patch } : item,
      ),
    );
  }, []);

  /**
   * User clicked a quick-pick option or typed a response to a flagged item.
   * Stream the assistant's messages back and apply any final resolution.
   */
  const resolveFlag = useCallback(
    (id: string, userInput: string, onMessage?: (m: ResolveMessage) => void) => {
      setItems((prev) => {
        const item = prev.find((i) => i.id === id);
        if (!item) return prev;
        // Optimistically update the UI to a "processing" state.
        const updated = prev.map((i) =>
          i.id === id ? { ...i, status: 'processing' as const } : i,
        );
        window.costEstimator.resolve({ itemId: id, userInput, item }, (msg) => {
          onMessage?.(msg);
          if (msg.kind === 'final' && msg.resolution) {
            applyUpdate({
              id,
              patch: {
                status: 'complete',
                quantity:
                  msg.resolution.quantity ??
                  prev.find((x) => x.id === id)?.quantity ??
                  null,
                unitPrice:
                  msg.resolution.unitPrice ??
                  prev.find((x) => x.id === id)?.unitPrice ??
                  null,
                resolutionNotes: msg.resolution.notes,
                flagMessage: null,
                flagOptions: null,
              },
            });
          } else if (msg.kind === 'error') {
            applyUpdate({
              id,
              patch: { status: 'flagged', flagMessage: msg.text ?? 'Resolution failed' },
            });
          }
        });
        return updated;
      });
    },
    [applyUpdate],
  );

  const setManualQuantity = useCallback(
    async (id: string, quantity: number, notes?: string) => {
      const update = await window.costEstimator.setManual({
        itemId: id,
        quantity,
        notes,
      });
      applyUpdate(update);
    },
    [applyUpdate],
  );

  const clearAll = useCallback(() => {
    setItems([]);
  }, []);

  return {
    items,
    addItem,
    updateItem,
    removeItem,
    clearAll,
    applyUpdate,
    resolveFlag,
    setManualQuantity,
  };
}
