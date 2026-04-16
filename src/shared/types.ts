/**
 * Shared types used by both the Electron main process and the React renderer.
 * These are serialisable over IPC, so they must stay JSON-compatible
 * (no Date, no Map, no functions).
 */

export type MeasurementType = 'linear' | 'area' | 'count';

export type ObjectType =
  | 'polyline'
  | 'closedPolyline'
  | 'pipe'
  | 'hatch'
  | 'block';

export type PayItemStatus =
  | 'pending'
  | 'processing'
  | 'complete'
  | 'flagged'
  | 'error';

/** Fields that can be conditionally rendered on a pay item row. */
export type PayItemField =
  | 'autoDiameter'
  | 'diameter'
  | 'material'
  | 'thickness'
  | 'type'
  | 'size'
  | 'depth'
  | 'course';

export interface PayItemPreset {
  name: string;
  objectType: ObjectType;
  measurement: MeasurementType;
  defaultLayer: string;
  icon: string;
  /** Which attribute fields to show in the form row for this preset. */
  fields: PayItemField[];
  /** `true` for fully custom items (user sets layer from scratch). */
  custom?: boolean;
}

export interface PayItem extends PayItemPreset {
  /** Stable id so React keys survive reorders/renames. */
  id: string;
  layer: string;
  status: PayItemStatus;

  // User-entered attributes (any subset of the preset's `fields` may be filled)
  diameter?: string;
  material?: string;
  thickness?: string;
  spec?: string;
  size?: string;
  depth?: string;
  course?: string;
  /**
   * When true, infer diameter from the polyline's ConstantWidth (global
   * width) property during measurement instead of using the `diameter`
   * field. Civil drafting often encodes pipe diameter as a fraction of one
   * foot (0.5 ft = 6", 1.0 ft = 12"). Defaults to `true` for water main.
   */
  autoDiameterFromWidth?: boolean;

  // Measurement results
  quantity: number | null;
  unitPrice: number | null;
  totalCost: number | null;

  // Resolution
  flagMessage: string | null;
  flagOptions: string[] | null;
  resolutionNotes?: string;

  // Pricing provenance (which CostEstDB project the price came from)
  priceSource?: string;
  /** Free-form error text when status = 'error'. */
  errorMessage?: string;
}

// ---------- Measurement result shapes ----------

export interface EntitySummary {
  layer: string;
  total_entities: number;
  type_counts: Record<string, number>;
  total_lengths_by_type?: Record<string, number>;
  total_areas_by_type?: Record<string, number>;
  polyline_width_breakdown?: Record<
    string,
    { count: number; total_length: number }
  >;
}

/** One compact entity record as returned by get_entities_on_layer. */
export interface EntityRecord {
  id: number;
  type: string; // AcDb* ObjectName
  length?: number;
  area?: number;
  constant_width?: number;
  closed?: boolean;
  block_name?: string;
  effective_name?: string;
  insertion_point?: number[];
  pattern_name?: string;
  coordinates?: number[];
  text?: string;
  radius?: number;
  center?: number[];
  start_point?: number[];
  end_point?: number[];
  start_angle?: number;
  end_angle?: number;
}

export interface LayerInfo {
  name: string;
  on: boolean;
  frozen: boolean;
  locked: boolean;
  color: number;
  linetype?: string;
  lineweight?: number;
  description?: string;
}

export interface ServerStatus {
  connected: boolean;
  document?: string;
  drawing_units?: string;
  progid?: string;
  error?: string;
}

export interface MeasurementIssue {
  type:
    | 'multiple_layers'
    | 'no_entities'
    | 'unexpected_types'
    | 'overlap'
    | 'artifacts'
    | 'mixed_closed'
    | 'zero_quantity'
    | 'ambiguous_diameter';
  message: string;
  suggestedOptions: string[];
  metadata?: Record<string, unknown>;
}

export interface MeasurementResult {
  success: boolean;
  quantity?: number;
  unit?: string;
  details?: EntitySummary;
  issues?: MeasurementIssue[];
  /** Diameter auto-detected from polyline global width (e.g. `'8"'`). */
  detectedDiameter?: string;
  /** Present when success=false and no issues list applies. */
  errorMessage?: string;
}

// ---------- Tool response envelope (AutoCAD tools) ----------

export interface ToolSuccess<T> {
  success: true;
  data: T;
}

export interface ToolFailure {
  success: false;
  error: string;
}

export type ToolResponse<T> = ToolSuccess<T> | ToolFailure;

// ---------- Export ----------

export interface EstimateExport {
  projectName: string;
  items: PayItem[];
  totalCost: number;
  exportDate: string; // ISO string
}

// ---------- IPC channel payloads ----------

export interface MeasurePayload {
  items: PayItem[];
}

export interface PayItemUpdate {
  id: string;
  patch: Partial<PayItem>;
}

export interface ResolvePayload {
  itemId: string;
  userInput: string;
  /** Fresh snapshot of the item so the main process has the latest edits. */
  item: PayItem;
}

export interface ResolveMessage {
  itemId: string;
  kind: 'assistant' | 'tool_use' | 'tool_result' | 'error' | 'final';
  text?: string;
  toolName?: string;
  /** When kind=final, the quantity/unitPrice the agent settled on. */
  resolution?: {
    quantity?: number;
    unitPrice?: number;
    notes?: string;
    flagOptions?: string[];
  };
}

export interface SetManualPayload {
  itemId: string;
  quantity: number;
  notes?: string;
}

export interface PriceLookupPayload {
  description: string;
  unit: string;
  quantity?: number;
}

export interface PriceLookupResult {
  unitPrice: number | null;
  source?: string;
  matches?: Array<{
    description: string;
    unitPrice: number;
    source: string;
    year?: number;
  }>;
}
