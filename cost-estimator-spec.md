# Cost Estimator — Project Specification

## Overview

Cost Estimator is an Electron desktop application for Abonmarche Consultants that automates construction cost estimating by reading quantities directly from open AutoCAD drawings and pricing them against historical bid data. It combines two data sources through the Claude Agent SDK:

1. **AutoCAD COM automation** (via `winax`) — reads entity geometry (polyline lengths, hatch areas, block counts) from the user's open AutoCAD drawing
2. **CostEstDB** — a remote MCP server on Azure that searches historical bid tabulation data for matching pay item unit prices

The app follows a **wizard pattern with an AI escape hatch**: users fill in a structured form defining pay items, the system runs deterministic measurements, and an AI chat resolves ambiguities (wrong layers, overlapping geometry, missing data) before exporting a completed estimate to Excel.

---

## Architecture

### Agent SDK with In-Process MCP

The Claude Agent SDK (TypeScript) supports **in-process MCP servers** via `createSdkMcpServer`. AutoCAD tools are defined as functions within the Electron main process — no separate MCP server process, no subprocess management. CostEstDB connects as a remote MCP server over HTTP since it's already deployed on Azure.

```
┌─────────────────────────────────────────────────────┐
│  Electron App                                        │
│                                                      │
│  ┌──────────────┐     IPC      ┌──────────────────┐ │
│  │  Renderer     │◄───────────►│  Main Process     │ │
│  │  (React UI)   │             │                   │ │
│  │               │             │  ┌──────────────┐ │ │
│  │  - Form       │             │  │ Agent SDK     │ │ │
│  │  - Review     │             │  │              │ │ │
│  │  - Chat       │             │  │  In-process: │ │ │
│  │  - Export     │             │  │  ┌──────────┐│ │ │
│  └──────────────┘             │  │  │ AutoCAD  ││ │ │
│                                │  │  │ tools    ││ │ │
│                                │  │  │ (winax)  ││ │ │
│                                │  │  └──────────┘│ │ │
│                                │  │              │ │ │
│                                │  │  Remote:     │ │ │
│                                │  │  ┌──────────┐│ │ │
│                                │  │  │ CostEstDB││ │ │
│                                │  │  │ (HTTP)   ││ │ │
│                                │  │  └──────────┘│ │ │
│                                │  └──────────────┘ │ │
│                                └──────────────────┘ │
└─────────────────────────────────────────────────────┘
                                        │
                            COM (winax)  │  HTTPS
                        ┌────────────────┼──────────────┐
                        ▼                               ▼
                ┌──────────────┐              ┌──────────────────┐
                │  AutoCAD     │              │  Azure Function   │
                │  2024        │              │  CostEstDB MCP    │
                │  (running)   │              │  (PostgreSQL +    │
                └──────────────┘              │   pgvector)       │
                                              └──────────────────┘
```

### Why In-Process (Not a Separate MCP Server)

The original AutoCAD MCP was a standalone Python server using `pywin32` for COM access. For this app, we port the read-only tools to TypeScript using `winax` and define them as in-process tools via `createSdkMcpServer`. Benefits:

- No Python runtime to bundle (eliminates PyInstaller complexity)
- No subprocess management or stdio IPC overhead
- Single language (TypeScript) across the entire app
- Simpler debugging — everything runs in one process
- AutoCAD tools are just modules, not a separate build artifact

The existing Python MCP (`Abonmarche/AutoCAD-MCP`) continues to exist for ad-hoc Claude Code usage. This app does not replace it.

---

## Repository Layout

```
cost-estimator/
├── package.json                    # Root package with scripts
├── tsconfig.json                   # Base TypeScript config
├── electron-builder.yml            # Electron packaging/auto-update config
├── .env.example                    # Template for API keys
├── CLAUDE.md                       # Claude Code project instructions
│
├── src/
│   ├── main/                       # Electron main process
│   │   ├── index.ts                # App entry: window creation, IPC handlers
│   │   ├── agent.ts                # Agent SDK orchestration (query, sessions)
│   │   ├── ipc-handlers.ts         # IPC bridge between renderer and agent
│   │   │
│   │   └── tools/                  # In-process MCP tool definitions
│   │       ├── autocad/
│   │       │   ├── server.ts       # createSdkMcpServer wrapping all AutoCAD tools
│   │       │   ├── connection.ts   # winax COM connection + AutocadWrapper class
│   │       │   ├── layers.ts       # list_layers tool
│   │       │   ├── entities.ts     # get_entities_on_layer tool
│   │       │   ├── details.ts      # get_entity_details tool
│   │       │   ├── status.ts       # server_status tool
│   │       │   └── helpers.ts      # _safe_get, _extract_summary_props equivalents
│   │       │
│   │       └── costestdb.ts        # Remote MCP config for CostEstDB (URL + auth)
│   │
│   ├── renderer/                   # React frontend (Electron renderer process)
│   │   ├── index.html              # Entry HTML
│   │   ├── App.tsx                 # Root component, phase routing
│   │   ├── main.tsx                # React entry point
│   │   │
│   │   ├── components/
│   │   │   ├── ProjectHeader.tsx   # Project name, running totals, status summary
│   │   │   ├── PresetPicker.tsx    # Categorized pay item templates
│   │   │   ├── PayItemRow.tsx      # Individual pay item form row
│   │   │   ├── PayItemList.tsx     # List of all pay items with status
│   │   │   ├── ReviewTable.tsx     # Post-processing results table
│   │   │   ├── ResolutionChat.tsx  # Scoped AI chat for flagged items
│   │   │   ├── ActionBar.tsx       # Fixed bottom bar (Measure / Export buttons)
│   │   │   └── ExportPreview.tsx   # Preview of Excel output before export
│   │   │
│   │   ├── hooks/
│   │   │   ├── useAgent.ts         # IPC hook for agent communication
│   │   │   ├── usePayItems.ts      # Pay item state management
│   │   │   └── useEstimate.ts      # Estimate lifecycle (measure → review → export)
│   │   │
│   │   ├── types/
│   │   │   └── index.ts            # Frontend-specific types
│   │   │
│   │   └── styles/
│   │       └── globals.css         # Base styles, CSS variables
│   │
│   └── shared/                     # Types shared between main and renderer
│       ├── types.ts                # PayItem, Estimate, ToolResponse, etc.
│       ├── presets.ts              # Pay item preset definitions
│       └── constants.ts            # Object types, measurement units, etc.
│
├── resources/                      # Electron app resources
│   ├── icon.ico                    # App icon (Windows)
│   └── icon.png                    # App icon (other)
│
└── templates/
    └── estimate-template.xlsx      # Excel output template
```

