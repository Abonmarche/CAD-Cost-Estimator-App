# CLAUDE.md — Cost Estimator

## What This Is

An Electron desktop app for Abonmarche Consultants that automates construction cost estimating. It reads quantities from an open AutoCAD drawing (polyline lengths, hatch areas, block counts) and prices them against historical bid data from CostEstDB.

## Full Specification

Read `cost-estimator-spec.md` in the project root before starting any implementation work. It contains the complete architecture, repository layout, COM integration details, Agent SDK patterns, UI mockup code, shared types, IPC contract, and implementation order.

## Architecture Summary

- **Electron app** — React renderer + Node.js main process
- **Claude Agent SDK** (TypeScript) — orchestrates AI resolution when measurements are ambiguous
- **AutoCAD tools** — defined as in-process MCP tools via `createSdkMcpServer`, using `winax` for COM automation. These are NOT a separate MCP server process. They live in `src/main/tools/autocad/`.
- **CostEstDB** — remote MCP server on Azure (already deployed). Connected via HTTP URL, not embedded in this app.

## Key Technical Decisions

- AutoCAD COM access uses `winax` (Node.js native addon), NOT Python. The original Python MCP exists separately and is not part of this repo.
- `winax` requires `electron-rebuild` after install. Run `npm run rebuild` after `npm install`.
- The AutoCAD COM ProgID is `"AutoCAD.Application.24.3"` (AutoCAD 2024).
- Only read-only AutoCAD tools are needed: `server_status`, `list_layers`, `get_entities_on_layer`, `get_entity_details`. No draw/extrude/revolve.
- Measurement runs deterministically first (direct tool calls, no LLM). The Agent SDK is only invoked for resolving flagged ambiguities via a scoped chat.
- CostEstDB MCP URL: `https://func-costestdb-mcp.azurewebsites.net/runtime/webhooks/mcp/sse`

## Dev Workflow

```powershell
npm install                 # installs deps + runs electron-builder install-app-deps (rebuilds winax)
npm run rebuild             # re-run only if winax fails to load
npm run dev                 # electron-vite hot reload (requires AutoCAD 2024 running)
npm run typecheck           # type-check both main and renderer
npm run package             # build installer without publishing
```

## UX Pattern

Wizard flow: **Form → Measure → Review → Export**

1. User adds pay items from preset picker (utilities, paving, sidewalk, misc) or custom entry
2. Each item specifies: name, layer, object type, material, diameter/thickness/etc.
3. App measures all items deterministically via AutoCAD COM
4. Clean results show green. Ambiguous results get flagged yellow with an AI chat for resolution.
5. Completed estimate exports to Excel via `exceljs`

## Abonmarche Brand

- Colors: Navy `#0A2240`, Red `#C40D3C`
- Font: Century Gothic (for documents/exports), DM Sans (for app UI)
- The AI chat persona is "Estimator Assistant" — not Claude, not Anthropic branded

## Stack

Electron, React, TypeScript, Vite (via electron-vite), `@anthropic-ai/claude-agent-sdk`, `winax`, `exceljs`, `zod`, `electron-builder`

## Project Layout

```
src/
  main/            Electron main process (Node.js)
    index.ts       Window + app lifecycle
    agent.ts       Claude Agent SDK orchestration
    ipc-handlers.ts  Renderer ↔ main bridge
    measurement.ts  Deterministic measurement orchestration
    flagging.ts    Heuristics for flagging ambiguous measurements
    tools/
      autocad/     In-process MCP tools (winax COM)
      costestdb.ts Remote MCP config
  preload/         contextBridge API
  renderer/        React app (browser context)
    src/
      App.tsx
      components/
      hooks/
      styles/
  shared/          Types & constants used by both processes
```
