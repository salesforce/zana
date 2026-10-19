import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { buildMarketplace, findStaleOutputs } from './build.mjs';

const dir = mkdtempSync(join(tmpdir(), 'zcc-marketplace-check-'));
after(() => rmSync(dir, { recursive: true, force: true }));

describe('buildMarketplace', () => {
  it('validates the repository entries against the schema when required', () => {
    const { index, outputs, text } = buildMarketplace(undefined, { requireSchema: true, outputs: [] });
    assert.equal(index.name, 'official');
    assert.deepEqual(outputs, []);
    assert.equal(text, `${JSON.stringify(index, null, 2)}\n`);
  });

  it('writes the built text to every requested output', () => {
    const out = join(dir, 'nested', 'marketplace.json');
    const { text } = buildMarketplace(undefined, { outputs: [out] });
    assert.equal(readFileSync(out, 'utf8'), text);
  });
});

describe('findStaleOutputs', () => {
  it('reports missing and differing outputs, not matching ones', () => {
    const current = join(dir, 'current.json');
    const stale = join(dir, 'stale.json');
    const missing = join(dir, 'missing.json');
    writeFileSync(current, 'catalog\n');
    writeFileSync(stale, 'old\n');
    assert.deepEqual(findStaleOutputs('catalog\n', [current, stale, missing]), [stale, missing]);
  });

  it('finds the committed catalogs current', () => {
    const { text } = buildMarketplace(undefined, { outputs: [] });
    assert.deepEqual(findStaleOutputs(text), []);
  });
});