---

## Technology Stack

| Component | Technology | Purpose |
|---|---|---|
| Desktop shell | Electron | Cross-platform desktop app (targeting Windows) |
| Frontend | React + TypeScript | Form UI, review table, resolution chat |
| Styling | Tailwind CSS or CSS-in-JS | UI styling (match mockup aesthetic) |
| AI orchestration | `@anthropic-ai/claude-agent-sdk` | Agent loop, tool execution, chat |
| AutoCAD automation | `winax` (Node.js COM) | Read entities, layers, properties from AutoCAD |
| Cost data | CostEstDB remote MCP | Historical bid pricing via Azure Function |
| Excel export | `exceljs` | Generate formatted estimate spreadsheets |
| Distribution | `electron-builder` + `electron-updater` | Packaging, auto-updates |
| Build tool | Vite (with electron-vite or similar) | Fast dev server + production builds |

### Key Dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "latest",
    "winax": "latest",
    "exceljs": "^4.4.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "electron-updater": "^6.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0",
    "electron-rebuild": "^3.2.0",
    "vite": "^6.0.0",
    "typescript": "^5.5.0",
    "@types/react": "^18.3.0"
  }
}
```

> **Important**: `winax` is a native Node addon. After installing, run `electron-rebuild` to compile it against Electron's version of V8. This is critical and should be part of the postinstall script.

---

## AutoCAD COM Integration (winax)

### Connection Management (`src/main/tools/autocad/connection.ts`)

Port the existing Python `AutocadWrapper` pattern. The COM ProgID for AutoCAD 2024 is `"AutoCAD.Application.24.3"`.

```typescript
// Conceptual structure — implement fully during build
import winax from 'winax';

const AUTOCAD_PROGID = "AutoCAD.Application.24.3";

export function getAutocadInstance() {
  try {
    // Try connecting to running instance first
    const app = new winax.Object(AUTOCAD_PROGID, { activate: true });
    app.Visible = true;
    const doc = app.ActiveDocument;
    const modelspace = doc.ModelSpace;
    return { app, doc, modelspace };
  } catch (e) {
    throw new Error(`Cannot connect to AutoCAD: ${e}`);
  }
}

// Safe property accessor (equivalent to Python _safe_get)
export function safeGet(entity: any, prop: string, defaultVal: any = null): any {
  try {
    const val = entity[prop];
    return val !== undefined ? val : defaultVal;
  } catch {
    return defaultVal;
  }
}
```

### Tool Definitions

Each tool is defined using the Agent SDK's `tool()` helper and bundled into an in-process MCP server:

```typescript
// src/main/tools/autocad/server.ts
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { getAutocadInstance, safeGet } from "./connection";

const listLayers = tool(
  "list_layers",
  "List all layers in the current AutoCAD drawing with properties (on/off, frozen, locked, color, linetype)",
  {},
  async () => {
    const { doc } = getAutocadInstance();
    const layers = [];
    const layerCollection = doc.Layers;
    for (let i = 0; i < layerCollection.Count; i++) {
      const layer = layerCollection.Item(i);
      layers.push({
        name: layer.Name,
        on: layer.LayerOn,
        frozen: layer.Freeze,
        locked: layer.Lock,
        color: layer.Color,
      });
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ success: true, count: layers.length, layers }) }]
    };
  }
);

const getEntitiesOnLayer = tool(
  "get_entities_on_layer",
  "Get all entities on a specific layer, optionally filtered by entity type. Returns summary with counts, total lengths, total areas, and entity list. Useful for quantity takeoffs.",
  {
    layer_name: z.string().describe("Exact layer name to query"),
    entity_type: z.string().optional().describe("Filter by ObjectName, e.g. 'AcDbPolyline', 'AcDbBlockReference', 'AcDbHatch'"),
  },
  async ({ layer_name, entity_type }) => {
    const { modelspace } = getAutocadInstance();
    // Port the Python get_entities_on_layer logic here
    // Iterate modelspace, filter by layer/type, accumulate lengths/areas/counts
    // Return JSON summary + entity list
  }
);

// ... define get_entity_details, server_status similarly

