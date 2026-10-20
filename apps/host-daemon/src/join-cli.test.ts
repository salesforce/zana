import { describe, expect, it, vi } from 'vitest';
import { parseJoinArgv } from './join-argv.js';
import { runEnrollmentCheck } from './join-cli.js';

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

  it('prints only the enrollment refusal before exiting nonzero', () => {
    const writeError = vi.fn();
    const exit = vi.fn((code: number): never => { throw new Error(`exit ${code}`); });
    expect(() => runEnrollmentCheck({ dataDir: '/tmp/machine' } as any, () => { throw new Error('use --replace-enrollment'); }, writeError, exit))
      .toThrow('exit 1');
    expect(writeError).toHaveBeenCalledWith('use --replace-enrollment\n');
  });

  it('prints non-Error enrollment refusals and missing data-dir errors', () => {
    const writeError = vi.fn();
    const exit = vi.fn((code: number): never => { throw new Error(`exit ${code}`); });
    expect(() => runEnrollmentCheck({ dataDir: '/tmp/machine' } as any, () => { throw 'unsafe enrollment'; }, writeError, exit))
      .toThrow('exit 1');
    expect(writeError).toHaveBeenLastCalledWith('unsafe enrollment\n');
    expect(() => runEnrollmentCheck({} as any, undefined, writeError, exit)).toThrow('exit 1');
    expect(writeError).toHaveBeenLastCalledWith('ZCC_DATA_DIR is required for an isolated machine install\n');
  });

  it('uses default shell output and exit hooks', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as never);
    try {
      expect(() => runEnrollmentCheck({} as any, undefined, undefined, code => { throw new Error(`exit ${code}`); })).toThrow('exit 1');
      expect(stderr).toHaveBeenLastCalledWith('ZCC_DATA_DIR is required for an isolated machine install\n');
      expect(() => runEnrollmentCheck({ dataDir: '/tmp/machine' } as any)).toThrow('exit 0');
      expect(exit).toHaveBeenLastCalledWith(0);
    } finally {
      stderr.mockRestore();
      exit.mockRestore();
    }
  });

  it('exits zero when enrollment is safe', () => {
    const exit = vi.fn((code: number): never => { throw new Error(`exit ${code}`); });
    expect(() => runEnrollmentCheck({ dataDir: '/tmp/machine' } as any, () => undefined, vi.fn(), exit)).toThrow('exit 0');
  });
});
