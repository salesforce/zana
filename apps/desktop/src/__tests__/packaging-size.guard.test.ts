/**
 * Packaging-size guard — root production deps and electron-builder filters
 * decide what lands in app.asar / extraResources. Renderer-only libraries
 * (monaco, mermaid, lucide, xterm, …) and the Pi LLM SDK are bundled into
 * `out/renderer` or `host-bridge/bb-pi-bridge.mjs`; they must not reappear as
 * root `dependencies` or they pack ~150–250 MB of unused node_modules.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(here, '../../../..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const builderYml = readFileSync(join(repoRoot, 'apps/desktop/electron-builder.yml'), 'utf8');
const desktopPkg = JSON.parse(
  readFileSync(join(repoRoot, 'apps/desktop/package.json'), 'utf8')
);

/** Main actually `import`s these; they must stay asar-packed. */
const MAIN_PRODUCTION_DEPS = [
  '@modelcontextprotocol/sdk',
  'better-sqlite3',
  'croner',
  'electron-updater',
  'node-pty',
  'smol-toml',
  'ws',
  'zod'
] as const;

/** Bundled into the renderer or Pi bridge — must not be root production deps. */
const RENDERER_OR_BRIDGE_ONLY_DEPS = [
  '@dnd-kit/core',
  '@dnd-kit/sortable',
  '@dnd-kit/utilities',
  '@earendil-works/pi-ai',
  '@monaco-editor/react',
  '@xterm/addon-fit',
  '@xterm/addon-search',
  '@xterm/addon-web-links',
  '@xterm/addon-webgl',
  '@xterm/xterm',
  'highlight.js',
  'lucide-react',
  'mermaid',
  'monaco-editor',
  'react',
  'react-diff-viewer-continued',
  'react-dom',
  'react-markdown',
  'rehype-highlight',
  'remark-gfm',
  'zustand'
] as const;

const ASAR_EXCLUDES = [
  'node_modules/monaco-editor/**',
  'node_modules/@monaco-editor/**',
  'node_modules/mermaid/**',
  'node_modules/lucide-react/**',
  'node_modules/highlight.js/**',
  'node_modules/@xterm/**',
  'node_modules/@earendil-works/**'
] as const;

describe('packaged app size policy', () => {
  it('keeps the main-process production deps on the root package', () => {
    for (const name of MAIN_PRODUCTION_DEPS) {
      expect(pkg.dependencies, `missing root dep ${name}`).toHaveProperty(name);
    }
    expect(pkg.optionalDependencies).toHaveProperty('microsandbox');
  });

  it('does not list renderer-only or Pi-bridge packages as root production deps', () => {
    const listed = Object.keys(pkg.dependencies ?? {});
    const offenders = listed.filter((name) =>
      (RENDERER_OR_BRIDGE_ONLY_DEPS as readonly string[]).includes(name)
    );
    expect(offenders).toEqual([]);
  });

  it('asar files denylist excludes renderer-only packages', () => {
    for (const glob of ASAR_EXCLUDES) {
      expect(builderYml).toContain(`"!${glob}"`);
    }
  });

  it('trims the unused OpenCode arch after extraResources copy', () => {
    expect(builderYml).toMatch(/afterPack:\s*scripts\/after-pack-trim-opencode\.mjs/);
    expect(builderYml).toMatch(/from:\s*vendor\/opencode/);
    expect(builderYml).toMatch(/to:\s*opencode/);
  });

  it('does not pack plugin or CLI source maps', () => {
    expect(builderYml).toContain('to: zcc-cli');
    expect(builderYml).toContain('to: plugins');
    expect((builderYml.match(/"!\*\*\/\*\.map"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('does not pack plugin playground sources or build junk', () => {
    expect(builderYml).toContain('"!**/playground/src/**"');
    expect(builderYml).toContain('"!**/vitest.config.ts"');
    expect(builderYml).toContain('"!**/vite.config.ts"');
    expect(builderYml).toContain('"!**/tsconfig.json"');
    expect(builderYml).toContain('"!**/.turbo/**"');
  });

  it('wipes previous dist output before packaging', () => {
    expect(pkg.scripts['clean:dist']).toBe('node scripts/clean-dist.mjs');
    expect(desktopPkg.scripts.package).toContain('run clean:dist');
    expect(desktopPkg.scripts['release:mac']).toContain('run clean:dist');
  });
});
