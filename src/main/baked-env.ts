/**
 * Capture build-time-baked env values and re-publish them onto
 * `process.env` at runtime.
 *
 * Why this exists. `electron.vite.config.ts` uses esbuild `define` to
 * substitute `process.env.X` expressions in our bundled code with
 * literal strings at build time. That works for code we own — but the
 * Agent SDK and MCP SDK are externalised (not bundled) and read
 * `process.env.X` themselves at runtime. On a fresh installer, those
 * vars are unset, so the SDKs fail.
 *
 * The trick: dot access (`process.env.X`) IS replaced by `define`, but
 * bracket access (`process.env['X']`) is NOT. So we use the dot form to
 * capture the baked literal, then write it back via bracket access. The
 * external SDKs read `process.env` at runtime and see the value.
 *
 * Imported and called as the very first thing in main/index.ts so all
 * downstream code (and dynamic-imported SDKs) sees a populated env.
 */

// Dot-access reads ARE replaced by esbuild `define` at build time —
// these lines become string literals in the bundle.
const BAKED_ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const BAKED_COSTESTDB_MCP_URL = process.env.COSTESTDB_MCP_URL;
const BAKED_COSTESTDB_FUNCTION_KEY = process.env.COSTESTDB_FUNCTION_KEY;

export function injectBakedEnv(): void {
  // Iterate via Object.entries so the key access is `process.env[k]`
  // with `k` as a runtime variable. esbuild cannot constant-fold a
  // computed-property assignment back to a dot-access form, so the
  // assignment survives tree-shaking and runs at startup.
  const baked: Record<string, string | undefined> = {
    ANTHROPIC_API_KEY: BAKED_ANTHROPIC_API_KEY,
    COSTESTDB_MCP_URL: BAKED_COSTESTDB_MCP_URL,
    COSTESTDB_FUNCTION_KEY: BAKED_COSTESTDB_FUNCTION_KEY,
  };
  for (const k of Object.keys(baked)) {
    const v = baked[k];
    if (v && !process.env[k]) {
      process.env[k] = v;
    }
  }
}
