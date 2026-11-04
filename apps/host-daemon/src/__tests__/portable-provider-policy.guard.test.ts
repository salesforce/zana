import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const sourceRoots = ['apps', 'packages', 'plugins', 'e2e'];
const excludedDirectories = new Set([
  'node_modules', 'vendor', 'dist', 'build', 'out', 'out-dev', 'coverage',
  'generated', '.git', '.zcc', '.artifacts', '.cache', '.turbo', '.vite', '.next'
]);
const sourceExtensions = new Set([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py', '.sh', '.bash', '.zsh',
  '.json', '.jsonc', '.yaml', '.yml', '.html', '.css', '.scss', '.snap'
]);
const installerPatterns = [
  ...['', '-', '_', ' '].flatMap(separator => [
    ['ai', 'suite'].join(separator), ['ai', 'expert', 'suite'].join(separator)
  ]), ['llm', 'gw'].join(''),
  ['mh', 'telemetry', 'collector'].join('-')
];

function authoredSources(base: string): string[] {
  const sources: string[] = [];
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        const parts = relative(base, path).split(sep);
        const outputOrDependency = excludedDirectories.has(entry.name) &&
          (entry.name.startsWith('.') || parts.length >= 3);
        const documentation = entry.name === 'docs' && parts.length === 3;
        if (!outputOrDependency && !documentation) visit(path);
        continue;
      }
      if (!entry.isFile() || /(?:\.generated\.|^generated\.)/.test(entry.name) || entry.name.endsWith('.map')) continue;
      if (!sourceExtensions.has(extname(entry.name)) && extname(entry.name) !== '') continue;
      // Shipped entrypoints can be handwritten mirrors even with a TS source
      // counterpart. Scan executable plugin entries as well as their sources.
      const source = readFileSync(path, 'utf8');
      if (extname(entry.name) === '' && !source.startsWith('#!')) continue;
      sources.push(path);
    }
  }
  for (const directory of sourceRoots) if (existsSync(join(base, directory))) visit(join(base, directory));
  return sources.sort();
}

function violations(base: string, paths: string[]) {
  return paths.flatMap(path => {
    const source = readFileSync(path, 'utf8').toLowerCase();
    return installerPatterns.filter(pattern => source.includes(pattern))
      .map(pattern => `${relative(base, path)}: ${pattern}`);
  });
}

describe('portable provider policy', () => {
  const fixtures: string[] = [];
  afterEach(() => { for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true }); });

  it('keeps installer-specific behavior out of all authored application, package, plugin and E2E code', () => {
    const paths = authoredSources(root);
    expect(paths.length).toBeGreaterThan(1_000);
    expect(violations(root, paths)).toEqual([]);
  });

  it('covers new source and test locations without exempting plugins', () => {
    const base = mkdtempSync(join(tmpdir(), 'portable-policy-')); fixtures.push(base);
    for (const [index, path] of [
      'apps/new-feature/src/main.ts', 'apps/new-feature/src/main.test.ts',
      'packages/new-package/lib/policy.mjs', 'plugins/new-plugin/src/server.ts',
      'plugins/new-plugin/server.mjs', 'e2e/fixtures/bin/provider', 'plugins/docs/src/server.ts'
    ].entries()) {
      mkdirSync(join(base, path, '..'), { recursive: true });
      writeFileSync(join(base, path), `#!/usr/bin/env node\n${installerPatterns[index % installerPatterns.length]}`);
    }
    // A source counterpart must not hide the separately shipped runtime entry.
    const paths = authoredSources(base);
    expect(violations(base, paths)).toHaveLength(7);
    expect(paths).toContain(join(base, 'plugins/new-plugin/src/server.ts'));
    expect(paths).toContain(join(base, 'plugins/new-plugin/server.mjs'));
  });

  it('excludes generated output, dependencies and historical documentation', () => {
    const base = mkdtempSync(join(tmpdir(), 'portable-policy-')); fixtures.push(base);
    for (const path of [
      'apps/tool/dist/bundle.js', 'apps/tool/src/generated/catalog.ts', 'apps/tool/src/catalog.generated.ts',
      'packages/tool/node_modules/vendor/index.js', 'packages/tool/vendor/index.js',
      'plugins/tool/docs/history.ts', 'plugins/tool/history.md', 'e2e/.artifacts/generated.spec.ts'
    ]) {
      mkdirSync(join(base, path, '..'), { recursive: true }); writeFileSync(join(base, path), installerPatterns[0]);
    }
    expect(authoredSources(base)).toEqual([]);
  });
});
