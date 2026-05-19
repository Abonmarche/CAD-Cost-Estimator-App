/**
 * Claude Agent SDK orchestration for the resolution-chat phase.
 *
 * When a pay item is flagged (multiple layers, unexpected types, etc.),
 * the renderer opens a scoped chat for that single item. This module drives
 * the `query()` loop: builds the system prompt, connects the in-process
 * AutoCAD MCP + remote CostEstDB MCP, and streams messages back.
 *
 * Design notes:
 *   - `maxTurns` is capped so a runaway resolution bails out and offers
 *     the "Set quantity manually" escape hatch to the user.
 *   - The agent never sees other pay items — the context is strictly
 *     scoped to the one it's resolving.
 */

import { app } from 'electron';
import { join } from 'node:path';

import type { ResolveMessage, ResolvePayload } from '@shared/types';
import { getAutocadServer } from './tools/autocad/server';
import { getCostEstDbConfig, COSTESTDB_TOOL_NAMES } from './tools/costestdb';
import { buildPayItemDescription } from '@shared/presets';
import { getApiToken } from './auth/tokens';

/**
 * Locate the SDK's `cli.js` for the spawned subprocess.
 *
 * The Agent SDK auto-resolves cli.js relative to its own `sdk.mjs` via
 * `createRequire(import.meta.url).resolve('./cli.js')`. In packaged
 * Electron, that returns a path inside `app.asar`. The SDK then runs
 * `spawn('node', [thatPath])` — but plain Node has no asar reader, so
 * it fails with MODULE_NOT_FOUND on the entry file itself.
 *
 * Electron-builder's `asarUnpack` rule copies the SDK to
 * `app.asar.unpacked/`, so we just need to rewrite the asar path the
 * SDK would have used. In dev (no asar), return undefined and let the
 * SDK's auto-locator handle it normally.
 */
function resolveAgentCliPath(): string | undefined {
  const appPath = app.getAppPath();
  if (!appPath.includes('app.asar')) return undefined;
  const unpacked = appPath.replace(
    /app\.asar(?!\.unpacked)/,
    'app.asar.unpacked',
  );
  return join(
    unpacked,
    'node_modules',
    '@anthropic-ai',
    'claude-agent-sdk',
    'cli.js',
  );
}

/**
 * Drive the resolution agent for a single pay item. Async-iterator so the
 * caller (ipc-handlers) can stream each message to the renderer as soon as
 * it arrives from the SDK.
 */
