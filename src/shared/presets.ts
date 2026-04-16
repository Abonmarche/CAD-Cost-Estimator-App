import type { PayItemPreset } from './types';

/**
 * Pay item presets organised into categories for the form's preset picker.
 * Each preset pre-fills object type, measurement, default layer, and the
 * attribute fields the form row should display.
 *
 * Layer names are Abonmarche conventions. Users can override any of them
 * per-row — these are just sensible defaults.
 */
export interface PresetCategory {
  key: string;
  label: string;
  items: PayItemPreset[];
}

export const PRESETS: PresetCategory[] = [
  {
    key: 'utilities',
    label: 'Utilities',
    items: [
      { name: 'Water Main', objectType: 'polyline', measurement: 'linear', defaultLayer: 'W-MAIN', icon: '💧', fields: ['autoDiameter', 'diameter', 'material'] },
      { name: 'Sanitary Sewer', objectType: 'pipe', measurement: 'linear', defaultLayer: 'SS-PIPE', icon: '🟤', fields: ['diameter', 'material'] },
      { name: 'Storm Sewer', objectType: 'pipe', measurement: 'linear', defaultLayer: 'STM-PIPE', icon: '🌧', fields: ['diameter', 'material'] },
      { name: 'Water Service', objectType: 'polyline', measurement: 'linear', defaultLayer: 'W-SERV', icon: '💧', fields: ['diameter', 'material'] },
      { name: 'Water Fitting', objectType: 'block', measurement: 'count', defaultLayer: 'W-FTGS', icon: '🔧', fields: ['type', 'size'] },
      { name: 'Sanitary Manhole', objectType: 'block', measurement: 'count', defaultLayer: 'SS-MH', icon: '⭕', fields: ['depth', 'diameter'] },
      { name: 'Storm Manhole', objectType: 'block', measurement: 'count', defaultLayer: 'STM-MH', icon: '⭕', fields: ['depth', 'diameter'] },
      { name: 'Catch Basin', objectType: 'block', measurement: 'count', defaultLayer: 'STM-CB', icon: '🔲', fields: ['type'] },
    ],
  },
  {
    key: 'paving',
    label: 'Paving & Surface',
    items: [
      { name: 'HMA Surface', objectType: 'hatch', measurement: 'area', defaultLayer: 'PV-HMA', icon: '⬛', fields: ['course', 'thickness'] },
      { name: 'HMA Base', objectType: 'hatch', measurement: 'area', defaultLayer: 'PV-HMA-BASE', icon: '⬛', fields: ['thickness'] },
      { name: 'Aggregate Base', objectType: 'hatch', measurement: 'area', defaultLayer: 'PV-AGG', icon: '🪨', fields: ['thickness', 'material'] },
      { name: 'Concrete Pavement', objectType: 'closedPolyline', measurement: 'area', defaultLayer: 'PV-CONC', icon: '⬜', fields: ['thickness'] },
      { name: 'Curb & Gutter', objectType: 'polyline', measurement: 'linear', defaultLayer: 'PV-CURB', icon: '📏', fields: ['type'] },
    ],
  },
  {
    key: 'concrete',
    label: 'Sidewalk & Concrete',
    items: [
      { name: 'Sidewalk', objectType: 'closedPolyline', measurement: 'area', defaultLayer: 'SW-CONC', icon: '🚶', fields: ['thickness'] },
      { name: 'Curb Ramp', objectType: 'block', measurement: 'count', defaultLayer: 'SW-RAMP', icon: '♿', fields: ['type'] },
      { name: 'Driveway', objectType: 'closedPolyline', measurement: 'area', defaultLayer: 'SW-DRWY', icon: '🚗', fields: ['thickness', 'material'] },
    ],
  },
  {
    key: 'misc',
    label: 'Miscellaneous',
    items: [
      { name: 'Custom Linear', objectType: 'polyline', measurement: 'linear', defaultLayer: '', icon: '📐', fields: ['material'], custom: true },
      { name: 'Custom Area', objectType: 'hatch', measurement: 'area', defaultLayer: '', icon: '📐', fields: ['material'], custom: true },
      { name: 'Custom Count', objectType: 'block', measurement: 'count', defaultLayer: '', icon: '📐', fields: ['material'], custom: true },
    ],
  },
];

/**
 * Build a description for CostEstDB `search_pay_items`. Uses MDOT
 * terminology where possible (see costestdb-mcp-guide.md) because the
 * database contains MDOT bid tabs and the embedding model scores higher
 * with descriptive natural language enriched with MDOT item names.
 *
 * Example: `{ name: "Water Main", diameter: '8"', material: "DIP" }`
 *   → "Water Main, DI, 8 inch"
 */