export const autocadServer = createSdkMcpServer({
  name: "autocad",
  version: "1.0.0",
  tools: [listLayers, getEntitiesOnLayer, /* getEntityDetails, serverStatus */]
});
```

### Tools to Port (Read-Only Subset)

Only these tools from the Python MCP need to be ported. The draw/extrude/revolve tools are NOT needed.

| Tool | Input | Output | Purpose in Estimator |
|---|---|---|---|
| `server_status` | none | AutoCAD connection status, active doc name | Verify connection on app launch |
| `list_layers` | none | Array of layers with properties | Populate layer dropdowns, validate user input |
| `get_entities_on_layer` | `layer_name`, optional `entity_type` | Summary (counts, total lengths/areas by type, polyline width breakdown) + entity list | **Core measurement tool** — gets quantities |
| `get_entity_details` | `entity_id` | Full properties for a single entity | Resolution chat — inspect specific entities |

### Python Source Reference

The Python implementation to port lives in two files. The server entry point (`server.py`) defines tool schemas and dispatches calls. The utility module (`src/utils.py`) contains all COM interaction logic. Key functions to port:

**From `src/utils.py`:**

- `get_autocad_instance()` → `connection.ts`: COM connection with fallback chain
- `get_all_layers(acad)` → `layers.ts`: Iterate `doc.Layers`, extract properties
- `get_entities_on_layer(acad, layer_name, entity_type)` → `entities.ts`: Iterate modelspace, filter by layer/type, accumulate `type_counts`, `type_lengths`, `type_areas`, `polyline_width_breakdown`
- `_extract_summary_props(entity)` → `helpers.ts`: Type-aware property extraction (polyline length/closed/width, block name/insertion point, hatch area/pattern, etc.)
- `extract_detailed_properties(entity)` → `details.ts`: Comprehensive single-entity properties
- `_safe_get(entity, prop, default)` → `helpers.ts`: Safe COM property accessor

**AutoCAD COM Object Model Notes:**

- ModelSpace is iterable by index: `modelspace.Item(i)`, count via `modelspace.Count`
- Entity type is `entity.ObjectName` (e.g., `"AcDbPolyline"`, `"AcDbBlockReference"`, `"AcDbHatch"`)
- Layer filtering: `entity.Layer === layerName`
- Polyline length: `entity.Length` (units match drawing units, typically feet)
- Polyline closed: `entity.Closed` (boolean)
- Polyline constant width: `entity.ConstantWidth` (sometimes used to encode pipe diameter)
- Hatch area: `entity.Area` (square drawing units)
- Block name: `entity.Name` or `entity.EffectiveName`
- Block attributes: `entity.HasAttributes` → `entity.GetAttributes()` → iterate for tag/value pairs
- VARIANT arrays (coordinates, points) come back as JavaScript arrays through winax

---

## CostEstDB Remote MCP

CostEstDB is already deployed as a remote MCP server on Azure. It does NOT need to be ported or embedded. Just configure the connection:

```typescript
// src/main/tools/costestdb.ts
export const costestdbConfig = {
  type: "http" as const,
  url: "https://func-costestdb-mcp.azurewebsites.net/runtime/webhooks/mcp/sse",
  headers: {
    // Add auth headers if needed
  }
};
```

### CostEstDB Tools Available

| Tool | Purpose |
|---|---|
| `search_pay_items` | Search historical bid data for matching pay items by description, material, size |
| `get_project_summary` | Get all pay items and bids for a specific project |
| `list_ingested_projects` | List all available projects in the database |

When the agent needs to price a measured quantity, it calls `search_pay_items` with the pay item description (e.g., "8-inch DIP water main") and uses the returned unit prices to calculate extended costs.

> **Important**: There is a CostEstDB MCP guide skill at `/mnt/skills/organization/costestdb-mcp-guide/SKILL.md` that contains critical terminology mappings (e.g., "catch basin" → "Drainage Structure") and query strategies. The agent's system prompt should incorporate these mappings so it queries CostEstDB effectively.

---

## Agent SDK Orchestration (`src/main/agent.ts`)

The main process orchestrates the agent. Two modes of operation:

### Mode 1: Deterministic Measurement (Form Phase)

For each pay item the user defines, the app makes direct calls to the AutoCAD tools WITHOUT going through the LLM. This is faster and cheaper:

```typescript
// Pseudocode for direct tool invocation during measurement
async function measurePayItem(item: PayItem): Promise<MeasurementResult> {
  const result = await autocadTools.getEntitiesOnLayer({
    layer_name: item.layer,
    entity_type: item.objectType  // map to AcDb* names
  });

  // Extract the relevant quantity based on measurement type
  if (item.measurement === "linear") {
    return { quantity: result.summary.total_lengths_by_type[item.objectType] };
  } else if (item.measurement === "area") {
    return { quantity: result.summary.total_areas_by_type[item.objectType] };
  } else if (item.measurement === "count") {
    return { quantity: result.summary.type_counts[item.objectType] };
  }
}
```

If the measurement returns cleanly (expected entity types found, reasonable quantities), it proceeds directly to pricing via CostEstDB. No LLM involved.

### Mode 2: AI Resolution (Chat Phase)

When measurement returns unexpected results, the agent is invoked for resolution:

**Flagging conditions:**
- Entities found on multiple similar layers (e.g., `W-MAIN` and `WATERLINE`)
- Zero entities found on the specified layer
- Unexpected entity types on the layer (user said polyline but found blocks)
- Overlapping hatches that might double-count area
- Polylines with mixed open/closed status on the same layer
- Very short segments (< 2 ft) that might be drafting artifacts

```typescript
// When a pay item gets flagged, open a scoped agent conversation
async function resolvePayItem(item: PayItem, issue: FlaggedIssue) {
  for await (const msg of query({
    prompt: buildResolutionPrompt(item, issue),
    options: {
      mcpServers: {
        "autocad": autocadServer,
        "costestdb": costestdbConfig
      },
      allowedTools: [
        "mcp__autocad__get_entities_on_layer",
        "mcp__autocad__get_entity_details",
        "mcp__costestdb__search_pay_items"
      ],
      maxTurns: 10  // Keep resolution focused
    }
  })) {
    // Stream messages to the resolution chat UI
    yield msg;
  }
}
```

The resolution chat is scoped to a single pay item. It never becomes a general conversation. If the agent can't resolve in 2-3 exchanges, the UI offers a "Set quantity manually" escape.

---

## User Interface Design

### UX Flow (Wizard Pattern)

```
1. FORM PHASE          2. PROCESSING          3. REVIEW              4. EXPORT
┌─────────────┐       ┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│ Project Name │       │              │       │ ✓ Water Main │       │              │
│              │       │  Measuring   │       │   1,247 LF   │       │  Excel file  │
│ + Water Main │──────►│  pay items   │──────►│              │──────►│  generated   │
│ + San Sewer  │       │  ████░░ 3/5  │       │ ⚠ San Sewer  │       │  & saved     │
│ + HMA Surface│       │              │       │   [Chat]     │       │              │
│ + Sidewalk   │       │              │       │              │       │              │
│              │       │              │       │ ✓ HMA Surface│       │              │
│ [Measure]    │       │              │       │   8,250 SY   │       │ [Download]   │
└─────────────┘       └──────────────┘       └──────────────┘       └──────────────┘
```

### Phase 1: Form

Users build their estimate by adding pay items from a preset picker or custom entry.

**Preset Picker** — Organized into categories:

- **Utilities**: Water Main, Sanitary Sewer, Storm Sewer, Water Service, Water Fitting, Sanitary Manhole, Storm Manhole, Catch Basin
- **Paving & Surface**: HMA Surface, HMA Base, Aggregate Base, Concrete Pavement, Curb & Gutter
- **Sidewalk & Concrete**: Sidewalk, Curb Ramp, Driveway
- **Miscellaneous**: Custom Linear, Custom Area, Custom Count (for one-offs like bollards, sign posts)

Each preset pre-fills: object type, measurement type (linear/area/count), default layer name, and which fields to show (diameter, material, thickness, etc.).

**Object type mapping to AutoCAD:**

| Form Object Type | AutoCAD ObjectName | Measurement | Unit |
|---|---|---|---|
| Polyline (open) | `AcDbPolyline` (Closed=false) | Linear | LF |
| Polyline (closed) | `AcDbPolyline` (Closed=true) | Area | SY |
| Pipe Network | Pipe objects (varies by Civil 3D) | Linear | LF |
| Hatch | `AcDbHatch` | Area | SY |
| Block Reference | `AcDbBlockReference` | Count | EA |

**Fields per pay item:**
- **Always shown**: Pay item name, layer, object type, unit (auto-derived)
- **Conditional**: Diameter, material, thickness, type/spec, size, depth, course — shown based on preset definition
- **Material is always user-entered** — not reliably stored in CAD objects

### Phase 3: Review & Resolution

After measurement, items display in three states:

- **Complete (green)**: Quantity found, unit price matched. Shows `Qty × Unit Price = Total`.
- **Flagged (yellow)**: Measurement had ambiguity. Shows the "Estimator Assistant" message with quick-pick resolution buttons + free-text input.
- **Pending (gray)**: Not yet measured.

**Resolution chat UX principles:**
- Always anchored to a specific pay item (never open-ended)
- Agent has a persona: "Estimator Assistant"
- Always offer clickable response options alongside free text
- If unresolved after 2-3 exchanges, show "Set quantity manually" button
- Show running total that updates as items resolve

### Phase 4: Export

Generate an Excel file from the completed estimate using `exceljs`. The template (`templates/estimate-template.xlsx`) defines the output format. At minimum, output columns should include:

- Item Number
- Pay Item Description
- Unit (LF, SY, EA)
- Estimated Quantity
- Unit Price
- Extended Cost
- Source (which CostEstDB project the price came from)
- Notes (any resolution notes from the chat phase)

---

## Reference: React Frontend Mockup

Below is a working React component mockup that demonstrates the form UI, preset picker, pay item rows, and resolution chat pattern. Use this as a reference for implementing the actual renderer components. The production version should be split into separate component files per the repository layout above.

```jsx
import { useState } from "react";

