import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../..');
// Scan both the app source AND the e2e suite: a producer/consumer identifier must
// not leak into either. (e2e specs drive the built app and are shipped-with-repo.)
const scanRoots = [resolve(repoRoot, 'src'), resolve(repoRoot, 'e2e')];
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
