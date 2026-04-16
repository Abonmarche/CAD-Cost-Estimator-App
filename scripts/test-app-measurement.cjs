/**
 * Exercise the real app measurement path by bundling measurement.ts via
 * esbuild and invoking measureOne() with a representative PayItem.
 *
 * Run via:
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe \
 *     scripts/test-app-measurement.cjs
 */
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');

const tmpFile = path.resolve(__dirname, '_tmp_measure.cjs');
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

const { measureOne, measureAll } = require(tmpFile);

const t0 = Date.now();
const item = {
  id: 'test_1',
  name: 'Water Main',
  objectType: 'polyline',
  measurement: 'linear',
  defaultLayer: '',
  icon: '*',
  fields: ['diameter', 'material'],
  layer: 'P-UTIL Water UG',
  status: 'pending',
  diameter: '8"',
  material: 'DIP',
  quantity: null,
  unitPrice: null,
  totalCost: null,
  flagMessage: null,
  flagOptions: null,
};

console.log('Running measureAll on 1 item...');
const updates = [];
for (const u of measureAll([item])) {
  updates.push(u);
  console.log(`[${((Date.now() - t0) / 1000).toFixed(2)}s]`, JSON.stringify(u));
}

console.log(`\nTotal elapsed: ${((Date.now() - t0) / 1000).toFixed(2)}s`);
console.log('Final patch:', JSON.stringify(updates[updates.length - 1], null, 2));

fs.unlinkSync(tmpFile);
