import { defineConfig } from 'vitest/config'

// Scope vitest discovery to this function package so it doesn't climb to
// the SPA's vite.config.ts / postcss.config.js at the repo root. Without
// this pin, `npm test` run from functions/feedback-api/ will:
//   1. find /vite.config.ts at the repo root,
//   2. try to import `vite` from that location (where the function's
//      node_modules isn't), → ERR_MODULE_NOT_FOUND, OR
//   3. load /postcss.config.js → Loading PostCSS Plugin failed: Cannot find
//      module 'tailwindcss' (only in the SPA's deps).
//
// The inline empty `css.postcss` short-circuits the upward PostCSS search.
// `passWithNoTests: true` keeps CI green when no tests exist yet.
export default defineConfig({
  css: {
    postcss: { plugins: [] },
  },
  test: {
    passWithNoTests: true,
    include: ['src/**/*.test.ts'],
  },
})
