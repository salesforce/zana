import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../extensions.ts', import.meta.url), 'utf8');

describe('bundled plugin install IPC', () => {
  it('loads first-party plugins through the live plugin host, not a sidecar service', () => {
    expect(source).toMatch(/source\.kind === 'bundled'/);
    expect(source).toMatch(/bundledPluginByName\(source\.id\) \? `builtin:\$\{source\.id\}`/);
    expect(source).toMatch(
      /source\.kind === 'bundled'[\s\S]*?runtimeSupervisor\.installPlugin\(spec\)/
    );
  });
});
