/**
 * Configuration for the CostEstDB remote MCP server.
 *
 * CostEstDB is already deployed as an Azure Function and exposes the
 * standard MCP SSE endpoint. We just tell the Agent SDK how to reach it —
 * no tool definitions live here.
 */

export interface CostEstDbConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

const DEFAULT_URL =
  'https://func-costestdb-mcp.azurewebsites.net/runtime/webhooks/mcp/sse';

export function getCostEstDbConfig(): CostEstDbConfig {
  const url = process.env.COSTESTDB_MCP_URL || DEFAULT_URL;
  const cfg: CostEstDbConfig = { type: 'http', url };

  // Some Azure Function deployments require the function key in a header.
  // Pull from env if present; otherwise assume the endpoint is anonymous.
  if (process.env.COSTESTDB_FUNCTION_KEY) {
    cfg.headers = { 'x-functions-key': process.env.COSTESTDB_FUNCTION_KEY };
  }
  return cfg;
}

/**
 * The full set of CostEstDB tool names, qualified the way they appear in
 * the Agent SDK after server prefixing. Useful when building `allowedTools`.
 */
export const COSTESTDB_TOOL_NAMES = [
  'mcp__costestdb__search_pay_items',
  'mcp__costestdb__get_project_summary',
  'mcp__costestdb__list_ingested_projects',
] as const;