export function buildPayItemDescription(item: {
  name: string;
  diameter?: string;
  material?: string;
  thickness?: string;
  spec?: string;
  size?: string;
  depth?: string;
  course?: string;
}): string {
  // Check if we have a known MDOT mapping for this pay item name.
  const mdot = MDOT_QUERY_MAP[item.name.toLowerCase()];
  if (mdot) {
    return mdot(item);
  }
  // Fallback: build a descriptive query from the item's attributes.
  const parts: string[] = [];
  parts.push(item.name);
  if (item.diameter) parts.push(normalizeDiameter(item.diameter));
  if (item.size && item.size !== item.diameter) parts.push(item.size);
  if (item.material) parts.push(normalizeMaterial(item.material));
  if (item.thickness) parts.push(item.thickness);
  if (item.course) parts.push(item.course);
  if (item.depth) parts.push(`${item.depth} deep`);
  if (item.spec) parts.push(item.spec);
  return parts.filter(Boolean).join(', ').replace(/\s+/g, ' ').trim();
}

/** Normalize "8\"" or "8" to "8 inch" for MDOT-style queries. */
function normalizeDiameter(d: string): string {
  const num = d.replace(/[""']/g, '').trim();
  return /^\d+$/.test(num) ? `${num} inch` : d;
}

/** Normalize material abbreviations to what MDOT uses. */
function normalizeMaterial(m: string): string {
  const upper = m.toUpperCase().trim();
  const map: Record<string, string> = {
    DIP: 'DI',
    'DUCTILE IRON': 'DI',
    PVC: 'PVC SDR 26',
    HDPE: 'HDPE',
    RCP: 'Cl IV',
    'REINFORCED CONCRETE': 'Cl IV',
  };
  return map[upper] ?? m;
}

type ItemAttrs = {
  name: string;
  diameter?: string;
  material?: string;
  thickness?: string;
  spec?: string;
  size?: string;
  depth?: string;
  course?: string;
};

/**
 * MDOT terminology mappings for common pay items.
 * Key = lowercase preset name. Value = function that builds the best
 * CostEstDB search query from the item's attributes.
 */
const MDOT_QUERY_MAP: Record<string, (item: ItemAttrs) => string> = {
  'water main': (i) => {
    const dia = i.diameter ? normalizeDiameter(i.diameter) : '';
    const mat = i.material ? normalizeMaterial(i.material) : 'DI';
    return `Water Main, ${mat}${dia ? ', ' + dia : ''}`.trim();
  },
  'sanitary sewer': (i) => {
    const dia = i.diameter ? normalizeDiameter(i.diameter) : '';
    const mat = i.material ? normalizeMaterial(i.material) : '';
    return `${dia} sanitary sewer${mat ? ' ' + mat : ''}`.trim();
  },
  'storm sewer': (i) => {
    const dia = i.diameter ? normalizeDiameter(i.diameter) : '';
    return `Sewer, Cl IV, ${dia}`.replace(/,\s*$/, '').trim();
  },
  'water service': (i) => {
    const dia = i.diameter ? normalizeDiameter(i.diameter) : '2 inch';
    return `Water Service, ${dia}`;
  },
  'sanitary manhole': (i) => {
    const dia = i.diameter ? normalizeDiameter(i.diameter) : '48 inch';
    return `Sanitary Manhole, ${dia}`;
  },
  'storm manhole': (i) => {
    const dia = i.diameter ? normalizeDiameter(i.diameter) : '48 inch';
    return `Dr Structure, ${dia}`;
  },
  'catch basin': (_i) => 'Dr Structure, 48 inch',
  'hma surface': (i) => {
    const course = i.course ? `, ${i.course}` : ', Top';
    return `HMA surface course${course}`;
  },
  'hma base': (_i) => 'HMA base course',
  'aggregate base': (i) => {
    const thick = i.thickness ? ', ' + normalizeDiameter(i.thickness) : '';
    return `Aggregate Base${thick}`;
  },
  'concrete pavement': (i) => {
    const thick = i.thickness ? ', ' + normalizeDiameter(i.thickness) : '';
    return `concrete pavement${thick}`;
  },
  'curb & gutter': (i) => {
    const spec = i.spec ? ` ${i.spec}` : '';
    return `concrete curb and gutter${spec}`;
  },
  'sidewalk': (i) => {
    const thick = i.thickness ? ', ' + normalizeDiameter(i.thickness) : ', 4 inch';
    return `Sidewalk, Conc${thick}`;
  },
  'curb ramp': (_i) => 'Ramp, Conc',
  'driveway': (i) => {
    const thick = i.thickness ? ', ' + normalizeDiameter(i.thickness) : ', 6 inch';
    return `Driveway, Nonreinf Conc${thick}`;
  },
};
