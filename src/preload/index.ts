/**
 * Preload — runs in the renderer before the page loads, with access to both
 * Electron APIs and the DOM. We use `contextBridge` to expose a narrow,
 * typed API to the renderer. The renderer has `contextIsolation: true` and
 * no Node access otherwise.
 */

import { contextBridge, ipcRenderer } from 'electron';

import type {
  EstimateExport,
  MeasurePayload,
  PayItemUpdate,
  PriceLookupPayload,
  PriceLookupResult,
  ResolveMessage,
  ResolvePayload,
  ServerStatus,
  SetManualPayload,
  LayerInfo,
} from '../shared/types';
import { IPC_CHANNELS } from '../shared/constants';

type Unsubscribe = () => void;

export interface CostEstimatorApi {
  getAutocadStatus(): Promise<ServerStatus>;
  listLayers(): Promise<
    | { success: true; layers: LayerInfo[] }
    | { success: false; error: string }
  >;
  measure(
    payload: MeasurePayload,
    onUpdate: (u: PayItemUpdate | { __done?: true; __error?: string }) => void,
  ): Unsubscribe;
  resolve(
    payload: ResolvePayload,
    onMessage: (m: ResolveMessage) => void,
  ): Unsubscribe;
  setManual(payload: SetManualPayload): Promise<PayItemUpdate>;
  priceLookup(payload: PriceLookupPayload): Promise<PriceLookupResult>;
  exportEstimate(
    payload: EstimateExport,
  ): Promise<
    | { success: true; filePath: string }
    | { success: false; error: string }
  >;
}

const api: CostEstimatorApi = {
  getAutocadStatus: () => ipcRenderer.invoke(IPC_CHANNELS.AutocadStatus),

  listLayers: () => ipcRenderer.invoke(IPC_CHANNELS.ListLayers),

  measure: (payload, onUpdate) => {
    const handler = (_e: Electron.IpcRendererEvent, u: unknown) => {
      onUpdate(u as PayItemUpdate);
    };
    ipcRenderer.on(IPC_CHANNELS.EstimateMeasureUpdate, handler);
    ipcRenderer.send(IPC_CHANNELS.EstimateMeasure, payload);
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.EstimateMeasureUpdate, handler);
  },

  resolve: (payload, onMessage) => {
    const handler = (_e: Electron.IpcRendererEvent, m: unknown) => {
      const msg = m as ResolveMessage;
      if (msg.itemId === payload.itemId) onMessage(msg);
    };
    ipcRenderer.on(IPC_CHANNELS.EstimateResolveMessage, handler);
    ipcRenderer.send(IPC_CHANNELS.EstimateResolve, payload);
    return () =>
      ipcRenderer.removeListener(IPC_CHANNELS.EstimateResolveMessage, handler);
  },

  setManual: (payload) => ipcRenderer.invoke(IPC_CHANNELS.EstimateSetManual, payload),

  priceLookup: (payload) =>
    ipcRenderer.invoke(IPC_CHANNELS.EstimatePrice, payload),

  exportEstimate: (payload) =>
    ipcRenderer.invoke(IPC_CHANNELS.EstimateExport, payload),
};

contextBridge.exposeInMainWorld('costEstimator', api);
