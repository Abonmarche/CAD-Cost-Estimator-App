/**
 * Exercise the new pipe-network measurement path against the running
 * AutoCAD drawing. Three test cases:
 *   1. Sanitary Sewer preset (styleKeyword='sanitary', autoFromPartFeature=true)
 *   2. Storm Sewer preset    (styleKeyword='storm', autoFromPartFeature=true)
 *   3. Unfiltered pipe pull from P-UTIL (no style filter)
 *
 * Run via:
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe \
 *     scripts/test-pipe-measurement.cjs
 */
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');

const tmpFile = path.resolve(__dirname, '_tmp_pipe_measure.cjs');
esbuild.buildSync({
  entryPoints: [path.resolve(__dirname, '..', 'src', 'main', 'measurement.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: tmpFile,
  external: ['winax', 'electron', '@anthropic-ai/claude-agent-sdk'],
  alias: {
    '@shared': path.resolve(__dirname, '..', 'src', 'shared'),
  },
  logLevel: 'error',
});

const { measureOne } = require(tmpFile);

function buildItem(overrides) {
  return {
    id: 'test_' + Math.random().toString(36).slice(2, 8),
    name: 'Test',
    objectType: 'pipe',
    measurement: 'linear',
    defaultLayer: 'P-UTIL',
    icon: '',
    fields: ['autoParts', 'styleKeyword', 'diameter', 'material'],
    layer: 'P-UTIL',
    status: 'pending',
    autoFromPartFeature: true,
    quantity: null,
    unitPrice: null,
    totalCost: null,
    flagMessage: null,
    flagOptions: null,
    ...overrides,
  };
}

const cases = [
  buildItem({ name: 'Sanitary Sewer', styleKeyword: 'sanitary' }),
  buildItem({ name: 'Storm Sewer',    styleKeyword: 'storm' }),
  buildItem({ name: 'All P-UTIL pipes',  styleKeyword: undefined, autoFromPartFeature: false }),
];

for (const item of cases) {
  console.log(`\n=== ${item.name} ===`);
  const t0 = Date.now();
  const update = measureOne(item);
  console.log(`  elapsed ${((Date.now() - t0) / 1000).toFixed(2)}s`);
  console.log('  patch:', JSON.stringify(update.patch, null, 2));
  if (update.spawn && update.spawn.length > 0) {
    console.log(`  spawned ${update.spawn.length} extra item(s):`);
    for (const s of update.spawn) {
      console.log(`    diameter=${s.diameter} material=${s.material} qty=${s.quantity}`);
    }
  }
}

fs.unlinkSync(tmpFile);
