/**
 * Excel export for completed estimates.
 *
 * Generates a new workbook from scratch using exceljs. We styled it to
 * match Abonmarche's estimate template — Century Gothic headers, Navy/Red
 * accent, totals at the bottom.
 */

import { BrowserWindow, dialog } from 'electron';
import ExcelJS from 'exceljs';

import type { EstimateExport } from '@shared/types';
import { MEASUREMENT_UNITS } from '@shared/constants';
import { buildPayItemDescription } from '@shared/presets';

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

  const sheet = workbook.addWorksheet('Estimate', {
    properties: { defaultColWidth: 14 },
  });

  // Header band
  sheet.mergeCells('A1:G1');
  const title = sheet.getCell('A1');
  title.value = estimate.projectName || 'Cost Estimate';
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

  sheet.mergeCells('A2:G2');
  const subtitle = sheet.getCell('A2');
  subtitle.value = `Generated ${new Date(estimate.exportDate).toLocaleString()}`;
  subtitle.font = { name: 'Century Gothic', size: 10, italic: true };

  // Column headers
  const HEADERS = [
    'Item #',
    'Pay Item Description',
    'Unit',
    'Quantity',
    'Unit Price',
    'Extended Cost',
    'Source / Notes',
  ];
  const headerRow = sheet.addRow([]);
  headerRow.values = ['', ...HEADERS]; // shift (addRow with header row = row 4)
  // Actually write headers in row 4
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

  // Column widths
  sheet.columns = [
    { key: 'item', width: 8 },
    { key: 'desc', width: 42 },
    { key: 'unit', width: 8 },
    { key: 'qty', width: 12 },
    { key: 'price', width: 14 },
    { key: 'ext', width: 16 },
    { key: 'notes', width: 40 },
  ];

  const dataStartRow = 5;
  let dataRow = dataStartRow;
  estimate.items.forEach((item, idx) => {
    if (item.status === 'error' || item.status === 'pending') return;
    const desc = buildPayItemDescription(item);
    const unit = MEASUREMENT_UNITS[item.measurement];
    const qty = item.quantity ?? 0;
    const price = item.unitPrice ?? 0;
    const ext = qty * price;
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

  // Total row
  sheet.addRow([]);
  const totalRow = sheet.addRow([
    '',
    'Total',
    '',
    '',
    '',
    estimate.totalCost,
    '',
  ]);
  totalRow.getCell(6).numFmt = '$#,##0.00';
  totalRow.font = {
    name: 'Century Gothic',
    size: 12,
    bold: true,
    color: { argb: ABONMARCHE_NAVY },
  };
  totalRow.getCell(2).alignment = { horizontal: 'right' };
  // Explicit formula override — keeps Excel in sync if users tweak numbers:
  if (lastDataRow >= dataStartRow) {
    totalRow.getCell(6).value = {
      formula: `SUM(F${dataStartRow}:F${lastDataRow})`,
      result: estimate.totalCost,
    };
  }

  await workbook.xlsx.writeFile(result.filePath);
  return result.filePath;
}
