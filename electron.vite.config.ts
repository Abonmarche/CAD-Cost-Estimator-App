import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

/**
 * Read .env at build time and bake the MCP URL into the main bundle. The
 * packaged Electron app excludes .env (see electron-builder.yml) and
 * `loadEnvFile()` only runs in dev — without baking these values in, the
 * installed app falls back to an unauthenticated CostEstDB URL and every
 * pricing lookup silently returns null.
 *
 * Injection happens via esbuild `define`, which does literal string
 * replacement. At runtime the main process reads `process.env.X` exactly
 * as it does in dev, but in the bundle that expression is already a
 * string literal — no env var is actually consulted.
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

const dotenv = loadDotEnv();
const bakedEnv = {
  COSTESTDB_MCP_URL:
    process.env.COSTESTDB_MCP_URL ?? dotenv.COSTESTDB_MCP_URL ?? '',
  COSTESTDB_FUNCTION_KEY:
    process.env.COSTESTDB_FUNCTION_KEY ?? dotenv.COSTESTDB_FUNCTION_KEY ?? '',
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
      'process.env.COSTESTDB_MCP_URL': JSON.stringify(
        bakedEnv.COSTESTDB_MCP_URL,
      ),
      'process.env.COSTESTDB_FUNCTION_KEY': JSON.stringify(
        bakedEnv.COSTESTDB_FUNCTION_KEY,
      ),
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
