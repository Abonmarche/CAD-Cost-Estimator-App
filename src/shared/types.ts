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
  /**
   * Renders the "Auto-extract diameter & material from feature" checkbox.
   * Used by Civil 3D pipe-network presets (Sanitary Sewer, Storm Sewer)
   * where the diameter and material live on the AeccDbPipe's PartSizeName
   * / Description instead of being encoded in polyline ConstantWidth.
   */
  | 'autoParts'
  /**
   * Renders the "Civil 3D style keyword" field. Lets the user narrow a
   * shared pipe-network layer (e.g. P-UTIL) to just sanitary/storm/water
   * pipes by matching the entity's Style.Name. Empty string = no filter.
   */
  | 'styleKeyword'
  | 'diameter'
  | 'material'
  | 'thickness'
  | 'type'
  | 'size'
  | 'depth'
  | 'course';

/**
 * Color accent used for the 4px left border on the pay item library card
 * and the matching row in the workspace. Keys correspond to Tailwind
 * `accent.*` tokens defined in `tailwind.config.js`.
 */
export type PresetAccent =
  | 'sky'
  | 'amber'
  | 'slate'
  | 'rose'
  | 'charcoal'
  | 'zinc'
  | 'cloud';

export interface PayItemPreset {
  name: string;
  objectType: ObjectType;
  measurement: MeasurementType;
  defaultLayer: string;
  /**
   * Legacy emoji marker. Retained for backwards compatibility with any
   * persisted state but no longer rendered by the redesigned renderer.
   * New presets should leave this as an empty string and rely on `accent`.
   */
  icon: string;
  /** Visual category accent (border-left color). Optional for safety. */
  accent?: PresetAccent;
  /** Which attribute fields to show in the form row for this preset. */
  fields: PayItemField[];
  /**
   * Default style-name keyword for Civil 3D pipe-network presets. When a
   * shared layer (e.g. P-UTIL) carries both sanitary and storm pipes, the
   * keyword narrows the SelectionSet to entities whose `Style.Name`
   * contains this substring (case-insensitive). Empty/undefined = no
   * style filter applied.
   */
  defaultStyleKeyword?: string;
  /** `true` for fully custom items (user sets layer from scratch). */
  custom?: boolean;
}

