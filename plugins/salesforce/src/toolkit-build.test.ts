import { expect, it } from 'vitest';
import { assertToolkitImports, patchCodeAnalyzerProbe } from '../scripts/build-toolkit.mjs';

it.each(['node:sqlite', 'node:test', 'node:fs', 'fs', 'fs/promises'])('allows the runtime built-in %s without an external package', path => {
  expect(() => assertToolkitImports({ 'sdk.mjs': { imports: [{ path, external: true }] } })).not.toThrow();
});

it('retains the closed boundary for packages omitted from the bundle', () => {
  expect(() => assertToolkitImports({ 'sdk.mjs': { imports: [{ path: '@salesforce/core', external: true }] } })).toThrow('Unbundled toolkit dependency: @salesforce/core');
  expect(() => assertToolkitImports({ 'sdk.mjs': { imports: [{ path: 'node:nonexistent', external: true }] } })).toThrow('Unbundled toolkit dependency: node:nonexistent');
});

it('accepts bundled imports and output with no dependencies', () => {
  expect(() => assertToolkitImports({ 'sdk.mjs': { imports: [{ path: './chunk.mjs', external: false }] }, 'chunk.mjs': { imports: [] } })).not.toThrow();
});

it('keeps the Code Analyzer prerequisite probe local without changing other subprocesses', () => {
  const source = 'const plugin = exec("sf", ["plugins", "inspect", "code-analyzer", "--json"], { timeout: 15000 }); const version = exec("sf", ["--version"]);';
  expect(patchCodeAnalyzerProbe(source)).toBe(source.replace('"code-analyzer"', '"@salesforce/plugin-code-analyzer"'));
});

it('rejects a changed or ambiguous upstream Code Analyzer probe', () => {
  const probe = 'exec("sf", ["plugins", "inspect", "code-analyzer", "--json"])';
  expect(() => patchCodeAnalyzerProbe('changed upstream implementation')).toThrow('probe contract changed');
  expect(() => patchCodeAnalyzerProbe(`${probe}; ${probe}`)).toThrow('probe contract changed');
});
