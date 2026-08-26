import { describe, expect, it } from 'vitest';
import { parseJoinArgv } from './join-argv.js';

describe('join CLI flags', () => {
  it('parses join flags and defaults the daemon port', () => {
    expect(parseJoinArgv([
      'join',
      '--join-code', 'zcde_abc',
      '--host-id', 'host-1',
      '--server-url', 'https://box.tailnet.ts.net/',
      '--auto-update'
    ], { ZCC_DATA_DIR: '/tmp/machine' })).toEqual({
      joinCode: 'zcde_abc',
      hostId: 'host-1',
      serverUrl: 'https://box.tailnet.ts.net',
      hostDaemonPort: 38888,
      autoUpdate: true,
      dataDir: '/tmp/machine'
    });
  });

  it('rejects a missing server URL', () => {
    expect(() => parseJoinArgv(['join'], {})).toThrow(/server-url/);
  });
});
