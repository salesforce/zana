import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../host.ts', import.meta.url), 'utf8');

describe('CLI Agent launch version-probe memo', () => {
  it('shares one installedVersion lookup across preflight and revalidate', () => {
    expect(source).toMatch(
      /async function launchAuthorizedTerminal[\s\S]*?const installedVersion = memoizeInstalledVersion\(/
    );
    expect(source).toMatch(
      /async function launchBackgroundTerminal[\s\S]*?const installedVersion = memoizeInstalledVersion\(/
    );
    expect(source).not.toMatch(/installedVersion:\s*\(adapterId\)\s*=>\s*installedHarnessVersion/);
  });
});
