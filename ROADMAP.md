# Product Roadmap — CAD Cost Estimator

Tracks architectural changes planned beyond the current scope. Items are ordered roughly by sequence, not strict priority. Each item documents **why** (motivation), **what** (target state), and **when** (triggering conditions or sequencing).

This document is a living artifact — update it when decisions change or new items surface.

---

## Current state (v0)

- Electron + React + TypeScript scaffold, built via `electron-vite`
- `winax` (Node.js native addon) for AutoCAD COM automation
- CostEstDB remote MCP accessed via Azure Function key (embedded in local `.env`)
- Anthropic API key held in local `.env` for the Agent SDK resolution chat
- Windows-only distribution; native module rebuild handled at packaging time by `electron-builder`
- CI on `windows-latest` running typecheck + JS build only (see "Current trade-offs" below)

---

## Near-term (next 1–2 iterations)

### 1. Migrate CostEstDB MCP from function-key to Entra ID / OAuth

**Effort:** medium (~1–2 days)
**Status:** not started

**Why:**

- Unify auth with the other Abonmarche MCPs that already use OAuth
- Gain per-user audit trail at the MCP layer (who queried what, when)
- Automatic revocation when a user leaves M365 — no shared-key rotation needed
- Eliminate a static shared secret

**Plan:**

- **Azure side:** enable Easy Auth with Entra provider on the CostEstDB Function App. Run function-key and OAuth in parallel during migration so existing clients keep working.
- **App side:** add `@azure/msal-node` auth service in the Electron main process. Sign-in opens a system browser; tokens cached in OS keychain (`@napi-rs/keyring` or similar).
- **Wire-up:** swap the `x-functions-key` header for `Authorization: Bearer <token>` in `src/main/tools/costestdb.ts`.
- **Other clients:** update Claude Desktop / Code MCP configs to the OAuth flow (already used on other MCPs, so the pattern is familiar).
- **Cutover:** once every known client is migrated, disable function-key auth on the Function App.

**Non-goals:** adding per-user rate limits, quotas, or usage dashboards at this stage — those belong with the Azure proxy work below.

---

## Mid-term (v1 distribution milestone)

### 2. Azure-backed secret management and authenticated proxy

**Effort:** large (~3–5 days)
**Status:** not started

**Why:**

- Remove the Anthropic API key from every user's local `.env` / installer — anything shipped is extractable
- Centralize visibility on who is calling which API and how often
- Apply per-user rate limits and disable access when an employee leaves, automatically
- Align with the CostEstDB OAuth work above so the whole app runs on a single auth story

**Target architecture:**

```
Azure Key Vault              ← holds Anthropic key + any residual CostEstDB secret
    ↑ (Managed Identity)
Azure Function (proxy)       ← forwards app requests to upstream APIs
    ↑ (Bearer token)
Entra ID (M365)              ← authenticates Abonmarche users
    ↑
Electron desktop app         ← holds only a user token; zero secrets at rest
```

**What gets shipped in the installer:**

- The app itself
- The proxy URL (public; not a secret)
- The Entra app registration client ID (public by design)

**What the proxy does:**

- Validates the Bearer token against Entra ID
- Reads secrets from Key Vault via its Managed Identity
- Forwards to Anthropic (via the org API key) and, if still needed, CostEstDB
- Logs the calling user and request metadata for audit

**Sequencing notes:**

- Do item #1 (MCP OAuth) first — it simplifies what the proxy has to cover for CostEstDB
- Proxy can start Anthropic-only and expand later if needed
- The proxy is a small Azure Function App; expected cost ~$5–20/month at this scale

---

## Long-term (v2 and beyond)

### 3. Replace `winax` with a .NET AutoCAD sidecar

**Effort:** large initial (~3–5 days), ongoing maintenance wins
**Status:** not started

**Why:**

- `winax` is a lightly maintained npm package; native compile is brittle across Node/Electron/Python version bumps (already bit us in CI — see item below)
- AutoCAD's first-class automation surface is **.NET** (`Autodesk.AutoCAD.Interop`), not COM — richer APIs, better documentation, official Autodesk support
- A decoupled sidecar process is easier to version, test, and replace than an in-process native addon
- Unlocks richer integrations (command sending, block insertion, layer manipulation) beyond the current read-only queries

**Current state (v0):**

- `winax` is used in `src/main/tools/autocad/*` for: `server_status`, `list_layers`, `get_entities_on_layer`, `get_entity_details`
- All read-only; no drawing modification
- `electron-builder install-app-deps` rebuilds `winax` at packaging time on the release machine

**Target state:**

- New C# console project under `tools/autocad-sidecar/` using .NET 8
- Uses `Autodesk.AutoCAD.Interop` against a running AutoCAD instance
- Electron main process spawns the sidecar as a child process
- JSON-RPC over stdio for all requests/responses
- .NET runtime bundled via self-contained deployment (adds ~50MB to installer; acceptable trade-off)
- `winax` dependency removed entirely
- CI can return to a full build (no more native-compile carveouts)

**Triggering conditions — do this when:**

- `winax` breaks on a future Node or Electron upgrade (likely within 1–2 years)
- We need richer AutoCAD interaction (block insertion, drawing modification, multi-document handling)
- Packaging / distribution pain compounds (cross-machine rebuild failures, signed-binary issues, etc.)

Until then, the current `winax`-based implementation is acceptable; its API surface is small and stable for what we need.

---

## Current trade-offs (context, not future work)

### CI narrowed to skip native module compile

**Decided:** 2026-04-16

GitHub's `windows-latest` runners have Python 3.12 (incompatible with `node-gyp`'s `distutils` usage) and VS2022 without the ATL components `winax` requires. Getting a reliable native compile in CI is a rabbit hole that doesn't pay for itself.

**What CI currently verifies:**

- TypeScript typecheck (main + renderer + shared)
- Vite / electron-vite JS build
- (Future) unit tests via Vitest

**What CI does NOT verify:**

- `winax` or other native-module compilation
- AutoCAD integration (requires AutoCAD installed on the runner — not available)
- Installer packaging (runs on dev laptop / release machine instead)

**Revisit this decision when:**

- Item #3 above lands — the .NET sidecar removes the `winax` native compile problem entirely, and CI can go back to a full build
- GitHub runners ship a toolchain combination that makes `winax` build cleanly out of the box (unlikely soon)

---

## Out of scope for this roadmap

Items we may care about eventually but aren't planning around right now:

- Auto-update distribution via `electron-updater` (decide after item #2 lands)
- Opt-in usage telemetry (Azure App Insights or similar)
- Shared project estimates / multi-user collaboration
- Reusable pay-item template library per project type (road reconstruction, subdivision, utility replacement)
- macOS / Linux support (not applicable — AutoCAD is Windows-only)
