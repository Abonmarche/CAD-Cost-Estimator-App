/**
 * IPC routes between the renderer and the main process.
 *
 * Two categories of channels:
 *   - request/reply (ipcMain.handle) for simple queries (status, layers, price)
 *   - request + stream (sender.send) for long-running operations that emit
 *     multiple updates (measure, resolve)
 */

import { BrowserWindow, ipcMain } from 'electron';

import type {
  MeasurePayload,
  PayItemUpdate,
  PriceLookupPayload,
  PriceLookupResult,
  ResolvePayload,
  ServerStatus,
  SetManualPayload,
} from '@shared/types';
import { IPC_CHANNELS } from '@shared/constants';

import { getServerStatus } from './tools/autocad/status';
import { listLayers } from './tools/autocad/layers';
import { measureAll } from './measurement';
import { priceLookup } from './pricing';
import { exportEstimate } from './export';
import { resolvePayItem } from './agent';

export interface IpcContext {
  getMainWindow(): BrowserWindow | null;
}

export function registerIpcHandlers(ctx: IpcContext): void {
  ipcMain.handle(IPC_CHANNELS.AutocadStatus, async (): Promise<ServerStatus> => {
    return getServerStatus();
  });

  ipcMain.handle(IPC_CHANNELS.ListLayers, async () => {
    try {
      return { success: true as const, layers: listLayers() };
    } catch (e) {
      return { success: false as const, error: (e as Error).message };
    }
  });

  // Streaming measurement — renderer invokes, we push updates via
  // `EstimateMeasureUpdate` until done.
  ipcMain.on(IPC_CHANNELS.EstimateMeasure, (event, payload: MeasurePayload) => {
    const sender = event.sender;
    // Fire-and-forget — the generator is synchronous COM iteration, but we
    // still want setImmediate batching so the renderer can paint between
    // items on large estimates.
    (async () => {
      try {
        for (const update of measureAll(payload.items)) {
          if (sender.isDestroyed()) return;
          sender.send(IPC_CHANNELS.EstimateMeasureUpdate, update);
          await new Promise<void>((r) => setImmediate(r));
        }
        if (!sender.isDestroyed()) {
          sender.send(IPC_CHANNELS.EstimateMeasureUpdate, {
            __done: true,
          });
        }
      } catch (e) {
        if (!sender.isDestroyed()) {
          sender.send(IPC_CHANNELS.EstimateMeasureUpdate, {
            __error: (e as Error).message,
          });
        }
      }
    })();
  });

  ipcMain.on(IPC_CHANNELS.EstimateResolve, (event, payload: ResolvePayload) => {
    const sender = event.sender;
    (async () => {
      try {
        for await (const msg of resolvePayItem(payload)) {
          if (sender.isDestroyed()) return;
          sender.send(IPC_CHANNELS.EstimateResolveMessage, msg);
        }
      } catch (e) {
        if (!sender.isDestroyed()) {
          sender.send(IPC_CHANNELS.EstimateResolveMessage, {
            itemId: payload.itemId,
            kind: 'error',
            text: (e as Error).message,
          });
        }
      }
    })();
  });

  ipcMain.handle(
    IPC_CHANNELS.EstimateSetManual,
    async (_event, payload: SetManualPayload): Promise<PayItemUpdate> => {
      return {
        id: payload.itemId,
        patch: {
          status: 'complete',
          quantity: payload.quantity,
          flagMessage: null,
          flagOptions: null,
          resolutionNotes: payload.notes,
        },
      };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.EstimatePrice,
    async (_event, payload: PriceLookupPayload): Promise<PriceLookupResult> => {
      return priceLookup(payload);
    },
  );

  ipcMain.handle(IPC_CHANNELS.EstimateExport, async (_event, payload) => {
    try {
      const win = ctx.getMainWindow();
      const filePath = await exportEstimate(payload, win);
      return { success: true as const, filePath };
    } catch (e) {
      return { success: false as const, error: (e as Error).message };
    }
  });
}
