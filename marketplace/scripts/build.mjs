#!/usr/bin/env node
/**
 * Build marketplace.json from marketplace.base.json + entries/*.json.
 *
 * Writes:
 *   - marketplace/marketplace.json
 *   - website/content/marketplace/marketplace.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { loadMarketplacePlugins, readJson } from './build-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MARKETPLACE_ROOT = join(HERE, '..');
const REPO_ROOT = join(MARKETPLACE_ROOT, '..');
const WEBSITE_OUT = join(REPO_ROOT, 'website', 'content', 'marketplace', 'marketplace.json');
const LOCAL_OUT = join(MARKETPLACE_ROOT, 'marketplace.json');
const SCHEMA_PATH = join(MARKETPLACE_ROOT, 'schema', 'marketplace.schema.json');

function validateWithAjv(index) {
  let Ajv;
  let addFormats;
  try {
    const require = createRequire(import.meta.url);
    Ajv = require(join(REPO_ROOT, 'node_modules/ajv/dist/2020.js')).default;
    addFormats = require(join(REPO_ROOT, 'node_modules/ajv-formats')).default;
  } catch {
    try {
      const require = createRequire(import.meta.url);
      Ajv = require('ajv/dist/2020.js').default;
      addFormats = require('ajv-formats').default;
    } catch {
      return;
    }
  }
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = readJson(SCHEMA_PATH);
  const validate = ajv.compile(schema);
  if (!validate(index)) {
    const details = (validate.errors ?? [])
      .map((err) => `${err.instancePath || '/'} ${err.message}`)
      .join('\n');
    throw new Error(`marketplace schema validation failed:\n${details}`);
  }
}

/**
 * @param {string} [marketplaceRoot]
 * @param {{ validate?: boolean, outputs?: string[] }} [options]
 *   Pass `outputs: []` to validate/assemble without writing.
 */
export function buildMarketplace(marketplaceRoot = MARKETPLACE_ROOT, options = {}) {
  const index = loadMarketplacePlugins(marketplaceRoot);
  if (options.validate !== false) validateWithAjv(index);
  const text = `${JSON.stringify(index, null, 2)}\n`;
  const outputs = options.outputs ?? [LOCAL_OUT, WEBSITE_OUT];
  for (const out of outputs) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text);
  }
  return { index, outputs };
}

function isMain() {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return fileURLToPath(import.meta.url) === resolve(invoked);
  } catch {
    return false;
  }
}

if (isMain()) {
  try {
    const { index, outputs } = buildMarketplace();
    console.log(
      `marketplace build: ${index.plugins.length} plugins (${index.name}) → ${outputs
        .map((path) => path.replace(`${REPO_ROOT}/`, ''))
        .join(', ')}`
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
