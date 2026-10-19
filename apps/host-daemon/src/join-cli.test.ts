import { describe, expect, it } from 'vitest';
import { parseJoinArgv } from './join-argv.js';

it('requires explicit provenance and replacement flags, never infers from loopback or join code', () => {
  expect(parseJoinArgv(['join', '--server-url', 'http://127.0.0.1:1', '--join-code', 'code'], {})).toMatchObject({ provenance: 'non-tunnel', replaceEnrollment: false });
  expect(parseJoinArgv(['join', '--server-url', 'http://127.0.0.1:1', '--enrollment-provenance', 'tunnel', '--replace-enrollment'], {})).toMatchObject({ provenance: 'tunnel', replaceEnrollment: true });
  expect(parseJoinArgv([], { ZCC_SERVER_URL: 'http://127.0.0.1:1', ZCC_HOST_ENROLLMENT_PROVENANCE: 'tunnel', ZCC_HOST_REPLACE_ENROLLMENT: '1' })).toMatchObject({ provenance: 'tunnel', replaceEnrollment: true });
  expect(() => parseJoinArgv(['--server-url', 'https://example.test', '--enrollment-provenance', 'public'], {})).toThrow('provenance');
});

describe('join CLI flags', () => {
  it('parses join flags and defaults the daemon port', () => {
    expect(parseJoinArgv([
      'join',
      '--join-code', 'zcde_abc',
      '--host-id', 'host-1',
      '--server-url', 'https://machine.example.com/',
      '--auto-update'
    ], { ZCC_DATA_DIR: '/tmp/machine' })).toEqual({
      joinCode: 'zcde_abc',
      provenance: 'non-tunnel',
      replaceEnrollment: false,
      hostId: 'host-1',
      serverUrl: 'https://machine.example.com',
      hostDaemonPort: 38888,
      autoUpdate: true,
      dataDir: '/tmp/machine'
    });
  });

  it('rejects a missing server URL', () => {
    expect(() => parseJoinArgv(['join'], {})).toThrow(/server-url/);
  });
});
