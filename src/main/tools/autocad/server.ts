/**
 * In-process MCP server exposing the AutoCAD tools to the Claude Agent SDK.
 *
 * These tools are only invoked by the agent during the resolution-chat
 * phase. The deterministic measurement phase calls the underlying
 * functions directly (see src/main/measurement.ts) to avoid the LLM
 * round-trip.
 *
 * ⚠ The Agent SDK is pure ESM and cannot be `require()`d from the
 * CommonJS main bundle. Everything that imports it must do so via a
 * dynamic `import()`. We expose an async factory (`getAutocadServer`)
 * that callers await — this keeps the SDK off the critical path for app
 * startup, which would otherwise fail with ERR_REQUIRE_ESM.
 */

import { z } from 'zod';

import { getServerStatus } from './status';
import { listLayers } from './layers';
import { getEntitiesOnLayer } from './entities';
import { getEntityDetails } from './details';

function textResult(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text:
          typeof payload === 'string' ? payload : JSON.stringify(payload),
      },
    ],
  };
}

function errorResult(message: string) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ success: false, error: message }),
      },
    ],
    isError: true,
  };
}

// Cache the server across resolutions — creating it is cheap but creating
// it exactly once keeps object identity stable for the SDK's internals.
let _server: unknown = null;

export async function getAutocadServer(): Promise<unknown> {
  if (_server) return _server;

  const { tool, createSdkMcpServer } = await import(
    '@anthropic-ai/claude-agent-sdk'
  );

  const serverStatusTool = tool(
    'server_status',
    'Report the current AutoCAD connection state, the active document name, and the drawing units. Use at the start of a session to verify a drawing is open.',
    {},
    async () => {
      try {
        return textResult({ success: true, ...getServerStatus() });
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  const listLayersTool = tool(
    'list_layers',
    'List every layer in the current AutoCAD drawing with its on/off, frozen, locked, color, and linetype state. Useful for disambiguating similarly-named layers.',
    {},
    async () => {
      try {
        const layers = listLayers();
        return textResult({ success: true, count: layers.length, layers });
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  const getEntitiesOnLayerTool = tool(
    'get_entities_on_layer',
    'Get every entity on a specific layer. Optionally narrow by entity type (e.g. LWPOLYLINE, INSERT, HATCH — these are DXF names, not AcDb* names). Returns a summary with counts, total lengths, total areas, polyline width breakdown, and the full entity list. This is the primary measurement tool for quantity takeoffs.',
    {
      layer_name: z
        .string()
        .describe('Exact layer name to query (case-sensitive)'),
      entity_type: z
        .string()
        .optional()
        .describe(
          "Optional DXF entity type filter — e.g. 'LWPOLYLINE', 'INSERT', 'HATCH'. Comma-separated values act as OR. Leave unset to return everything on the layer.",
        ),
    },
    async ({ layer_name, entity_type }) => {
      try {
        const dxf_types = entity_type
          ? entity_type.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined;
        const result = getEntitiesOnLayer({ layer_name, dxf_types });
        return textResult({ success: true, ...result });
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  const getEntityDetailsTool = tool(
    'get_entity_details',
    'Fetch the full property bag for a single entity by its ObjectID — length, area, coordinates, block name, attributes, bounding box, etc.',
    {
      entity_id: z
        .number()
        .int()
        .positive()
        .describe('ObjectID of the entity (from get_entities_on_layer).'),
    },
    async ({ entity_id }) => {
      try {
        const details = getEntityDetails(entity_id);
        return textResult({ success: true, details });
      } catch (e) {
        return errorResult((e as Error).message);
      }
    },
  );

  _server = createSdkMcpServer({
    name: 'autocad',
    version: '1.0.0',
    tools: [
      serverStatusTool,
      listLayersTool,
      getEntitiesOnLayerTool,
      getEntityDetailsTool,
    ],
  });

  return _server;
}
