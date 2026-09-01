import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const __filename = fileURLToPath(import.meta.url);
// Old monolith scanned repoRoot/src + repoRoot/e2e. In the monorepo, source
// lives per-workspace under apps/*/src and packages/*/src; walk up from this
// test's new location to the repo root, then scan every workspace's src/ plus
// the top-level e2e/ suite.
const repoRoot = join(__dirname, '../../../../../..');

function workspaceSrcDirs(groupDir: string): string[] {
  return readdirSync(groupDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(groupDir, entry.name, 'src'))
    .filter((dir) => existsSync(dir));
}

// Scan every app's and package's source tree, plus the e2e suite: a
// producer/consumer identifier must not leak into any of them. (e2e specs
// drive the built app and are shipped-with-repo.)
const scanRoots = [
  ...workspaceSrcDirs(join(repoRoot, 'apps')),
  ...workspaceSrcDirs(join(repoRoot, 'packages')),
  join(repoRoot, 'e2e')
];
// `doc[-_ ]?vault` catches the hyphenated/underscored/spaced/joined driver name so
// a stray `doc-vault` test literal can't slip past a bare `doc vault` check.
const banned = new RegExp([
  'doc' + '-execute',
  'doc' + '-manager',
  'doc' + '[-_ ]?vault',
  'PortableMarkdown' + 'ExecutionV1',
  'DocExecute' + 'ControllerV1'
].join('|'), 'i');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('execution consumer separation guard', () => {
  it('keeps execution core independent of plan producers and consumer adapters', () => {
    const violations = scanRoots.flatMap(sourceFiles).filter((path) => path !== __filename).flatMap((path) => {
      const match = readFileSync(path, 'utf8').match(banned);
      return match ? [`${relative(repoRoot, path)}: ${match[0]}`] : [];
    });
    expect(violations).toEqual([]);
  });
});
