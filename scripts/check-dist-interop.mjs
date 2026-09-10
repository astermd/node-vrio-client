// scripts/check-dist-interop.mjs
//
// Verifies that both built bundles (ESM and CJS) export a working `API` and
// a `VrioError` that is catchable and satisfies `instanceof` AS BUILT — i.e.
// in the exact artifacts this package ships, targeting node22 with native ES
// classes. It also confirms the 18-method surface survives bundling, and
// that VrioError's prototype-restoration guard is still emitted in both
// bundles.
//
// This does NOT prove `instanceof` would survive a consumer's bundler
// downlevelling this package to ES5 — nothing here downlevels anything, so
// that scenario is never exercised. Native ES classes keep a correct
// prototype chain without `Object.setPrototypeOf(this, new.target.prototype)`
// in `VrioError`, so behavioural assertions alone cannot tell whether that
// line is present: a build with the line stripped passes every instanceof
// check below just as well as one with it. The line is defensive insurance
// against a downlevelling consumer bundler we don't control, and the source-
// text check further down is the only way to stop it being deleted as
// apparently-dead code.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);

// ESM
const esm = await import('../dist/index.js');
assert.equal(typeof esm.API, 'function', 'ESM must export API');
assert.ok(new esm.VrioError('x') instanceof esm.VrioError, 'ESM instanceof VrioError must hold');
assert.ok(new esm.VrioError('x') instanceof Error, 'ESM VrioError must be an Error');
assert.equal(new esm.VrioError('x').name, 'VrioError');
assert.equal(esm.API.supportedMethods().length, 18, 'ESM must expose 18 methods');

// CJS
const cjs = require('../dist/index.cjs');
assert.equal(typeof cjs.API, 'function', 'CJS must export API');
assert.ok(new cjs.VrioError('x') instanceof cjs.VrioError, 'CJS instanceof VrioError must hold');
assert.ok(new cjs.VrioError('x') instanceof Error, 'CJS VrioError must be an Error');
assert.equal(new cjs.VrioError('x').name, 'VrioError');
assert.equal(cjs.API.supportedMethods().length, 18, 'CJS must expose 18 methods');

// A thrown error must be catchable by the same check a consumer would write.
try {
  new cjs.API('');
  assert.fail('an empty api key must throw');
} catch (error) {
  assert.ok(error instanceof cjs.VrioError, 'CJS must throw a catchable VrioError');
  assert.equal(error.message, 'An API key is required');
}

// Blunt source-text guard: in a native-class build (node22 target, no
// downlevelling), stripping VrioError's `Object.setPrototypeOf(this,
// new.target.prototype)` line does not fail any behavioural check above —
// native classes keep `instanceof` correct on their own. That line only
// matters to a consumer whose own bundler downlevels this package, a
// scenario this script cannot exercise. So the only way to catch its
// deletion is to confirm the emitted source still contains it.
for (const file of ['../dist/index.js', '../dist/index.cjs']) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.ok(
    source.includes('setPrototypeOf'),
    `${file} must retain VrioError's prototype restoration — without it, ` +
      `instanceof breaks for any consumer whose bundler downlevels this package`,
  );
}

console.log(
  'dist interop: ESM and CJS both export a working, instanceof-checkable VrioError and API ' +
    '(as built), the 18-method surface survives bundling, and the prototype-restoration guard ' +
    'is still emitted in both bundles',
);
