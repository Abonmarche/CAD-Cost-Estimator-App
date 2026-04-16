/**
 * CostEstDB pricing lookup via the MCP SSE transport.
 *
 * CostEstDB is a remote MCP server on Azure — its tools are accessed over
 * the SSE transport, not plain HTTP POST. We use the official
 * `@modelcontextprotocol/sdk` Client to connect and call `search_pay_items`
 * directly — no LLM round-trip needed for a deterministic price lookup.
 *
 * The client is created lazily and reused across calls within the same
 * session. If the endpoint is unreachable, pricing falls back to
 * `{ unitPrice: null }` so the measurement still completes (the user can
 * enter a price manually or use the resolution chat to look it up).
 */

import type { PriceLookupPayload, PriceLookupResult } from '@shared/types';
import { getCostEstDbConfig } from './tools/costestdb';

// The MCP SDK is pure ESM — lazy-import to avoid ERR_REQUIRE_ESM at boot.
type McpClient = {
  connect: (transport: unknown) => Promise<void>;
  callTool: (params: {
    name: string;
    arguments: Record<string, unknown>;
  }) => Promise<{ content: Array<{ type: string; text?: string }> }>;
  close: () => Promise<void>;
};

let clientPromise: Promise<McpClient | null> | null = null;

async function getClient(): Promise<McpClient | null> {
  if (clientPromise) return clientPromise;
  clientPromise = createClient();
  return clientPromise;
}

async function createClient(): Promise<McpClient | null> {
  try {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { SSEClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/sse.js'
    );

    const cfg = getCostEstDbConfig();
    const transport = new SSEClientTransport(new URL(cfg.url), {
      requestInit: { headers: cfg.headers ?? {} },
    });

    const client = new Client(
      { name: 'cost-estimator', version: '1.0.0' },
      { capabilities: {} },
    );

    await client.connect(transport);
    return client as unknown as McpClient;
  } catch (e) {
    console.warn('CostEstDB MCP client creation failed:', (e as Error).message);
    clientPromise = null;
    return null;
  }
}

/**
 * Search CostEstDB for historical unit prices matching a pay item
 * description. Returns the average of the top 3 matches.
 */
export async function priceLookup(
  payload: PriceLookupPayload,
): Promise<PriceLookupResult> {
  try {
    const client = await getClient();
    if (!client) return { unitPrice: null };

    const args: Record<string, unknown> = {
      query: payload.description,
      unit: payload.unit,
      top_k: 5,
    };
    if (payload.quantity) args.quantity = payload.quantity;

    const result = await client.callTool({
      name: 'search_pay_items',
      arguments: args,
    });

    const textBlock = result.content?.find(
      (c: { type: string }) => c.type === 'text',
    );
    if (!textBlock?.text) return { unitPrice: null };

    return parseSearchResult(textBlock.text, payload.quantity ?? 0);
  } catch (e) {
    console.warn('CostEstDB price lookup failed:', (e as Error).message);
    // Reset client so next call tries a fresh connection.
    clientPromise = null;
    return { unitPrice: null };
  }
}

/**
 * Parse the search_pay_items text output. The tool returns a structured
 * text blob; we look for unit prices on matching pay items and average the
 * top relevant bids.
 */
function parseSearchResult(
  text: string,
  _quantity: number,
): PriceLookupResult {
  // The tool output includes lines like:
  //   "Engineer's Estimate: $105.00/unit ($267225.00 total) (EE)"
  //   "HRP Construction Inc.: $75.00/unit ($190875.00 total)"
  // We extract all "$/unit" values from the FIRST matching item block
  // (highest similarity), preferring contractor bids over engineer estimates.

  const pricePattern = /:\s*\$(\d+(?:\.\d+)?)\/unit/g;
  const eePattern = /\(EE\)\s*$/;
  const matches: Array<{ price: number; isEE: boolean; source: string }> = [];

  const lines = text.split('\n');
  let currentProject = '';
  let currentItem = '';

  for (const line of lines) {
    // Track project name
    const projectMatch = line.match(/Project:\s*(.+?)(?:\s*\(|$)/);
    if (projectMatch) currentProject = projectMatch[1].trim();

    // Track item description
    const itemMatch = line.match(/^---\s*(.+?)\s*\((?:FT|SY|EA|CYD|TON|LS)/);
    if (itemMatch) currentItem = itemMatch[1].trim();

    // Extract prices
    const priceMatch = pricePattern.exec(line);
    if (priceMatch) {
      const price = parseFloat(priceMatch[1]);
      const isEE = eePattern.test(line);
      if (Number.isFinite(price) && price > 0) {
        matches.push({
          price,
          isEE,
          source: currentProject || currentItem,
        });
      }
    }
    // Reset regex lastIndex for next line
    pricePattern.lastIndex = 0;
  }

  if (matches.length === 0) return { unitPrice: null };

  // Prefer contractor bids over engineer estimates. Take the top 3
  // contractor bids; if fewer than 3, supplement with EE.
  const bids = matches.filter((m) => !m.isEE);
  const ees = matches.filter((m) => m.isEE);
  const best = [...bids.slice(0, 3), ...ees.slice(0, 3 - bids.length)].slice(
    0,
    3,
  );

  const avg =
    best.reduce((sum, m) => sum + m.price, 0) / best.length;

  return {
    unitPrice: Math.round(avg * 100) / 100,
    source: best
      .map((m) => m.source)
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i) // unique
      .join(', '),
    matches: best.map((m) => ({
      description: currentItem || '',
      unitPrice: m.price,
      source: m.source,
    })),
  };
}
