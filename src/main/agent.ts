/**
 * Claude Agent SDK orchestration for the resolution-chat phase.
 *
 * When a pay item is flagged (multiple layers, unexpected types, etc.),
 * the renderer opens a scoped chat for that single item. This module
 * drives the `query()` loop: builds the system prompt, connects the
 * in-process AutoCAD MCP, and streams messages back to the renderer.
 *
 * Scope of the agent:
 *   - READ-ONLY drawing investigation (list layers, measure entity
 *     content on candidate layers, inspect entity details).
 *   - Suggest specific edits to the pay item card via structured
 *     "suggestion" blocks the renderer parses into Apply buttons.
 *   - Does NOT price (no CostEstDB tools) and does NOT assign final
 *     quantities. Once the card is correct, the host app re-measures
 *     deterministically and looks up pricing on its own.
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
          // CostEstDB intentionally not exposed to the agent. Pricing
          // happens in the deterministic priceLookup path on the
          // renderer side once the pay item card is configured correctly.
        },
        allowedTools: [
          'mcp__autocad__server_status',
          'mcp__autocad__list_layers',
          'mcp__autocad__get_entities_on_layer',
          'mcp__autocad__get_entity_details',
        ],
        // Latest dateless Sonnet ID per Anthropic's docs. The Key Vault
        // key has been verified (via scripts/test-agent-sdk.mjs) to have
        // access to claude-sonnet-4-6 against api.anthropic.com. The
        // "may not have access" errors we chased through v0.4.2-v0.4.5
        // were all downstream symptoms of the proxy's /api route prefix
        // returning 404 before the API was ever reached. Once host.json
        // drops that prefix and the function redeploys, 4-6 works.
        model: 'claude-sonnet-4-6',
        fallbackModel: 'claude-sonnet-4-5',
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
    '',
    'Your job: investigate the user\'s open AutoCAD drawing and suggest a specific fix to ONE flagged pay item\'s setup card. The host app handles measurement and pricing deterministically once the card is configured correctly — you do not need to (and should not) provide a final quantity or unit price.',
    '',
    'Tools available (all read-only AutoCAD):',
    '  - mcp__autocad__server_status — check the drawing connection.',
    '  - mcp__autocad__list_layers — enumerate every layer in the active drawing.',
    '  - mcp__autocad__get_entities_on_layer — count entities and report total length/area per type on a layer. Use this as evidence: a layer with 487 LF of polylines is more likely the right one than an empty layer.',
    '  - mcp__autocad__get_entity_details — inspect a specific entity\'s properties.',
    '',
    'Drawing conventions to know:',
    '  - Polyline lengths come back in drawing units (typically feet, treat as LF).',
    '  - Hatch areas come back in square feet (divide by 9 for SY).',
    '  - AcDbPolyline covers both 2D lightweight polylines; the Closed property tells open from closed.',
    '  - Civil 3D pipe networks may use AcDbPipe or AeccDbPipe.',
    '  - "X-" layer prefix usually marks xref content (existing conditions from someone else\'s drawing).',
    '  - "P-" prefix is usually proposed work — typically what the user wants to estimate.',
    '',
    'How to respond:',
    '  - Stay scoped to the one flagged item. Don\'t broaden the conversation.',
    '  - Use markdown freely — bold, tables (great for layer comparisons), inline code for layer names, numbered or bulleted lists. The host renders GitHub-flavored markdown.',
    '  - You may SHARE measurement findings as evidence ("P-UTIL Water UG has 487 LF of polylines; P-UTIL Water STR contains only blocks"). Do NOT present a number as the pay item\'s final quantity — the host re-measures with stricter filters once the card is correct.',
    '  - Never quote prices or suggest unit costs. Pricing is handled by the host app.',
    '',
    'Ending your response — suggestion blocks:',
    '  When you have a concrete fix to recommend, end with ONE OR MORE fenced suggestion blocks. The host parses these into "Apply" buttons the user clicks to write the patch back to the pay item card.',
    '',
    '  Fence syntax (exactly this tag): ```cost-estimator-suggestion',
    '  Body: JSON of the shape:',
    '    { "label": "string — action-oriented button text",',
    '      "patch": { ...partial pay item fields... } }',
    '',
    '  Patch fields you can set:',
    '    - "layer": primary CAD layer name (string)',
    '    - "extraLayers": additional layer names to combine into one item (string array)',
    '    - "objectType": one of "polyline", "closedPolyline", "pipe", "hatch", "block"',
    '    - "material" / "diameter" / "thickness" / "size" / "depth" / "course" / "spec": attribute strings',
    '',
    '  If the user\'s question is exploratory ("what layers have water?") and you can\'t recommend a single fix yet, you may omit the suggestion blocks and just present findings — the user will reply.',
    '',
    'Example response:',
    '',
    '  Three layers match "water":',
    '',
    '  | Layer | Content | Notes |',
    '  |---|---|---|',
    '  | `P-UTIL Water UG` | 487 LF polyline | Proposed underground main |',
    '  | `P-UTIL Water STR` | 12 block refs | Valves/hydrants — not pipe |',
    '  | `P-UTIL Water Fire UG` | empty | Fire main, unused here |',
    '',
    '  `P-UTIL Water UG` is the match — proposed underground water main with actual pipe geometry.',
    '',
    '  ```cost-estimator-suggestion',
    '  { "label": "Use P-UTIL Water UG", "patch": { "layer": "P-UTIL Water UG" } }',
    '  ```',
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
