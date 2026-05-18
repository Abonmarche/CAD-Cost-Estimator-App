/**
 * Function App entry point — imports each registered HTTP handler so
 * its `app.http(...)` side-effect runs at module load.
 *
 * `package.json` `main` points at `dist/src/index.js`. Without this
 * file (or a glob like `dist/src/functions/*.js` instead), the Functions
 * runtime never loads submit-feedback.ts's `app.http('submit-feedback', ...)`
 * call and the function never appears in /admin/functions.
 */

import './functions/submit-feedback.js';
