import { describe, expect, it } from 'vitest';
import { parseArgs } from './run-electron-e2e.mjs';

describe('parseArgs', () => {
  it('removes every package-manager separator before forwarding Playwright args', () => {
    expect(parseArgs(['--build', '--', 'e2e/spec.ts', '--', '--headed'])).toEqual({
      build: true,
      playwrightArgs: ['e2e/spec.ts', '--headed']
    });
  });
});
