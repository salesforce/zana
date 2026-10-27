import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'apps/desktop/src/host.ts'), 'utf8');

describe('peer use prompt startup origin', () => {
  it('subscribes once after the supervised origin is ready, outside IPC registration', () => {
    const normal = source.indexOf('async function bootstrapNormal()');
    const ready = source.indexOf('await ensureRendererStaticHost();', normal);
    const subscribe = source.indexOf('stopPeerUsePrompts ??= startPeerUsePrompts({');
    expect(normal).toBeGreaterThan(-1);
    expect(ready).toBeGreaterThan(normal);
    expect(subscribe).toBeGreaterThan(ready);
    expect(source.match(/startPeerUsePrompts\(\{/g)).toHaveLength(1);
    expect(source.slice(source.indexOf('function registerIpc()'), normal)).not.toContain('startPeerUsePrompts({');
    expect(source.slice(subscribe, source.indexOf('}).stop;', subscribe))).toContain('serverUrl: () => productServerUrl()');
  });

  it('stops the subscription and clears its lifetime handle at shutdown', () => {
    expect(source).toMatch(/stopPeerUsePrompts\?\.\(\);\s*stopPeerUsePrompts = null;/);
  });
});
