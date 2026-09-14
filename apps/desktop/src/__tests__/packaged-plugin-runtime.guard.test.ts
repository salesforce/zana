/**
 * Packaged first-party plugins load from extraResources (`plugins/`). The
 * electron-builder filter must keep every file a declared runtime entry
 * actually imports — stripping `src/` is what turned Docs HEALTH into
 * `Cannot find module .../library-mentions.js`.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPluginManifest } from '@zana-ai/zcc-domain';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const pluginsRoot = join(repoRoot, 'plugins');
const builderYml = readFileSync(join(repoRoot, 'apps/desktop/electron-builder.yml'), 'utf8');

function extraResourcesPluginFilters(yml: string): string[] {
  const lines = yml.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s+- from: plugins\s*$/.test(line));
  if (start === -1) throw new Error('electron-builder.yml is missing extraResources from: plugins');
  const filterAt = lines.findIndex((line, index) => index > start && /^\s+filter:\s*$/.test(line));
  if (filterAt === -1 || filterAt - start > 5) {
    throw new Error('electron-builder.yml plugins extraResources has no filter list');
  }
  const filters: string[] = [];
  for (const line of lines.slice(filterAt + 1)) {
    const match = line.match(/^\s+- "(.+)"\s*$/);
    if (!match?.[1]) break;
    filters.push(match[1]);
  }
  if (filters.length === 0) throw new Error('electron-builder.yml plugins extraResources filter is empty');
  return filters;
}

function expandBraces(pattern: string): string[] {
  const start = pattern.indexOf('{');
  if (start === -1) return [pattern];
  const end = pattern.indexOf('}', start);
  if (end === -1) return [pattern];
  const parts = pattern.slice(start + 1, end).split(',');
  return parts.flatMap((part) =>
    expandBraces(`${pattern.slice(0, start)}${part}${pattern.slice(end + 1)}`)
  );
}

function globToRegExp(glob: string): RegExp {
  if (glob === '**/*' || glob === '**') return /^[\s\S]*$/;
  const escaped = glob
    .replace(/\/\*\*$/u, '/<<GLOBSTAR>>')
    .replace(/\*\*\//gu, '<<GLOBSTAR>>/')
    .replace(/\*\*/gu, '<<GLOBSTAR>>')
    .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
    .replace(/\*/gu, '[^/]*')
    .replace(/\?/gu, '[^/]')
    .replace(/<<GLOBSTAR>>/gu, '.*');
  return new RegExp(`^${escaped}$`);
}

export function wouldPackPluginFile(relFromPlugins: string, filters: string[]): boolean {
  const normalized = relFromPlugins.split(sep).join('/');
  let included = false;
  for (const filter of filters) {
    const negated = filter.startsWith('!');
    const body = negated ? filter.slice(1) : filter;
    if (expandBraces(body).some((pattern) => globToRegExp(pattern).test(normalized))) {
      included = !negated;
    }
  }
  return included;
}

function sourceImportSpecifiers(source: string): string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');
  const specifiers: string[] = [];
  const re =
    /(?:from|import)\s*['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)|export\s+\*\s+from\s*['"](\.[^'"]+)['"]/gu;
  for (const match of withoutComments.matchAll(re)) {
    const spec = match[1] ?? match[2] ?? match[3];
    if (spec) specifiers.push(spec);
  }
  return specifiers;
}

function resolveRelativeImport(fromFile: string, specifier: string, pluginRoot: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const abs = resolve(dirname(fromFile), specifier);
  const root = resolve(pluginRoot);
  const candidates = [
    abs,
    abs.replace(/\.js$/u, '.ts'),
    abs.replace(/\.js$/u, '.tsx'),
    abs.replace(/\.js$/u, '.mjs'),
    abs.replace(/\.mjs$/u, '.mts'),
    join(abs, 'index.js'),
    join(abs, 'index.ts'),
    join(abs, 'index.mjs')
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate) || !statSync(candidate).isFile()) continue;
    const real = resolve(candidate);
    if (real === root || real.startsWith(root + sep)) return real;
  }
  return null;
}

function servedAppEntry(pluginRoot: string, appEntry: string): string {
  if (!/\.tsx?$/u.test(appEntry)) return appEntry;
  const compiled = appEntry.replace(/\.tsx?$/u, '.js');
  return existsSync(join(pluginRoot, compiled)) ? compiled : appEntry;
}

function collectRuntimeFiles(pluginRoot: string, entryRel: string): string[] {
  const files = new Set<string>();
  const queue = [resolve(pluginRoot, entryRel)];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || files.has(file)) continue;
    if (!existsSync(file)) {
      throw new Error(`runtime entry missing: ${relative(pluginRoot, file)}`);
    }
    files.add(file);
    if (!/\.[cm]?[jt]sx?$/u.test(file)) continue;
    const source = readFileSync(file, 'utf8');
    for (const spec of sourceImportSpecifiers(source)) {
      const resolved = resolveRelativeImport(file, spec, pluginRoot);
      if (!resolved) {
        throw new Error(`unresolved ${spec} from ${relative(pluginRoot, file)}`);
      }
      queue.push(resolved);
    }
  }
  return [...files];
}

function firstPartyPlugins(): string[] {
  return readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((ent) => ent.isDirectory())
    .map((ent) => ent.name)
    .filter((name) => existsSync(join(pluginsRoot, name, 'package.json')));
}

describe('packaged plugin runtime files', () => {
  const filters = extraResourcesPluginFilters(builderYml);

  it('does not strip plugin src trees from extraResources', () => {
    expect(filters).not.toContain('!*/src/**');
    expect(wouldPackPluginFile('docs/src/library-mentions.js', filters)).toBe(true);
    expect(wouldPackPluginFile('memory/src/memory-store.js', filters)).toBe(true);
  });

  it('still omits tests, scripts, and playground sources', () => {
    expect(wouldPackPluginFile('docs/src/library-mentions.test.ts', filters)).toBe(false);
    expect(wouldPackPluginFile('docs/scripts/build-app.mjs', filters)).toBe(false);
    expect(wouldPackPluginFile('salesforce/playground/src/main.tsx', filters)).toBe(false);
  });

  it('packs every relative import reachable from a declared runtime entry', () => {
    const missing: string[] = [];
    for (const name of firstPartyPlugins()) {
      const pluginRoot = join(pluginsRoot, name);
      let manifest;
      try {
        manifest = readPluginManifest(JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8')));
      } catch {
        continue;
      }
      const entries = [
        manifest.serverEntry,
        manifest.appEntry ? servedAppEntry(pluginRoot, manifest.appEntry) : null
      ].filter((entry): entry is string => Boolean(entry));
      for (const entry of entries) {
        const files = collectRuntimeFiles(pluginRoot, entry);
        for (const file of files) {
          const rel = join(name, relative(pluginRoot, file)).split(sep).join('/');
          if (!wouldPackPluginFile(rel, filters)) missing.push(`${name}: ${rel} (from ${entry})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
