/**
 * Excel export for completed estimates.
 *
 * Two modes:
 *   - Single-sheet (Indiana default): one "Estimate" worksheet with every
 *     completed pay item and a grand total.
 *   - Multi-sheet (Michigan): "Total" + one worksheet per discovered plan
 *     sheet + "Unassigned" for anything outside every sheet polygon.
 *
 * Per-sheet quantities are computed by the geometry layer in
 * `per-sheet.ts` — see that module for the clipping math. Unit prices are
 * per-unit and don't change across sheets; only quantities (and therefore
 * extended costs) differ.
 */

import { BrowserWindow, dialog } from 'electron';
import ExcelJS from 'exceljs';

import type { EstimateExport, PayItem } from '@shared/types';
import { MEASUREMENT_UNITS } from '@shared/constants';
import { buildPayItemDescription } from '@shared/presets';

import {
  findSheetBoundaries,
  sheetIdFromNumber,
  toSheetPolygons,
  type SheetBoundary,
} from './tools/autocad/sheets';
import {
  measurePerSheet,
  type PerSheetMeasurement,
} from './per-sheet';
import { UNASSIGNED_ID } from './clipping';

const ABONMARCHE_NAVY = 'FF0A2240';
const ABONMARCHE_RED = 'FFC40D3C';

