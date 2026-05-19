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

/**
 * Map an MCP tool name to a human-readable progress string. Shown in the
 * Estimator Assistant panel while a long-running resolution is mid-tool-
 * use so the user sees forward progress instead of a silent spinner.
 *
 * Only AutoCAD tools are listed — the agent intentionally has no
 * CostEstDB access (pricing is handled deterministically by the host
 * once a card is correct).
 */
function friendlyToolStatus(toolName: string): string {
  switch (toolName) {
    case 'mcp__autocad__list_layers':
      return 'Listing AutoCAD layers…';
    case 'mcp__autocad__get_entities_on_layer':
      return 'Reading entities from the drawing…';
    case 'mcp__autocad__get_entity_details':
      return 'Inspecting entity details…';
    case 'mcp__autocad__server_status':
      return 'Checking AutoCAD connection…';
    default:
      return `Running ${toolName.replace(/^mcp__[^_]+__/, '')}…`;
  }
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
      ...(preset.fields.includes('autoDiameter')
        ? { autoDiameterFromWidth: true }
        : {}),
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
            patch.extraLayers !== undefined ||
            patch.objectType !== undefined ||
            patch.material !== undefined ||
            patch.diameter !== undefined ||
            patch.thickness !== undefined ||
            patch.autoDiameterFromWidth !== undefined
          ) {
            // Only reset if it wasn't already in a terminal state; resolution
            // updates come through this path too, so guard on explicit fields.
            const resetTriggered =
              patch.layer !== undefined ||
              patch.extraLayers !== undefined ||
              patch.objectType !== undefined ||
              patch.autoDiameterFromWidth !== undefined;
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
    setItems((prev) => {
      const patched = prev.map((item) =>
        item.id === update.id ? { ...item, ...update.patch } : item,
      );
      if (update.spawn && update.spawn.length > 0) {
        // Slot spawned items immediately after the primary so the user
        // reads the auto-diameter split as one logical group.
        const primaryIndex = patched.findIndex((i) => i.id === update.id);
        if (primaryIndex === -1) {
          return [...patched, ...update.spawn];
        }
        return [
          ...patched.slice(0, primaryIndex + 1),
          ...update.spawn,
          ...patched.slice(primaryIndex + 1),
        ];
      }
      return patched;
    });
  }, []);

  /**
   * User clicked a quick-pick option or typed a response to a flagged item.
   * Stream the assistant's messages back and apply any final resolution.
   *
   * Message handling:
   *   - 'assistant' text: live-update the panel's message so the user sees
   *     the agent speaking instead of staring at a silent spinner.
   *   - 'tool_use': show a one-line status like "Checking layer W-SERV…" so
   *     long resolutions show progress.
   *   - 'final' with structured resolution: mark item complete. (The SDK
   *     doesn't currently emit a structured resolution — kept for the day
   *     we add a parser. Most finals land in the free-form branch below.)
   *   - 'final' without resolution: put the item back into flagged state
   *     with the agent's free-form answer as flagMessage. The user reads
   *     it and either replies, manually sets a quantity, or moves on. This
   *     was the spin-forever bug — we used to silently ignore this case.
   *   - 'error': re-flag with the error message.
   */
  const resolveFlag = useCallback(
    (id: string, userInput: string, onMessage?: (m: ResolveMessage) => void) => {
      setItems((prev) => {
        const item = prev.find((i) => i.id === id);
        if (!item) return prev;
        // Optimistically update the UI to a "processing" state. Clear the
        // flagOptions so quick-pick buttons can't fire a second resolution
        // while one is in flight; new options come back with the next turn.
        const updated = prev.map((i) =>
          i.id === id
            ? { ...i, status: 'processing' as const, flagOptions: null }
            : i,
        );
        window.costEstimator.resolve({ itemId: id, userInput, item }, (msg) => {
          onMessage?.(msg);
          if (msg.kind === 'assistant' && msg.text) {
            // Live progress — replace the panel message with what the
            // agent just said. Keep status as processing.
            applyUpdate({
              id,
              patch: { flagMessage: msg.text, flagOptions: null },
            });
          } else if (msg.kind === 'tool_use' && msg.toolName) {
            applyUpdate({
              id,
              patch: {
                flagMessage: friendlyToolStatus(msg.toolName),
                flagOptions: null,
              },
            });
          } else if (msg.kind === 'final' && msg.resolution) {
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
          } else if (msg.kind === 'final') {
            // Free-form final answer — re-flag with the agent's text so
            // the user can read it and either continue the conversation
            // or fall back to manual entry. Always offer the manual
            // escape hatch in this case.
            applyUpdate({
              id,
              patch: {
                status: 'flagged',
                flagMessage: msg.text?.trim() || 'Assistant finished without a clear answer.',
                flagOptions: ['Set quantity manually'],
              },
            });
          } else if (msg.kind === 'error') {
            applyUpdate({
              id,
              patch: {
                status: 'flagged',
                flagMessage: msg.text ?? 'Resolution failed',
                flagOptions: ['Set quantity manually'],
              },
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
