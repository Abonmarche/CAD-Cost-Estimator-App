import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

/**
 * Build-time env baking.
 *
 * Three sources, in priority order:
 *   1. `process.env.X` — set by CI or the developer's shell
 *   2. `.azure/provision-output.json` — written by scripts/provision-azure.ps1
 *      after a successful Azure provision. Authoritative for IDs/URLs
 *      tied to the deployed infrastructure.
 *   3. `.env` — fallback for dev overrides (and the only place where
 *      COSTESTDB_FUNCTION_KEY lives — it isn't provisioned by our scripts).
 *
 * Injection happens via esbuild `define`, which does literal string
 * replacement. The main process reads `process.env.X` exactly as it does
 * in dev, but in the bundle that expression is already a string literal
 * — no env var is actually consulted at runtime. See src/main/baked-env.ts
 * for the bracket-access trick that propagates these into the SDKs.
 *
 * Notably, ANTHROPIC_API_KEY is no longer baked. The Anthropic key lives
 * in Azure Key Vault and the LLM proxy substitutes it for the user's
 * MSAL token before forwarding upstream.
 */

function loadDotEnv(): Record<string, string> {
  const envPath = resolve(__dirname, '.env');
  const out: Record<string, string> = {};
  if (!existsSync(envPath)) return out;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadProvisionOutput(): Record<string, string> {
  const path = resolve(__dirname, '.azure', 'provision-output.json');
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
    return {
      MSAL_CLIENT_ID: parsed.desktopAppId ?? '',
      MSAL_TENANT_ID: parsed.tenantId ?? '',
      LLM_API_APP_ID: parsed.llmApiAppId ?? '',
      FEEDBACK_API_APP_ID: parsed.feedbackApiAppId ?? '',
      LLM_PROXY_URL: parsed.llmFunctionUrl ?? '',
      FEEDBACK_API_URL: parsed.feedbackFunctionUrl ?? '',
    };
  } catch (err) {
    // Don't fail the build — just warn. The developer might be iterating
    // pre-provision and only touching CostEstDB-related code.
    console.warn('[electron-vite] could not parse .azure/provision-output.json:', (err as Error).message);
    return {};
  }
}

const dotenv = loadDotEnv();
const provision = loadProvisionOutput();

// `||` not `??` so an empty-string overrides falls through to the next
// source (matches the existing pattern from commit fef92a9).
function pick(name: string): string {
  return process.env[name] || provision[name] || dotenv[name] || '';
}

const bakedEnv = {
  // MSAL config (per-tenant + per-app-registration IDs)
  MSAL_CLIENT_ID: pick('MSAL_CLIENT_ID'),
  MSAL_TENANT_ID: pick('MSAL_TENANT_ID'),
  LLM_API_APP_ID: pick('LLM_API_APP_ID'),
  FEEDBACK_API_APP_ID: pick('FEEDBACK_API_APP_ID'),

  // Function App URLs
  LLM_PROXY_URL: pick('LLM_PROXY_URL'),
  FEEDBACK_API_URL: pick('FEEDBACK_API_URL'),

  // CostEstDB MCP (out of scope for the MSAL migration; still baked).
  COSTESTDB_MCP_URL: pick('COSTESTDB_MCP_URL'),
  COSTESTDB_FUNCTION_KEY: pick('COSTESTDB_FUNCTION_KEY'),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
      },
    },
    define: {
      'process.env.MSAL_CLIENT_ID': JSON.stringify(bakedEnv.MSAL_CLIENT_ID),
      'process.env.MSAL_TENANT_ID': JSON.stringify(bakedEnv.MSAL_TENANT_ID),
      'process.env.LLM_API_APP_ID': JSON.stringify(bakedEnv.LLM_API_APP_ID),
      'process.env.FEEDBACK_API_APP_ID': JSON.stringify(bakedEnv.FEEDBACK_API_APP_ID),
      'process.env.LLM_PROXY_URL': JSON.stringify(bakedEnv.LLM_PROXY_URL),
      'process.env.FEEDBACK_API_URL': JSON.stringify(bakedEnv.FEEDBACK_API_URL),
      'process.env.COSTESTDB_MCP_URL': JSON.stringify(bakedEnv.COSTESTDB_MCP_URL),
      'process.env.COSTESTDB_FUNCTION_KEY': JSON.stringify(bakedEnv.COSTESTDB_FUNCTION_KEY),
    },
    build: {
      rollupOptions: {
        // winax is a native addon; the Agent SDK and MCP SDK are pure ESM
        // that can't be require()'d — all must stay external.
        external: [
          'winax',
          '@anthropic-ai/claude-agent-sdk',
          '@modelcontextprotocol/sdk',
          /^@modelcontextprotocol\/sdk\//,
        ],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer/src'),
      },
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
});
