# Cost Estimator

Electron desktop app for Abonmarche Consultants that reads quantities from an open AutoCAD drawing and prices them against historical bid data from CostEstDB. Uses the Claude Agent SDK with in-process AutoCAD COM tools and a remote CostEstDB MCP server.

See `cost-estimator-spec.md` for the full specification and `CLAUDE.md` for contributor notes.

## Prerequisites

- Windows 10/11
- Node.js 20+ (tested on 24.4)
- AutoCAD 2024 (for runtime — not needed to build)
- **Visual Studio 2022 Build Tools** with the *Desktop development with C++* workload — required to compile the `winax` native addon. Python 3.x must also be on PATH for `node-gyp`.
- An Anthropic API key in `.env` (only required for the resolution-chat feature)

### Node 24 gotcha

Node 24's `common.gypi` defaults `msbuild_toolset` to `ClangCL`, which the default VS Build Tools install doesn't include. `npm run rebuild` sets `npm_config_clang=0` to force the classic MSVC v143 toolset instead. If you call `electron-rebuild` directly (without our wrapper), you must pass `--clang=0` or pre-set that env var.

## Install

```powershell
npm install
# If winax fails to build, install VS Build Tools and then:
npm run rebuild
```

## Run

```powershell
cp .env.example .env      # then edit to add ANTHROPIC_API_KEY
npm run dev               # hot-reload dev server + Electron window
```

Requires AutoCAD 2024 running with a drawing open. The status chip in the header will go green when the COM connection succeeds.

## Build a Windows installer

```powershell
npm run package           # produces dist/Cost Estimator-<version>-setup.exe
```

This builds the installer locally without uploading anything. To actually ship a new version to installed users, see the next section.

## Releasing updates

> **Pushing to `main` does not update the installer hosted on Azure.** Releases are a deliberate, manual step. Tag pushes also do nothing. The only thing that updates the downloadable installer and the auto-update feed is running the release script below.

The deploy command, from a Windows checkout with `az login` completed and Developer Mode on:

```powershell
# 1. Bump "version" in package.json, PR + merge it, then tag + push:
git checkout main && git pull
git tag v0.X.Y && git push origin v0.X.Y

# 2. Build + upload to Azure Blob Storage:
npm run release
```

`npm run release` runs [`scripts/release.ps1`](scripts/release.ps1), which:

1. Reads the version from `package.json`.
2. Runs `npm run package` to produce the installer (~2-5 minutes).
3. Resolves the Azure Storage key via `az` if `AZURE_STORAGE_KEY` isn't already in your environment.
4. Uploads the installer, blockmap, and `latest.yml` to `https://stcostestimatordist.blob.core.windows.net/cost-estimator/`.

Anyone with the app already installed gets the new version automatically on next launch (handled by `electron-updater` polling `latest.yml`). For new users, share the installer URL — see [`docs/release-checklist.md`](docs/release-checklist.md) for the user-facing install instructions and the full release runbook.

**Why manual:** the `winax` native addon is brittle on GitHub-hosted Windows runners, so CI is intentionally limited to typecheck + JS build (see [ROADMAP.md](ROADMAP.md) "CI narrowed to skip native module compile"). When `winax` is replaced by a .NET sidecar (ROADMAP item #3), CI can take over the release pipeline.

For the architecture diagram, Azure resource layout, and full distribution background, see [`docs/distribution.md`](docs/distribution.md). Code signing is a planned next step — see [`docs/code-signing-setup.md`](docs/code-signing-setup.md).

## Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` | electron-vite dev server with hot reload |
| `npm run build` | Production bundle for main / preload / renderer |
| `npm run typecheck` | Type-check both main and renderer projects |
| `npm run rebuild` | Re-run `electron-rebuild` for `winax` after a Node/Electron upgrade |
| `npm run package` | Build an NSIS installer locally to `dist/` (no upload) |
| `npm run release` | Build + upload to Azure Blob Storage (the actual deploy) |
| `npm run release:upload-only` | Re-upload existing `dist/` artifacts (for retrying a failed upload) |

## Project layout

```
src/
├── main/            Electron main process (Node.js)
│   ├── index.ts         App lifecycle + window
│   ├── ipc-handlers.ts  Renderer ↔ main bridge
│   ├── measurement.ts   Deterministic measurement orchestration
│   ├── flagging.ts      Heuristics for ambiguous measurements
│   ├── agent.ts         Claude Agent SDK (resolution chat only)
│   ├── pricing.ts       CostEstDB price lookup (direct JSON-RPC)
│   ├── export.ts        Excel export via exceljs
│   └── tools/
│       ├── autocad/     In-process MCP tools (winax COM)
│       │   ├── server.ts        createSdkMcpServer wrapper
│       │   ├── connection.ts    AutoCAD attach via winax
│       │   ├── status.ts        server_status tool
│       │   ├── layers.ts        list_layers tool
│       │   ├── entities.ts      get_entities_on_layer tool (core)
│       │   ├── details.ts       get_entity_details tool
│       │   └── helpers.ts       safeGet, extractSummaryProps, etc.
│       └── costestdb.ts         Remote MCP config for CostEstDB
├── preload/         contextBridge API for renderer
└── renderer/        React app (browser context)
    ├── index.html
    └── src/
        ├── App.tsx
        ├── main.tsx
        ├── components/
        ├── hooks/
        └── styles/

shared/              Types & constants used by both main and renderer
```

## Architecture in one line

The renderer form fires `estimate:measure` IPC; main iterates AutoCAD ModelSpace via `winax` COM, accumulates quantities per pay item, runs flagging heuristics, and streams updates back. Clean items auto-price via CostEstDB. Flagged items open a scoped Claude Agent SDK chat with the AutoCAD + CostEstDB MCP servers attached. Completed estimates export to Excel.