export async function exportEstimate(
  estimate: EstimateExport,
  parent: BrowserWindow | null,
): Promise<string> {
  const safeProject = estimate.projectName
    ? estimate.projectName.replace(/[^A-Za-z0-9 _.-]/g, '').trim() ||
      'Estimate'
    : 'Estimate';

  const dialogOpts: Electron.SaveDialogOptions = {
    title: 'Save Estimate',
    defaultPath: `${safeProject} - Estimate.xlsx`,
    filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
  };
  const result = parent
    ? await dialog.showSaveDialog(parent, dialogOpts)
    : await dialog.showSaveDialog(dialogOpts);
  if (result.canceled || !result.filePath) {
    throw new Error('Export cancelled');
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Cost Estimator';
  workbook.created = new Date();

  const wantsBreakdown = estimate.sheetExport?.enabled === true;
  const boundaries = wantsBreakdown
    ? safelyDiscoverSheets(estimate.sheetExport!.prefix)
    : [];

  if (wantsBreakdown && boundaries.length > 0) {
    writeMultiSheet(workbook, estimate, boundaries);
  } else {
    if (wantsBreakdown) {
      console.warn(
        `[export] Sheet breakdown enabled but no layers matched prefix "${estimate.sheetExport?.prefix}". Falling back to single-sheet export.`,
      );
    }
    writeEstimateWorksheet(workbook, 'Estimate', {
      title: estimate.projectName || 'Cost Estimate',
      exportDate: estimate.exportDate,
      items: estimate.items,
    });
  }

  await workbook.xlsx.writeFile(result.filePath);
  return result.filePath;
}

/**
 * Wrap `findSheetBoundaries` so a COM hiccup during discovery doesn't kill
 * the export — the user gets a single-sheet workbook with a console
 * warning instead of an opaque failure.
 */
function safelyDiscoverSheets(prefix: string): SheetBoundary[] {
  try {
    return findSheetBoundaries(prefix);
  } catch (e) {
    console.warn(
      `[export] Sheet boundary discovery failed: ${(e as Error).message}. Falling back to single-sheet export.`,
    );
    return [];
  }
}

function writeMultiSheet(
  workbook: ExcelJS.Workbook,
  estimate: EstimateExport,
  boundaries: SheetBoundary[],
): void {
  const sheetPolygons = toSheetPolygons(boundaries);
  const allocations = measurePerSheet(estimate.items, sheetPolygons);
  const allocationMap = new Map<string, PerSheetMeasurement>();
  for (const a of allocations) allocationMap.set(a.itemId, a);

  // Total — unchanged items, full quantities.
  writeEstimateWorksheet(workbook, 'Total', {
    title: `${estimate.projectName || 'Cost Estimate'} - Total`,
    exportDate: estimate.exportDate,
    items: estimate.items,
  });

  // One worksheet per sheet polygon, in number order.
  for (const sheet of boundaries) {
    const sheetItems = applyAllocation(
      estimate.items,
      allocationMap,
      sheetIdFromNumber(sheet.number),
    );
    if (sheetItems.length === 0) continue;
    writeEstimateWorksheet(workbook, `Sheet ${sheet.number}`, {
      title: `${estimate.projectName || 'Cost Estimate'} - Sheet ${sheet.number}`,
      exportDate: estimate.exportDate,
      items: sheetItems,
    });
  }

  // Unassigned — entities that didn't fit any sheet polygon, plus items
  // with no AutoCAD source (manual quantities default here).
  const unassignedItems = applyAllocation(
    estimate.items,
    allocationMap,
    UNASSIGNED_ID,
  );
  if (unassignedItems.length > 0) {
    writeEstimateWorksheet(workbook, 'Unassigned', {
      title: `${estimate.projectName || 'Cost Estimate'} - Unassigned`,
      exportDate: estimate.exportDate,
      items: unassignedItems,
    });
  }
}

/**
 * Project the full item list onto one sheet (or "unassigned") by scaling
 * each item's quantity by its per-sheet fraction. Items with zero
 * contribution are dropped so per-sheet worksheets only list lines that
 * actually appear on that sheet.
 */
function applyAllocation(
  items: PayItem[],
  allocations: Map<string, PerSheetMeasurement>,
  bucketId: string,
): PayItem[] {
  const out: PayItem[] = [];
  for (const item of items) {
    if (item.status !== 'complete') continue;
    if (item.quantity === null || item.quantity === 0) continue;
    const alloc = allocations.get(item.id);
    const fraction =
      bucketId === UNASSIGNED_ID
        ? (alloc?.unassigned ?? 1)
        : (alloc?.bySheet[bucketId] ?? 0);
    if (fraction <= 0) continue;
    const scaledQty = roundQty(item.quantity * fraction);
    if (scaledQty === 0) continue;
    out.push({
      ...item,
      quantity: scaledQty,
      totalCost:
        item.unitPrice !== null ? roundCurrency(scaledQty * item.unitPrice) : null,
    });
  }
  return out;
}

function roundQty(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundCurrency(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------- Worksheet builder ----------

interface WorksheetSpec {
  title: string;
  exportDate: string;
  items: PayItem[];
}

const HEADERS = [
  'Item #',
  'Pay Item Description',
  'Unit',
  'Quantity',
  'Unit Price',
  'Extended Cost',
  'Source / Notes',
];

function writeEstimateWorksheet(
  workbook: ExcelJS.Workbook,
  worksheetName: string,
  spec: WorksheetSpec,
): void {
  const sheet = workbook.addWorksheet(worksheetName, {
    properties: { defaultColWidth: 14 },
  });

  // Title band
  sheet.mergeCells('A1:G1');
  const title = sheet.getCell('A1');
  title.value = spec.title;
  title.font = {
    name: 'Century Gothic',
    size: 16,
    bold: true,
    color: { argb: 'FFFFFFFF' },
  };
  title.alignment = { vertical: 'middle', horizontal: 'left' };
  title.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: ABONMARCHE_NAVY },
  };
  sheet.getRow(1).height = 28;

  // Subtitle
  sheet.mergeCells('A2:G2');
  const subtitle = sheet.getCell('A2');
  subtitle.value = `Generated ${new Date(spec.exportDate).toLocaleString()}`;
  subtitle.font = { name: 'Century Gothic', size: 10, italic: true };

  // Column headers
  sheet.getRow(4).values = HEADERS;
  const header = sheet.getRow(4);
  header.font = {
    name: 'Century Gothic',
    size: 11,
    bold: true,
    color: { argb: 'FFFFFFFF' },
  };
  header.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: ABONMARCHE_RED },
  };
  header.alignment = { vertical: 'middle', horizontal: 'center' };
  header.height = 22;

  sheet.columns = [
    { key: 'item', width: 8 },
    { key: 'desc', width: 42 },
    { key: 'unit', width: 8 },
    { key: 'qty', width: 12 },
    { key: 'price', width: 14 },
    { key: 'ext', width: 16 },
    { key: 'notes', width: 40 },
  ];

  // Data rows
  const dataStartRow = 5;
  let dataRow = dataStartRow;
  let runningTotal = 0;
  spec.items.forEach((item, idx) => {
    if (item.status === 'error' || item.status === 'pending') return;
    const desc = buildPayItemDescription(item);
    const unit = MEASUREMENT_UNITS[item.measurement];
    const qty = item.quantity ?? 0;
    const price = item.unitPrice ?? 0;
    const ext = qty * price;
    runningTotal += ext;
    const allLayers = [item.layer, ...(item.extraLayers ?? [])]
      .map((s) => (s ?? '').trim())
      .filter(Boolean);
    const notes = [
      allLayers.length > 1 ? `Layers: ${allLayers.join(', ')}` : null,
      item.priceSource ? `Source: ${item.priceSource}` : null,
      item.resolutionNotes ?? null,
    ]
      .filter(Boolean)
      .join(' — ');
    const row = sheet.addRow([idx + 1, desc, unit, qty, price, ext, notes]);
    row.getCell(4).numFmt = '#,##0.00';
    row.getCell(5).numFmt = '$#,##0.00';
    row.getCell(6).numFmt = '$#,##0.00';
    row.font = { name: 'Century Gothic', size: 10 };
    dataRow++;
  });

  const lastDataRow = dataRow - 1;

  sheet.addRow([]);
  const totalRow = sheet.addRow(['', 'Total', '', '', '', runningTotal, '']);
  totalRow.getCell(6).numFmt = '$#,##0.00';
  totalRow.font = {
    name: 'Century Gothic',
    size: 12,
    bold: true,
    color: { argb: ABONMARCHE_NAVY },
  };
  totalRow.getCell(2).alignment = { horizontal: 'right' };
  if (lastDataRow >= dataStartRow) {
    totalRow.getCell(6).value = {
      formula: `SUM(F${dataStartRow}:F${lastDataRow})`,
      result: runningTotal,
    };
  }
}
