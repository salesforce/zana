import { expect, it } from 'vitest';
import { assertToolkitImports } from '../scripts/build-toolkit.mjs';

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
