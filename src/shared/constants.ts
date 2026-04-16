import type { MeasurementType, ObjectType } from './types';

/**
 * Map form-facing ObjectType to the AutoCAD COM ObjectName string.
 * `closedPolyline` and `polyline` both map to AcDbPolyline — the measurement
 * code filters by `Closed` property to differentiate.
 */
export const OBJECT_TYPE_MAP: Record<ObjectType, string> = {
  polyline: 'AcDbPolyline',
  closedPolyline: 'AcDbPolyline',
  // Civil 3D pipe networks. May also be `AeccDbPipe` depending on the drawing.
  // Measurement code tolerates either.
  pipe: 'AcDbPipe',
  hatch: 'AcDbHatch',
  block: 'AcDbBlockReference',
};

/**
 * Alternative object name strings that should be treated as equivalent to
 * the canonical name in OBJECT_TYPE_MAP. Keyed by ObjectType.
 * These are the values returned by `entity.ObjectName` — used for post-filter
 * checks after a SelectionSet returns entities.
 */
export const OBJECT_TYPE_ALIASES: Record<ObjectType, string[]> = {
  polyline: ['AcDbPolyline', 'AcDb2dPolyline', 'AcDb3dPolyline'],
  closedPolyline: ['AcDbPolyline', 'AcDb2dPolyline'],
  pipe: ['AcDbPipe', 'AeccDbPipe'],
  hatch: ['AcDbHatch'],
  block: ['AcDbBlockReference'],
};

/**
 * DXF entity-type names used in AutoCAD SelectionSet filters (DXF group 0).
 * These are the names AutoCAD expects in its filter arguments — distinct
 * from the ObjectName property on a live entity (AcDb* names). Using these
 * lets us filter server-side which is 100×+ faster than iterating ModelSpace.
 *
 * Comma-joined values act as an OR filter inside a single DXF code, e.g.
 * `'LWPOLYLINE,POLYLINE'` matches either 2D lightweight or heavy polylines.
 *
 * `pipe` falls back to plain polylines — Civil 3D pipe networks have no
 * standard DXF name that SelectionSet can filter on. When a user targets a
 * pipe-object layer the agent can widen to a full scan if needed.
 */
export const DXF_TYPE_NAMES: Record<ObjectType, string[]> = {
  polyline: ['LWPOLYLINE', 'POLYLINE'],
  closedPolyline: ['LWPOLYLINE', 'POLYLINE'],
  pipe: ['LWPOLYLINE', 'POLYLINE'],
  hatch: ['HATCH'],
  block: ['INSERT'],
};

export const MEASUREMENT_UNITS: Record<MeasurementType, string> = {
  linear: 'LF',
  area: 'SY',
  count: 'EA',
};

/**
 * Default human-readable object-type labels for the form dropdown.
 */
export const OBJECT_TYPE_OPTIONS: Array<{
  value: ObjectType;
  label: string;
  measurement: MeasurementType;
}> = [
  { value: 'polyline', label: 'Polyline (open)', measurement: 'linear' },
  { value: 'closedPolyline', label: 'Polyline (closed)', measurement: 'area' },
  { value: 'pipe', label: 'Pipe Network', measurement: 'linear' },
  { value: 'hatch', label: 'Hatch', measurement: 'area' },
  { value: 'block', label: 'Block Reference', measurement: 'count' },
];

/** Minimum length in drawing units (feet) to be considered a real segment. */
export const SHORT_SEGMENT_THRESHOLD_FT = 2;

/** Square feet per square yard (for converting hatch area → SY). */
export const SQ_FT_PER_SY = 9;

/** AutoCAD 2024 COM ProgID. Override via env. */
export const DEFAULT_AUTOCAD_PROGID = 'AutoCAD.Application.24.3';

export const IPC_CHANNELS = {
  AutocadStatus: 'autocad:status',
  ListLayers: 'autocad:list-layers',
  EstimateMeasure: 'estimate:measure',
  EstimateMeasureUpdate: 'estimate:measure-update',
  EstimateResolve: 'estimate:resolve',
  EstimateResolveMessage: 'estimate:resolve-message',
  EstimateSetManual: 'estimate:set-manual',
  EstimatePrice: 'estimate:price',
  EstimateExport: 'estimate:export',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