export async function* resolvePayItem(
  payload: ResolvePayload,
): AsyncGenerator<ResolveMessage> {
  const { itemId, userInput, item } = payload;

  // Lazy-load the Agent SDK so the main process boots even if the API
  // key or sdk install is missing — only the resolution chat will fail.
  let query: typeof import('@anthropic-ai/claude-agent-sdk').query;
  try {
    ({ query } = await import('@anthropic-ai/claude-agent-sdk'));
  } catch (e) {
    yield {
      itemId,
      kind: 'error',
      text: `Claude Agent SDK not available: ${(e as Error).message}`,
    };
    return;
  }

  // Fetch a fresh MSAL access token scoped for the LLM API. The proxy
  // (func-cost-estimator-llm) validates this token before forwarding to
  // api.anthropic.com with the real key from Key Vault. The SDK sends our
  // token in the x-api-key header (its standard auth path); the proxy
  // accepts it from either x-api-key or Authorization.
  let llmToken: string;
  try {
    llmToken = await getApiToken('llm');
  } catch (e) {
    yield {
      itemId,
      kind: 'error',
      text: `Could not acquire LLM access token — please sign out and back in. (${(e as Error).message})`,
    };
    return;
  }

  const proxyUrl = process.env.LLM_PROXY_URL;
  if (!proxyUrl) {
    yield {
      itemId,
      kind: 'error',
      text: 'LLM_PROXY_URL is not baked into this build.',
    };
    return;
  }

  const prompt = buildResolutionPrompt(item, userInput);
  const systemPrompt = buildSystemPrompt();

  // The SDK spawns the Claude Code CLI as a subprocess. If that subprocess
  // exits non-zero, the SDK throws "Claude Code process exited with code N"
  // — but the real cause lives in its stderr. Buffer the tail so we can
  // surface something actionable to the user instead of an opaque message.
  const stderrTail: string[] = [];
  const STDERR_TAIL_MAX = 40;

  try {
    const autocadServer = await getAutocadServer();
    const cliPath = resolveAgentCliPath();
    for await (const msg of query({
      prompt,
      options: {
        systemPrompt,
        // Force the SDK to spawn cli.js from the asar-unpacked copy in
        // packaged builds. Undefined in dev so its auto-locator runs.
        ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
        mcpServers: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          autocad: autocadServer as any,
          costestdb: getCostEstDbConfig(),
        },
        allowedTools: [
          'mcp__autocad__server_status',
          'mcp__autocad__list_layers',
          'mcp__autocad__get_entities_on_layer',
          'mcp__autocad__get_entity_details',
          ...COSTESTDB_TOOL_NAMES,
        ],
        // Pin to claude-sonnet-4-5 (the legacy Sonnet alias, which resolves
        // to the dated snapshot claude-sonnet-4-5-20250929 per Anthropic's
        // docs). We tried claude-sonnet-4-6 in v0.4.4 and it failed with
        // "may not exist or you may not have access" against the Key Vault
        // key. Whether that's a key-side access gap or an SDK regression
        // (see https://github.com/anthropics/claude-code/issues/26408), 4-5
        // is widely available and unblocks the resolution flow.
        // `fallbackModel` only triggers on overload/unavailable, not on
        // access-denied — so it can't paper over a model gap. Use Haiku
        // as the overload fallback since it's the most under-loaded model.
        // Bump back to 4-6 once the diagnostic (scripts/check-anthropic-
        // access.py) confirms the key has access.
        model: 'claude-sonnet-4-5',
        fallbackModel: 'claude-haiku-4-5',
        maxTurns: 10,
        // `debug: true` makes the CLI write verbose diagnostics to stderr.
        // Cheap to enable — these only surface when something goes wrong.
        debug: true,
        stderr: (data: string) => {
          // Mirror to the main-process console so dev / packaged-app logs
          // capture the full stream, then keep a bounded tail in memory.
          console.error('[agent stderr]', data.trimEnd());
          for (const line of data.split(/\r?\n/)) {
            if (!line.trim()) continue;
            stderrTail.push(line);
            if (stderrTail.length > STDERR_TAIL_MAX) stderrTail.shift();
          }
        },
        env: {
          ...process.env,
          // Substitute the MSAL token for the API key. The underlying
          // @anthropic-ai/sdk reads ANTHROPIC_API_KEY and sends it as
          // `x-api-key`; the proxy validates it as a JWT.
          ANTHROPIC_API_KEY: llmToken,
          // Redirect the SDK's base URL to our proxy. The proxy's catch-all
          // route is `/v1/{*path}`, so the SDK's normal /v1/messages call
          // lands at func-cost-estimator-llm.azurewebsites.net/v1/messages.
          ANTHROPIC_BASE_URL: proxyUrl,
        },
      },
    })) {
      const converted = convertSdkMessage(itemId, msg);
      if (converted) yield converted;
    }
  } catch (e) {
    const baseMessage = (e as Error).message;
    // For the opaque "process exited with code N" case, splice in the last
    // few stderr lines so the renderer chat has something to act on.
    const isSubprocessExit = /process exited with code/i.test(baseMessage);
    const tailText = stderrTail.length
      ? '\n\nLast diagnostics:\n' + stderrTail.slice(-8).join('\n')
      : '';
    yield {
      itemId,
      kind: 'error',
      text: isSubprocessExit && tailText ? baseMessage + tailText : baseMessage,
    };
  }
}

