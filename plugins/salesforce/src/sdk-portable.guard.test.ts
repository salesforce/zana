import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Session kernel that should move as a standalone package. */
const KERNEL_FILES = [
  'lib/sdk-contract.ts',
  'lib/sdk.ts',
  'lib/connection.ts',
  'lib/guardrail.ts',
  'lib/org-resolution.ts',
  'lib/sf-cli.ts',
  'lib/soql-query-more.ts',
  'lib/soql-api-error.ts',
  'lib/dx-project.ts',
  'lib/node-deps.ts'
];

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...listTs(path));
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

describe('salesforce session kernel is portable', () => {
  it('does not import @zana-ai packages from kernel files', () => {
    const hits: string[] = [];
    for (const rel of KERNEL_FILES) {
      const src = readFileSync(join(pluginRoot, rel), 'utf8');
      if (/from ['"]@zana-ai\//.test(src) || /from ['"]@zana-ai\/zcc-plugin-sdk/.test(src)) {
        hits.push(rel);
      }
    }
    expect(hits, `kernel files must not import @zana-ai/*: ${hits.join(', ')}`).toEqual([]);
  });

  it('publishes the contract — not the host factory — as @zcc-ext/salesforce/sdk', () => {
    const pkg = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8')) as {
      exports?: { './sdk'?: string };
    };
    expect(pkg.exports?.['./sdk']).toBe('./lib/sdk-contract.ts');
    const contract = readFileSync(join(pluginRoot, 'lib/sdk-contract.ts'), 'utf8');
    expect(contract).toContain('export interface SalesforceSdk');
    expect(contract).not.toMatch(/export function createSalesforceSdk/);
    expect(contract).not.toContain('accessToken');
    const factory = readFileSync(join(pluginRoot, 'lib/sdk.ts'), 'utf8');
    expect(factory).toContain('export function createSalesforceSdk');
  });

  it('documents reuse and the extraction file map', () => {
    const sdkDoc = readFileSync(join(pluginRoot, 'SDK.md'), 'utf8');
    expect(sdkDoc).toContain('zcc.services.use<SalesforceSdk>');
    expect(sdkDoc).toContain('org.write');
    expect(sdkDoc).toContain('Moving to another repo');
    expect(sdkDoc).toContain('lib/sdk-contract.ts');
    for (const rel of KERNEL_FILES) {
      expect(sdkDoc, `${rel} missing from SDK.md`).toContain(rel);
    }
    const readme = readFileSync(join(pluginRoot, 'README.md'), 'utf8');
    expect(readme).toContain('SDK.md');
  });

  it('keeps plugin.ts as the only lib file that imports the plugin SDK', () => {
    const libFiles = listTs(join(pluginRoot, 'lib'));
    const hostImports = libFiles.filter((path) => {
      const src = readFileSync(path, 'utf8');
      return /from ['"]@zana-ai\/zcc-plugin-sdk/.test(src);
    });
    expect(hostImports.map((path) => relative(pluginRoot, path))).toEqual(['lib/plugin.ts']);
  });
});
