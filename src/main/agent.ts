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

import type { ResolveMessage, ResolvePayload } from '@shared/types';
import { getAutocadServer } from './tools/autocad/server';
import { getCostEstDbConfig, COSTESTDB_TOOL_NAMES } from './tools/costestdb';
import { buildPayItemDescription } from '@shared/presets';

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

  if (!process.env.ANTHROPIC_API_KEY) {
    yield {
      itemId,
      kind: 'error',
      text:
        'ANTHROPIC_API_KEY is not set. Add it to your .env file to enable the Estimator Assistant.',
    };
    return;
  }

  const prompt = buildResolutionPrompt(item, userInput);
  const systemPrompt = buildSystemPrompt();

  try {
    const autocadServer = await getAutocadServer();
    for await (const msg of query({
      prompt,
      options: {
        systemPrompt,
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
        maxTurns: 10,
      },
    })) {
      const converted = convertSdkMessage(itemId, msg);
      if (converted) yield converted;
    }
  } catch (e) {
    yield {
      itemId,
      kind: 'error',
      text: (e as Error).message,
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