function buildSystemPrompt(): string {
  return [
    "You are the 'Estimator Assistant', an AI helper embedded in Abonmarche Consultants' Cost Estimator desktop app.",
    'Your sole job is to help the user resolve a single flagged pay item. Never broaden the conversation — stay focused on this one item.',
    'Tools available to you:',
    '  - mcp__autocad__server_status / list_layers / get_entities_on_layer / get_entity_details — read the active AutoCAD drawing.',
    '  - mcp__costestdb__search_pay_items / get_project_summary / list_ingested_projects — look up historical bid prices.',
    '',
    'Guidance for AutoCAD measurements:',
    '  - Lengths are reported in drawing units, typically feet. Treat as LF.',
    '  - Areas are in square drawing units (square feet). Divide by 9 for SY.',
    '  - AcDbPolyline covers both 2D lightweight polylines; use the Closed property to tell open from closed.',
    '  - Civil 3D pipe networks may use AeccDbPipe or AcDbPipe — check both if needed.',
    '',
    'Guidance for CostEstDB lookups (CRITICAL — terminology mapping):',
    '  The database contains Michigan DOT (MDOT) bid tabulations. MDOT uses specific nomenclature.',
    '  Natural language enriched with MDOT terms scores HIGHER than terse MDOT codes.',
    '  Always set unit= and quantity= when calling search_pay_items.',
    '',
    '  Terminology mapping (common term → MDOT search term):',
    '    Catch basin / inlet → "Dr Structure, 48 inch" (MDOT calls these Drainage Structure, include diameter)',
    '    Storm sewer → "Sewer, Cl IV, 12 inch" or "12 inch storm sewer"',
    '    Sanitary sewer → "Sewer, Cl IV, 12 inch" or "12 inch sanitary sewer"',
    '    HMA / hot mix → "HMA surface course" (unit=TON, mix codes: 4EML, 5EML, 4EL, 13A, 36A)',
    '    Pavement removal → "remove existing pavement" (unit=SYD, natural language scores higher than "Pavt, Rem")',
    '    Curb and gutter → "concrete curb and gutter" (Det C3=barrier, Det C4=mountable, unit=FT)',
    '    Manhole → "Sanitary Manhole, 48 inch" (unit=EA, for storm also try "Dr Structure")',
    '    Water main → "Water Main, DI" + size (DI=ductile iron, unit=FT)',
    '    Water service → "Water Service" + size (unit=FT)',
    '    Aggregate base → "Aggregate Base, 8 inch" (unit=SYD)',
    '    Sidewalk → "Sidewalk, Conc, 4 inch" (unit=SFT)',
    '    Driveway → "Driveway, Nonreinf Conc, 6 inch" (unit=SYD)',
    '    Excavation → "Excavation, Earth" (unit=CYD)',
    '    Cold milling → "Cold Milling HMA Surface" (unit=SYD)',
    '',
    '  Similarity scores: 0.75+=strong, 0.65-0.75=good, <0.65=warn user.',
    '  Bids marked (EE) are engineer estimates — report separately from contractor bids.',
    '  Prefer recent Michigan projects. Always report the source project for provenance.',
    '  Known data gaps: geotextile, temp barriers, 6" water service, guardrail, landscaping — warn rather than return poor matches.',
    '',
    'Response style:',
    '  - Keep answers short and specific to this item.',
    '  - When proposing a final quantity or unit price, say so clearly with the numbers — the host app parses your final turn for a resolution.',
    '  - End with 2-3 short quick-pick options for the user to confirm the next action.',
  ].join('\n');
}

function buildResolutionPrompt(
  item: ResolvePayload['item'],
  userInput: string,
): string {
  const desc = buildPayItemDescription(item);
  const allLayers = [item.layer, ...(item.extraLayers ?? [])]
    .map((s) => s.trim())
    .filter(Boolean);
  const layerLine =
    allLayers.length > 1
      ? `Layers: ${allLayers.join(', ')}`
      : `Layer: ${item.layer}`;
  const lines = [
    `Pay item: ${desc}`,
    layerLine,
    `Object type: ${item.objectType}`,
    `Measurement: ${item.measurement}`,
    item.quantity !== null ? `Current measurement: ${item.quantity}` : null,
    item.flagMessage
      ? `Flag reason: ${item.flagMessage}`
      : null,
    '',
    `User response: ${userInput}`,
  ].filter(Boolean);
  return lines.join('\n');
}

/**
 * Translate an SDK message into the compact ResolveMessage shape we ship
 * over IPC. Returns null for message types we don't surface.
 */
function convertSdkMessage(
  itemId: string,
  msg: unknown,
): ResolveMessage | null {
  const m = msg as {
    type?: string;
    message?: { content?: Array<Record<string, unknown>> };
    content?: Array<Record<string, unknown>>;
  };
  if (!m?.type) return null;

  if (m.type === 'assistant') {
    const blocks = m.message?.content ?? [];
    const text = blocks
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text?: string }).text ?? '')
      .join('\n')
      .trim();
    const toolUse = blocks.find((b) => b.type === 'tool_use') as
      | { name?: string }
      | undefined;
    if (toolUse?.name) {
      return { itemId, kind: 'tool_use', toolName: toolUse.name, text };
    }
    if (text) return { itemId, kind: 'assistant', text };
    return null;
  }

  if (m.type === 'user') {
    // User turn = tool_result blocks streamed back from the SDK.
    const blocks = m.message?.content ?? [];
    const toolResult = blocks.find((b) => b.type === 'tool_result');
    if (toolResult) return { itemId, kind: 'tool_result' };
    return null;
  }

  if (m.type === 'result') {
    const text = (m as { result?: string }).result ?? '';
    return { itemId, kind: 'final', text };
  }

  return null;
}