const PRESETS = {
  utilities: {
    label: "Utilities",
    items: [
      { name: "Water Main", objectType: "polyline", measurement: "linear", defaultLayer: "W-MAIN", icon: "💧", fields: ["diameter", "material"] },
      { name: "Sanitary Sewer", objectType: "pipe", measurement: "linear", defaultLayer: "SS-PIPE", icon: "🟤", fields: ["diameter", "material"] },
      { name: "Storm Sewer", objectType: "pipe", measurement: "linear", defaultLayer: "STM-PIPE", icon: "🌧", fields: ["diameter", "material"] },
      { name: "Water Service", objectType: "polyline", measurement: "linear", defaultLayer: "W-SERV", icon: "💧", fields: ["diameter", "material"] },
      { name: "Water Fitting", objectType: "block", measurement: "count", defaultLayer: "W-FTGS", icon: "🔧", fields: ["type", "size"] },
      { name: "Sanitary Manhole", objectType: "block", measurement: "count", defaultLayer: "SS-MH", icon: "⭕", fields: ["depth", "diameter"] },
      { name: "Storm Manhole", objectType: "block", measurement: "count", defaultLayer: "STM-MH", icon: "⭕", fields: ["depth", "diameter"] },
      { name: "Catch Basin", objectType: "block", measurement: "count", defaultLayer: "STM-CB", icon: "🔲", fields: ["type"] },
    ]
  },
  paving: {
    label: "Paving & Surface",
    items: [
      { name: "HMA Surface", objectType: "hatch", measurement: "area", defaultLayer: "PV-HMA", icon: "⬛", fields: ["course", "thickness"] },
      { name: "HMA Base", objectType: "hatch", measurement: "area", defaultLayer: "PV-HMA-BASE", icon: "⬛", fields: ["thickness"] },
      { name: "Aggregate Base", objectType: "hatch", measurement: "area", defaultLayer: "PV-AGG", icon: "🪨", fields: ["thickness", "material"] },
      { name: "Concrete Pavement", objectType: "closedPolyline", measurement: "area", defaultLayer: "PV-CONC", icon: "⬜", fields: ["thickness"] },
      { name: "Curb & Gutter", objectType: "polyline", measurement: "linear", defaultLayer: "PV-CURB", icon: "📏", fields: ["type"] },
    ]
  },
  concrete: {
    label: "Sidewalk & Concrete",
    items: [
      { name: "Sidewalk", objectType: "closedPolyline", measurement: "area", defaultLayer: "SW-CONC", icon: "🚶", fields: ["thickness"] },
      { name: "Curb Ramp", objectType: "block", measurement: "count", defaultLayer: "SW-RAMP", icon: "♿", fields: ["type"] },
      { name: "Driveway", objectType: "closedPolyline", measurement: "area", defaultLayer: "SW-DRWY", icon: "🚗", fields: ["thickness", "material"] },
    ]
  },
  misc: {
    label: "Miscellaneous",
    items: [
      { name: "Custom Linear", objectType: "polyline", measurement: "linear", defaultLayer: "", icon: "📐", fields: ["material"], custom: true },
      { name: "Custom Area", objectType: "hatch", measurement: "area", defaultLayer: "", icon: "📐", fields: ["material"], custom: true },
      { name: "Custom Count", objectType: "block", measurement: "count", defaultLayer: "", icon: "📐", fields: ["material"], custom: true },
    ]
  }
};