export interface PayItem extends PayItemPreset {
  /** Stable id so React keys survive reorders/renames. */
  id: string;
  layer: string;
  /**
   * Optional additional layers to pull geometry from. When present, the
   * measurement sums entities across `[layer, ...extraLayers]`. Lets a
   * single pay item combine quantities from layers the drafter split
   * (e.g. `W-MAIN-EX` + `W-MAIN-PROP`). Empty strings are ignored.
   */
  extraLayers?: string[];
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
  /**
   * When true (and `objectType === 'pipe'`), infer diameter + material
   * from the Civil 3D part feature on each AeccDbPipe — `PartSizeName`
   * first ("8.0 inch PVC Pipe"), `Description` as a fallback ("8" SDR 35").
   * Defaults to `true` for the Sanitary/Storm Sewer presets.
   */
  autoFromPartFeature?: boolean;
  /**
   * Substring (case-insensitive) matched against `entity.Style.Name` to
   * narrow the SelectionSet on a shared pipe-network layer. e.g. the
   * Sanitary preset uses `'sanitary'`, Storm uses `'storm'` — both
   * default to layer `P-UTIL`. Empty/undefined = no style filter.
   */
  styleKeyword?: string;

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
  /**
   * True once CostEstDB has been queried for this item, regardless of
   * whether a match was found. Used by the workflow footer to
   * differentiate "needs pricing" from "priced but CostEstDB had no
   * match" — both have `unitPrice === null`, but only the first should
   * keep the button stuck on "Generate estimate."
   */
  pricingAttempted?: boolean;
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
  /**
   * How many entities matched the layer + DXF/ObjectName filters but were
   * dropped because their Civil 3D `Style.Name` didn't contain the user's
   * style keyword. Surfaced for the flagger so we can tell the user "I
   * saw 13 pipes you didn't measure — they had a different style".
   */
  skipped_by_style?: number;
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
  /** Civil 3D `Style.Name` (e.g. "P: Sanitary Pipe", "P: Storm Str - 48''"). */
  style_name?: string;
  /** Civil 3D `PartSizeName` (e.g. "8.0 inch PVC Pipe"). */
  part_size_name?: string;
  /**
   * Civil 3D `Description` (drafter-entered: '8" SDR 35', '24" HDPE',
   * '48" DIA', etc.). Used as a fallback when PartSizeName is missing
   * or ambiguous.
   */
  description?: string;
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

/**
 * Connection status for the remote CostEstDB MCP server. Surfaced in the
 * header next to the AutoCAD chip so the user knows up front whether
 * pricing lookups will work.
 */
export interface CostEstDbStatus {
  connected: boolean;
  /** Number of tools the MCP server advertised on the last successful check. */
  toolCount?: number;
  /** Endpoint URL with any query string stripped — purely informational. */
  url?: string;
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
    | 'ambiguous_diameter'
    | 'style_filtered_zero'
    | 'style_skipped_some';
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
  /**
   * Material auto-detected from the Civil 3D part feature
   * (PartSizeName / Description) on AECC pipes — e.g. `'PVC'`, `'HDPE'`,
   * `'SDR 35'`. Undefined when the source pipes had no parseable material.
   */
  detectedMaterial?: string;
  /**
   * Additional pay items to spawn alongside the measured item. Produced
   * when auto-diameter detects multiple distinct standard diameters on
   * the same layer — the primary item keeps the largest bucket and each
   * spawn entry covers one of the minority diameters.
   */
  spawnItems?: PayItem[];
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
  /**
   * Additional pay items to insert into the list alongside this update.
   * Used by auto-diameter when a polyline layer contains multiple distinct
   * diameters — the primary `id` keeps the dominant bucket and each
   * `spawn` entry is a fully-formed complete item for another diameter.
   * IDs are pre-assigned by the main process so the renderer can dispatch
   * follow-up work (pricing) without a second round-trip.
   */
  spawn?: PayItem[];
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

// ---------- Auth (MSAL) ----------

export interface Account {
  /** Entra `oid` claim — stable per user. */
  id: string;
  /** Display name (e.g. "Garrick Garcia"). May be empty for some accounts. */
  name: string;
  /** UPN / email (e.g. "ggarcia@abonmarche.com"). */
  username: string;
}

export interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  account: Account | null;
  /** Most recent interactive sign-in error, if any. Cleared on next attempt. */
  lastError?: string;
}

export interface AuthActionResult {
  success: boolean;
  error?: string;
}

// ---------- Feedback ----------

export type FeedbackType = 'bug' | 'enhancement';

export interface FeedbackSubmission {
  type: FeedbackType;
  title: string;
  description: string;
  submitterName: string;
  submitterEmail: string;
}

export interface FeedbackSuccess {
  ok: true;
  issue: { number: number; url: string };
}

export interface FeedbackFailure {
  ok: false;
  error: { code: string; field?: string; message?: string; resetAt?: string };
}

export type FeedbackResult = FeedbackSuccess | FeedbackFailure;

// ---------- App version + update check ----------

/**
 * Result of a manual "Check for updates" trigger from the renderer. The
 * underlying download (when an update is available) is still handled by
 * `electron-updater`'s autoDownload + the existing `update-downloaded`
 * dialog flow — this result just tells the UI what to show immediately.
 */
export type UpdateCheckResult =
  | { status: 'up-to-date'; currentVersion: string; latestVersion: string }
  | {
      status: 'update-available';
      currentVersion: string;
      latestVersion: string;
    }
  | {
      status: 'downloading';
      currentVersion: string;
      latestVersion: string;
    }
  | { status: 'check-running'; currentVersion: string; message: string }
  | { status: 'disabled'; currentVersion: string; message: string }
  | { status: 'error'; currentVersion: string; message: string };
