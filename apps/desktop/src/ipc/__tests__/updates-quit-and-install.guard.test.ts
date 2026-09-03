import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('updates:quitAndInstall IPC', () => {
  it('defers quitAndInstall so the invoke handler can return', () => {
    const source = readFileSync(new URL('../app.ts', import.meta.url), 'utf8');
    const handlerIdx = source.indexOf('IPC.updates.quitAndInstall');
    expect(handlerIdx).toBeGreaterThan(-1);
    const after = source.slice(handlerIdx, handlerIdx + 800);
    expect(after).toContain('setImmediate');
    expect(after).toMatch(/setImmediate\s*\(\s*\(\)\s*=>\s*\{[\s\S]*quitAndInstall\(\)/);

    const host = readFileSync(new URL('../../host.ts', import.meta.url), 'utf8');
    expect(host).toContain('prepareQuitForUpdate');
    expect(host).toMatch(/prepareQuitForUpdate:\s*\(\)\s*=>\s*\{\s*quitConfirmed = true;/);
  });
});