const OBJECT_TYPES = [
  { value: "polyline", label: "Polyline (open)", measurement: "linear" },
  { value: "closedPolyline", label: "Polyline (closed)", measurement: "area" },
  { value: "pipe", label: "Pipe Network", measurement: "linear" },
  { value: "hatch", label: "Hatch", measurement: "area" },
  { value: "block", label: "Block Reference", measurement: "count" },
];

const MEASUREMENT_LABELS = { linear: "LF", area: "SY", count: "EA" };

const STATUS_CONFIG = {
  pending: { bg: "#2a2d35", border: "#3d414b", dot: "#6b7280", label: "Pending" },
  processing: { bg: "#1e2a3a", border: "#2563eb44", dot: "#3b82f6", label: "Processing..." },
  complete: { bg: "#1a2e1a", border: "#16a34a44", dot: "#22c55e", label: "Complete" },
  flagged: { bg: "#2e2415", border: "#d9770644", dot: "#f59e0b", label: "Needs Review" },
};

function PresetPicker({ onAdd }) {
  const [activeCategory, setActiveCategory] = useState("utilities");

  return (
    <div style={{ background: "#1a1c23", borderRadius: 12, border: "1px solid #2a2d35", overflow: "hidden" }}>
      <div style={{ display: "flex", borderBottom: "1px solid #2a2d35" }}>
        {Object.entries(PRESETS).map(([key, cat]) => (
          <button
            key={key}
            onClick={() => setActiveCategory(key)}
            style={{
              flex: 1, padding: "10px 8px", border: "none", cursor: "pointer",
              fontSize: 12, fontFamily: "'DM Sans', sans-serif", fontWeight: 500, letterSpacing: "0.02em",
              background: activeCategory === key ? "#252830" : "transparent",
              color: activeCategory === key ? "#e2e8f0" : "#6b7280",
              borderBottom: activeCategory === key ? "2px solid #3b82f6" : "2px solid transparent",
              transition: "all 0.15s ease",
            }}
          >
            {cat.label}
          </button>
        ))}
      </div>
      <div style={{ padding: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {PRESETS[activeCategory].items.map((item) => (
          <button
            key={item.name}
            onClick={() => onAdd(item)}
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "9px 12px",
              background: "#252830", border: "1px solid #2a2d35", borderRadius: 8,
              cursor: "pointer", color: "#c8cdd5", fontSize: 13, textAlign: "left",
              fontFamily: "'DM Sans', sans-serif", transition: "all 0.12s ease",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "#2d3040"; e.currentTarget.style.borderColor = "#3b82f644"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "#252830"; e.currentTarget.style.borderColor = "#2a2d35"; }}
          >
            <span style={{ fontSize: 16, width: 24, textAlign: "center", flexShrink: 0 }}>{item.icon}</span>
            <div>
              <div style={{ fontWeight: 500, fontSize: 13 }}>{item.name}</div>
              <div style={{ fontSize: 10, color: "#6b7280", marginTop: 1 }}>
                {item.objectType === "closedPolyline" ? "closed polyline" : item.objectType} · {item.measurement}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function PayItemRow({ item, index, onUpdate, onRemove, onResolve }) {
  const status = STATUS_CONFIG[item.status];
  const [expanded, setExpanded] = useState(item.status === "flagged");

  return (
    <div style={{
      background: status.bg, borderRadius: 10, border: `1px solid ${status.border}`,
      padding: 14, transition: "all 0.2s ease",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{
          width: 28, height: 28, borderRadius: "50%", background: "#1a1c23",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 12, color: "#6b7280", fontWeight: 600, flexShrink: 0, marginTop: 2,
          fontFamily: "'JetBrains Mono', monospace",
        }}>{index + 1}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 15 }}>{item.icon}</span>
            <input
              value={item.name}
              onChange={e => onUpdate({ name: e.target.value })}
              style={{
                background: "transparent", border: "none", color: "#e2e8f0",
                fontSize: 15, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
                outline: "none", flex: 1, padding: 0,
              }}
            />
            <div style={{
              display: "flex", alignItems: "center", gap: 5, padding: "3px 10px",
              borderRadius: 20, background: `${status.dot}18`, flexShrink: 0,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: status.dot }} />
              <span style={{ fontSize: 11, color: status.dot, fontWeight: 500, fontFamily: "'DM Sans', sans-serif" }}>{status.label}</span>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
            <div>
              <label style={labelStyle}>Layer</label>
              <input
                value={item.layer}
                onChange={e => onUpdate({ layer: e.target.value })}
                placeholder="e.g. W-MAIN"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Object Type</label>
              <select
                value={item.objectType}
                onChange={e => onUpdate({ objectType: e.target.value })}
                style={{ ...inputStyle, cursor: "pointer" }}
              >
                {OBJECT_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Unit</label>
              <div style={{ ...inputStyle, background: "#1a1c23", color: "#6b7280", display: "flex", alignItems: "center" }}>
                {MEASUREMENT_LABELS[item.measurement] || "—"}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
            {item.fields.includes("diameter") && (
              <div>
                <label style={labelStyle}>Diameter</label>
                <input value={item.diameter || ""} onChange={e => onUpdate({ diameter: e.target.value })} placeholder='e.g. 8"' style={inputStyle} />
              </div>
            )}
            {item.fields.includes("material") && (
              <div>
                <label style={labelStyle}>Material</label>
                <input value={item.material || ""} onChange={e => onUpdate({ material: e.target.value })} placeholder="e.g. DIP, PVC" style={inputStyle} />
              </div>
            )}
            {item.fields.includes("thickness") && (
              <div>
                <label style={labelStyle}>Thickness</label>
                <input value={item.thickness || ""} onChange={e => onUpdate({ thickness: e.target.value })} placeholder='e.g. 3"' style={inputStyle} />
              </div>
            )}
            {item.fields.includes("type") && (
              <div>
                <label style={labelStyle}>Type / Spec</label>
                <input value={item.spec || ""} onChange={e => onUpdate({ spec: e.target.value })} placeholder="e.g. Type D4" style={inputStyle} />
              </div>
            )}
            {item.fields.includes("size") && (
              <div>
                <label style={labelStyle}>Size</label>
                <input value={item.size || ""} onChange={e => onUpdate({ size: e.target.value })} placeholder='e.g. 8"' style={inputStyle} />
              </div>
            )}
            {item.fields.includes("depth") && (
              <div>
                <label style={labelStyle}>Depth</label>
                <input value={item.depth || ""} onChange={e => onUpdate({ depth: e.target.value })} placeholder="e.g. 8'" style={inputStyle} />
              </div>
            )}
            {item.fields.includes("course") && (
              <div>
                <label style={labelStyle}>Course</label>
                <input value={item.course || ""} onChange={e => onUpdate({ course: e.target.value })} placeholder="e.g. Top, Leveling" style={inputStyle} />
              </div>
            )}
          </div>

          {item.status === "complete" && (
            <div style={{
              marginTop: 10, padding: "8px 12px", background: "#16a34a12", borderRadius: 6,
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <span style={{ color: "#86efac", fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>
                Qty: {item.quantity} {MEASUREMENT_LABELS[item.measurement]}
              </span>
              <span style={{ color: "#86efac", fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>
                ${item.unitPrice?.toFixed(2)}/{MEASUREMENT_LABELS[item.measurement]} → <strong>${item.totalCost?.toLocaleString()}</strong>
              </span>
            </div>
          )}

          {item.status === "flagged" && (
            <div style={{ marginTop: 10 }}>
              <div style={{
                padding: "10px 12px", background: "#f59e0b10", borderRadius: 8,
                border: "1px solid #f59e0b22", marginBottom: 8,
              }}>
                <div style={{ color: "#fbbf24", fontSize: 13, fontWeight: 500, marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>
                  Estimator Assistant
                </div>
                <div style={{ color: "#d4a054", fontSize: 13, lineHeight: 1.5, fontFamily: "'DM Sans', sans-serif" }}>
                  {item.flagMessage}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  {item.flagOptions?.map((opt, i) => (
                    <button
                      key={i}
                      onClick={() => onResolve(index, opt)}
                      style={{
                        padding: "5px 12px", borderRadius: 6, border: "1px solid #f59e0b44",
                        background: "#f59e0b11", color: "#fbbf24", fontSize: 12, cursor: "pointer",
                        fontFamily: "'DM Sans', sans-serif", fontWeight: 500, transition: "all 0.12s",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = "#f59e0b22"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "#f59e0b11"; }}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  placeholder="Or type a response..."
                  style={{ ...inputStyle, flex: 1 }}
                  onKeyDown={e => { if (e.key === "Enter") onResolve(index, e.target.value); }}
                />
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => onRemove(index)}
          style={{
            background: "transparent", border: "none", color: "#4b5060", cursor: "pointer",
            fontSize: 16, padding: 4, lineHeight: 1, flexShrink: 0,
          }}
          onMouseEnter={e => e.currentTarget.style.color = "#ef4444"}
          onMouseLeave={e => e.currentTarget.style.color = "#4b5060"}
        >×</button>
      </div>
    </div>
  );
}

const labelStyle = {
  display: "block", fontSize: 10, color: "#6b7280", marginBottom: 3,
  fontFamily: "'DM Sans', sans-serif", fontWeight: 500, letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const inputStyle = {
  width: "100%", padding: "6px 10px", background: "#12141a", border: "1px solid #2a2d35",
  borderRadius: 6, color: "#c8cdd5", fontSize: 13, fontFamily: "'DM Sans', sans-serif",
  outline: "none", boxSizing: "border-box",
};

export default function CostEstimatorForm() {
  const [items, setItems] = useState([]);
  const [showPicker, setShowPicker] = useState(true);
  const [projectName, setProjectName] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  const addItem = (preset) => {
    setItems(prev => [...prev, {
      ...preset,
      layer: preset.defaultLayer || "",
      status: "pending",
      quantity: null,
      unitPrice: null,
      totalCost: null,
      flagMessage: null,
      flagOptions: null,
    }]);
  };

  const updateItem = (index, updates) => {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, ...updates } : item));
  };

  const removeItem = (index) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const simulateRun = () => {
    setIsRunning(true);
    // In production, this calls the actual agent via IPC
    const updated = items.map((item, i) => {
      if (i === 1) {
        return {
          ...item, status: "flagged",
          flagMessage: `I found 847 LF of pipe on SS-PIPE, but there are also 215 LF on a layer called "SAN-SEWER-EXIST". The objects on SAN-SEWER-EXIST appear to be existing infrastructure. Should I include only SS-PIPE?`,
          flagOptions: ["Only SS-PIPE (proposed)", "Include both layers", "Set quantity manually"],
        };
      }
      if (i === 3) {
        return {
          ...item, status: "flagged",
          flagMessage: `Found 3 hatches on PV-HMA totaling 12,450 SY, but one hatch (4,200 SY) overlaps with an area on PV-HMA-BASE. This might be double-counting the mill & overlay zone. Want me to subtract the overlap?`,
          flagOptions: ["Subtract overlap", "Keep both — different work items", "Show me the areas"],
        };
      }
      const qty = item.measurement === "linear" ? Math.round(400 + Math.random() * 1200)
        : item.measurement === "area" ? Math.round(2000 + Math.random() * 10000)
        : Math.round(3 + Math.random() * 15);
      const price = item.measurement === "linear" ? 45 + Math.random() * 80
        : item.measurement === "area" ? 8 + Math.random() * 35
        : 800 + Math.random() * 3000;
      return {
        ...item, status: "complete",
        quantity: qty, unitPrice: Math.round(price * 100) / 100,
        totalCost: Math.round(qty * price),
      };
    });
    setTimeout(() => { setItems(updated); setIsRunning(false); }, 1500);
  };

  const resolveItem = (index, choice) => {
    const item = items[index];
    const qty = item.measurement === "linear" ? 847 : item.measurement === "area" ? 8250 : 6;
    const price = item.measurement === "linear" ? 72.5 : item.measurement === "area" ? 18.75 : 2400;
    updateItem(index, {
      status: "complete", quantity: qty, unitPrice: price, totalCost: Math.round(qty * price),
      flagMessage: null, flagOptions: null,
    });
  };

  const completedCount = items.filter(i => i.status === "complete").length;
  const flaggedCount = items.filter(i => i.status === "flagged").length;
  const totalCost = items.reduce((sum, i) => sum + (i.totalCost || 0), 0);

  return (
    <div style={{
      minHeight: "100vh", background: "#0f1117", color: "#e2e8f0",
      fontFamily: "'DM Sans', sans-serif",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{
        padding: "16px 24px", borderBottom: "1px solid #1e2028",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "#13151b",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #0A2240, #1e3a5f)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, fontWeight: 700, color: "#C40D3C",
          }}>A</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>Cost Estimator</div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>AutoCAD + CostEstDB</div>
          </div>
        </div>
        {items.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 12 }}>
            {completedCount > 0 && (
              <span style={{ color: "#22c55e" }}>✓ {completedCount} complete</span>
            )}
            {flaggedCount > 0 && (
              <span style={{ color: "#f59e0b" }}>⚠ {flaggedCount} needs review</span>
            )}
            <span style={{ color: "#94a3b8", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
              ${totalCost.toLocaleString()}
            </span>
          </div>
        )}
      </div>

      <div style={{ maxWidth: 780, margin: "0 auto", padding: "20px 20px 80px" }}>
        {/* Project name */}
        <div style={{ marginBottom: 16 }}>
          <input
            value={projectName}
            onChange={e => setProjectName(e.target.value)}
            placeholder="Project Name — e.g. Demorrow Road Reconstruction"
            style={{
              width: "100%", padding: "10px 14px", background: "#1a1c23",
              border: "1px solid #2a2d35", borderRadius: 8, color: "#e2e8f0",
              fontSize: 15, fontWeight: 500, fontFamily: "'DM Sans', sans-serif",
              outline: "none", boxSizing: "border-box",
            }}
          />
        </div>

        {/* Preset Picker */}
        {showPicker && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Add Pay Items
              </span>
              {items.length > 0 && (
                <button
                  onClick={() => setShowPicker(false)}
                  style={{
                    background: "transparent", border: "none", color: "#3b82f6",
                    fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                  }}
                >
                  Collapse picker ↑
                </button>
              )}
            </div>
            <PresetPicker onAdd={addItem} />
          </div>
        )}

        {!showPicker && (
          <button
            onClick={() => setShowPicker(true)}
            style={{
              width: "100%", padding: 10, background: "#1a1c23", border: "1px dashed #2a2d35",
              borderRadius: 8, color: "#3b82f6", fontSize: 13, cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif", marginBottom: 16,
            }}
          >
            + Add more pay items
          </button>
        )}

        {/* Pay item list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((item, i) => (
            <PayItemRow
              key={i}
              item={item}
              index={i}
              onUpdate={(updates) => updateItem(i, updates)}
              onRemove={removeItem}
              onResolve={resolveItem}
            />
          ))}
        </div>

        {items.length === 0 && (
          <div style={{
            textAlign: "center", padding: "48px 20px", color: "#4b5060",
          }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📐</div>
            <div style={{ fontSize: 14 }}>Add pay items from the picker above to get started</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Items will be measured from your open AutoCAD drawing</div>
          </div>
        )}

        {/* Action bar */}
        {items.length > 0 && (
          <div style={{
            position: "fixed", bottom: 0, left: 0, right: 0,
            padding: "12px 24px", background: "#13151bee", borderTop: "1px solid #1e2028",
            display: "flex", justifyContent: "center", gap: 10,
            backdropFilter: "blur(12px)",
          }}>
            <button
              onClick={simulateRun}
              disabled={isRunning || items.every(i => i.status !== "pending")}
              style={{
                padding: "10px 28px", borderRadius: 8, border: "none",
                background: isRunning ? "#1e3a5f" : items.every(i => i.status !== "pending") ? "#252830" : "linear-gradient(135deg, #2563eb, #1d4ed8)",
                color: isRunning ? "#60a5fa" : items.every(i => i.status !== "pending") ? "#4b5060" : "#fff",
                fontSize: 14, fontWeight: 600, cursor: isRunning ? "wait" : "pointer",
                fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s",
              }}
            >
              {isRunning ? "Measuring..." : items.every(i => i.status !== "pending") ? "All items processed" : `Measure ${items.filter(i => i.status === "pending").length} Pay Items`}
            </button>
            {items.some(i => i.status === "complete") && (
              <button
                style={{
                  padding: "10px 28px", borderRadius: 8,
                  border: "1px solid #22c55e44", background: "#22c55e15",
                  color: "#22c55e", fontSize: 14, fontWeight: 600, cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                Export to Excel
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## Shared Types (`src/shared/types.ts`)

```typescript
export type MeasurementType = "linear" | "area" | "count";
export type ObjectType = "polyline" | "closedPolyline" | "pipe" | "hatch" | "block";
export type PayItemStatus = "pending" | "processing" | "complete" | "flagged" | "error";

export interface PayItemPreset {
  name: string;
  objectType: ObjectType;
  measurement: MeasurementType;
  defaultLayer: string;
  icon: string;
  fields: string[];  // which attribute fields to show: "diameter", "material", "thickness", etc.
  custom?: boolean;
}

export interface PayItem extends PayItemPreset {
  layer: string;
  status: PayItemStatus;
  // User-entered attributes
  diameter?: string;
  material?: string;
  thickness?: string;
  spec?: string;
  size?: string;
  depth?: string;
  course?: string;
  // Measurement results
  quantity: number | null;
  unitPrice: number | null;
  totalCost: number | null;
  // Resolution
  flagMessage: string | null;
  flagOptions: string[] | null;
  resolutionNotes?: string;
  // CostEstDB source
  priceSource?: string;
}

export interface MeasurementResult {
  success: boolean;
  quantity?: number;
  unit?: string;
  details?: EntitySummary;
  issues?: MeasurementIssue[];
}

export interface MeasurementIssue {
  type: "multiple_layers" | "no_entities" | "unexpected_types" | "overlap" | "artifacts" | "mixed_closed";
  message: string;
  suggestedOptions: string[];
  metadata?: Record<string, any>;
}

export interface EntitySummary {
  layer: string;
  total_entities: number;
  type_counts: Record<string, number>;
  total_lengths_by_type?: Record<string, number>;
  total_areas_by_type?: Record<string, number>;
  polyline_width_breakdown?: Record<string, { count: number; total_length: number }>;
}

export interface EstimateExport {
  projectName: string;
  items: PayItem[];
  totalCost: number;
  exportDate: string;
}

// Object type to AutoCAD ObjectName mapping
export const OBJECT_TYPE_MAP: Record<ObjectType, string> = {
  polyline: "AcDbPolyline",
  closedPolyline: "AcDbPolyline",  // Same ObjectName, filtered by Closed property
  pipe: "AcDbPipe",                 // Civil 3D pipe objects — verify actual ObjectName
  hatch: "AcDbHatch",
  block: "AcDbBlockReference",
};

export const MEASUREMENT_UNITS: Record<MeasurementType, string> = {
  linear: "LF",
  area: "SY",
  count: "EA",
};
```

---

## IPC Contract (`src/main/ipc-handlers.ts`)

Electron IPC channels between renderer and main process:

| Channel | Direction | Payload | Response |
|---|---|---|---|
| `autocad:status` | renderer → main | none | `{ connected: boolean, document: string }` |
| `estimate:measure` | renderer → main | `PayItem[]` | Streams `PayItemUpdate` events back |
| `estimate:resolve` | renderer → main | `{ index: number, userInput: string }` | Streams resolution chat messages |
| `estimate:set-manual` | renderer → main | `{ index: number, quantity: number }` | `{ success: boolean }` |
| `estimate:export` | renderer → main | `EstimateExport` | `{ filePath: string }` |
| `estimate:price` | renderer → main | `{ description: string, unit: string }` | `{ unitPrice: number, source: string }` |

---

## Distribution & Auto-Updates

### Electron Builder Configuration

```yaml
# electron-builder.yml
appId: com.abonmarche.cost-estimator
productName: Cost Estimator
directories:
  output: dist
win:
  target: nsis
  icon: resources/icon.ico
nsis:
  oneClick: false
  perMachine: true
  allowToChangeInstallationDirectory: true
publish:
  provider: generic
  url: https://<azure-blob-or-github-releases-url>/updates/
```

### Update Flow

1. Developer bumps version in `package.json`
2. `npm run build` → `electron-builder` produces installer + `latest.yml`
3. Upload artifacts to Azure Blob Storage (or GitHub Releases)
4. On app launch, `electron-updater` checks for new `latest.yml`
5. User prompted to update → downloads and installs

---

## Environment & Configuration

```bash
# .env (not committed)
ANTHROPIC_API_KEY=sk-ant-...
COSTESTDB_MCP_URL=https://func-costestdb-mcp.azurewebsites.net/runtime/webhooks/mcp/sse
AUTOCAD_PROGID=AutoCAD.Application.24.3

# Optional
UPDATE_SERVER_URL=https://...
```

---

## Implementation Order

Suggested build sequence:

1. **Scaffold Electron + React + Vite** — get a window rendering with hot reload
2. **AutoCAD COM proof-of-concept** — use `winax` to connect and call `list_layers` from the main process, display results in the renderer
3. **Port `get_entities_on_layer`** — the core measurement function
4. **Build the form UI** — preset picker, pay item rows, using the mockup as reference
5. **Wire deterministic measurement** — form → IPC → direct tool calls → results back to UI
6. **Add flagging logic** — detect ambiguities, show flagged state in UI
7. **Integrate Agent SDK** — resolution chat for flagged items using `query()` with in-process AutoCAD + remote CostEstDB MCPs
8. **CostEstDB pricing** — after measurement, query CostEstDB for unit prices
9. **Excel export** — generate formatted spreadsheet from completed estimate
10. **Electron packaging** — `electron-builder` config, auto-update, installer

---

## Key Risks & Considerations

- **`winax` + Electron compatibility**: `winax` is a native addon that must be compiled against Electron's Node version. Test `electron-rebuild` early (step 2).
- **AutoCAD COM threading**: COM calls must happen on the main thread. Electron's main process is single-threaded, which is fine, but long iterations over large modelspaces could block the UI. Consider using `setImmediate` batching or worker threads if performance is an issue.
- **Civil 3D pipe networks**: Pipe network objects may have different ObjectNames than standard AutoCAD entities. The current Python MCP handles `AcDbPipe` but Civil 3D objects may be `AeccDbPipe` or similar. Test with real drawings and adjust the object type mapping.
- **Drawing units**: AutoCAD lengths are in drawing units (usually feet for civil work). The app should assume feet for LF and calculate SY from square feet (÷9). This should be configurable or auto-detected from the drawing's unit settings.
- **API key security**: The `ANTHROPIC_API_KEY` should not be hardcoded. Load from environment or a secure store. For team distribution, consider Azure Key Vault or encrypted local config.
- **Anthropic branding**: Per the Agent SDK terms, the app should maintain Abonmarche branding and not appear to be a Claude/Anthropic product. The "Estimator Assistant" persona is fine.
