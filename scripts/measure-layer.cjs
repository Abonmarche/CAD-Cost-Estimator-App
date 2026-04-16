/**
 * Standalone test harness — connect to AutoCAD and measure everything on
 * a specified layer. Mirrors the logic in src/main/tools/autocad/entities.ts
 * and src/main/measurement.ts so we can run a smoke test without the full
 * Electron window.
 *
 * Run via: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/measure-layer.cjs "<layer name>"
 */

const winax = require('winax');

function safeGet(obj, prop, defaultVal) {
  try {
    const v = obj[prop];
    return v === undefined || v === null ? defaultVal : v;
  } catch {
    return defaultVal;
  }
}

function variantToArray(v) {
  if (v == null) return undefined;
  if (Array.isArray(v)) return v.map(Number);
  if (typeof v.length === 'number') {
    const out = [];
    for (let i = 0; i < v.length; i++) out.push(Number(v[i]));
    return out;
  }
  return undefined;
}

function main() {
  const layerName = process.argv[2] || 'P-UTIL Water UG';
  console.log(`Measuring layer: "${layerName}"`);

  const app = new winax.Object('AutoCAD.Application.24.3', { activate: true });
  const doc = app.ActiveDocument;
  console.log(`Drawing: ${doc.Name}`);

  // --- Layer existence + metadata ---
  const layers = doc.Layers;
  let layerFound = false;
  const similarLayers = [];
  for (let i = 0; i < layers.Count; i++) {
    const layer = layers.Item(i);
    const name = safeGet(layer, 'Name', '');
    if (name === layerName) layerFound = true;
    // Loose-match any layer containing "water" for context
    if (name.toLowerCase().includes('water') && name !== layerName) {
      similarLayers.push(name);
    }
  }
  console.log(`Layer exists: ${layerFound}`);
  if (similarLayers.length > 0) {
    console.log(`Other water layers:`);
    similarLayers.forEach((l) => console.log(`  - ${l}`));
  }

  if (!layerFound) {
    console.log('\nFirst 40 layer names in drawing:');
    for (let i = 0; i < Math.min(40, layers.Count); i++) {
      console.log(`  ${safeGet(layers.Item(i), 'Name', '')}`);
    }
    return;
  }

  // --- Iterate ModelSpace, filter by layer ---
  const modelspace = doc.ModelSpace;
  console.log(`ModelSpace entities: ${modelspace.Count}`);

  const typeCounts = {};
  const typeLengths = {};
  const typeAreas = {};
  const widthBreakdown = {};
  const sampleEntities = [];
  let matchedCount = 0;

  for (let i = 0; i < modelspace.Count; i++) {
    let ent;
    try {
      ent = modelspace.Item(i);
    } catch {
      continue;
    }
    if (safeGet(ent, 'Layer') !== layerName) continue;
    matchedCount++;
    const objName = safeGet(ent, 'ObjectName', '');
    typeCounts[objName] = (typeCounts[objName] ?? 0) + 1;

    const length = safeGet(ent, 'Length');
    if (typeof length === 'number') {
      typeLengths[objName] = (typeLengths[objName] ?? 0) + length;
    }
    const area = safeGet(ent, 'Area');
    if (typeof area === 'number') {
      typeAreas[objName] = (typeAreas[objName] ?? 0) + area;
    }

    if (objName.includes('Polyline')) {
      const cw = safeGet(ent, 'ConstantWidth');
      if (typeof cw === 'number' && cw >= 0) {
        const key = String(Math.round(cw * 10000) / 10000);
        const g = widthBreakdown[key] ?? (widthBreakdown[key] = {
          count: 0,
          total_length: 0,
        });
        g.count++;
        if (typeof length === 'number') g.total_length += length;
      }
    }

    if (sampleEntities.length < 6) {
      sampleEntities.push({
        id: safeGet(ent, 'ObjectID'),
        type: objName,
        length: typeof length === 'number' ? Math.round(length * 100) / 100 : undefined,
        area: typeof area === 'number' ? Math.round(area * 100) / 100 : undefined,
        closed: safeGet(ent, 'Closed'),
        constant_width: safeGet(ent, 'ConstantWidth'),
      });
    }
  }

  console.log(`\nMatched entities on layer: ${matchedCount}`);
  console.log('Type counts:', typeCounts);
  console.log(
    'Lengths (feet):',
    Object.fromEntries(
      Object.entries(typeLengths).map(([k, v]) => [k, Math.round(v * 100) / 100]),
    ),
  );
  console.log(
    'Areas (sq ft):',
    Object.fromEntries(
      Object.entries(typeAreas).map(([k, v]) => [k, Math.round(v * 100) / 100]),
    ),
  );
  if (Object.keys(widthBreakdown).length > 0) {
    console.log('Polyline constant-width breakdown:');
    for (const [w, g] of Object.entries(widthBreakdown)) {
      console.log(`  width=${w}: ${g.count} polylines, total length ${Math.round(g.total_length * 100) / 100} ft`);
    }
  }

  console.log('\nSample entities:');
  sampleEntities.forEach((e, i) => console.log(`  [${i}]`, JSON.stringify(e)));

  // Total polyline length = water main LF
  const polylineLF = Object.entries(typeLengths)
    .filter(([t]) => t.includes('Polyline'))
    .reduce((sum, [, v]) => sum + v, 0);
  console.log(`\nTotal polyline length on "${layerName}": ${Math.round(polylineLF * 100) / 100} LF`);
}

try {
  main();
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
