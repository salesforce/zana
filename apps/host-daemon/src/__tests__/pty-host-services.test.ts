import { beforeEach, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), signer: vi.fn(() => 'a'.repeat(64)) }));
vi.mock('node-pty', () => ({ spawn: mocks.spawn }));
vi.mock('../control-credential.js', () => ({ controlCredentialForSession: mocks.signer }));
vi.mock('../mcp-config.js', () => ({ ensureMcpConfigForProjectSync: () => '/tmp/test-mcp.json', alwaysOnPluginMcpAllowlist: () => [] }));
vi.mock('../tmux.js', () => ({ isTmuxAvailable: () => false, buildLocalTmuxCommand: () => {}, wrapRemoteTmux: (_id: string, command: string) => command, tmuxSessionName: (id: string) => `cc-${id}` }));
// A Node execution host must not load an Electron credential implementation.
vi.mock('../harness-auth.js', () => { throw new Error('Electron auth imported by execution engine'); });
import { PtyManager } from '../pty.js';

const config = { version: 1, theme: 'dark', shell: '/bin/sh', claudeBinary: 'claude', tmuxScope: 'off', autoModeEnabled: false } as AppConfig;
// nativeToolPolicyRequired:false — these tests cover auth/credential wiring, not
// the OBL-018 veto gate (which is covered in pty-native-tool-veto.test.ts). The
// gate would otherwise refuse the no-relay spawns here.
const request = { preallocatedSessionId: '11111111-1111-4111-8111-111111111111', projectId: 'p', profile: 'claude' as const, cwd: '/tmp', cols: 80, rows: 24, config, nativeToolPolicyRequired: false };
beforeEach(() => {
  vi.clearAllMocks(); mocks.spawn.mockImplementation(() => ({ pid: undefined, write() {}, onData() {}, onExit() {}, resize() {}, kill() {} }));
});
it('uses only the execution owner auth and granted per-session credential', () => {
  const auth = vi.fn(() => ({ baseUrl: 'https://host.example.invalid', token: 'test-host-only-token' }));
  const credential = vi.fn(() => 'b'.repeat(64)), prepare = vi.fn();
  const manager = new PtyManager({ resolveHarnessAuth: auth, sessionCredential: credential, prepareNativePty: prepare });
  manager.setMcpBaseUrl('http://127.0.0.1:43123');
  manager.create(request);
  expect(auth).toHaveBeenCalledExactlyOnceWith('claude');
  expect(credential).toHaveBeenCalledExactlyOnceWith(request.preallocatedSessionId);
  expect(mocks.signer).not.toHaveBeenCalled(); expect(prepare).toHaveBeenCalledOnce();
  const env = mocks.spawn.mock.calls[0]![2].env;
  expect(env.ZCC_MCP_URL).toBe(`http://127.0.0.1:43123/mcp/p/${request.preallocatedSessionId}/${'b'.repeat(64)}`);
  expect(env.ZCC_SESSION_TOKEN).toBe('b'.repeat(64));
  expect(env.ANTHROPIC_AUTH_TOKEN).toBe('test-host-only-token');
  expect(env.ANTHROPIC_BASE_URL).toBe('https://host.example.invalid');
});
it('defaults to native CLI authentication and the local session signer when no owner services are supplied', () => {
  new PtyManager().create({ nativeToolPolicyRequired: false, ...request, profile: 'shell' });
  expect(mocks.signer).toHaveBeenCalledExactlyOnceWith(request.preallocatedSessionId);
  expect(mocks.spawn).toHaveBeenCalledOnce();
  new PtyManager({ prepareNativePty: vi.fn() }).create(request);
  expect(mocks.spawn).toHaveBeenCalledTimes(2);
});
it('never spawns when a session grant or host credential provider rejects', () => {
  const noGrant = new PtyManager({ sessionCredential: () => { throw new Error('session not granted'); } });
  expect(() => noGrant.create(request)).toThrow('session not granted');
  const noAuth = new PtyManager({ resolveHarnessAuth: () => { throw new Error('auth unavailable'); } });
  expect(() => noAuth.create(request)).toThrow('auth unavailable');
  expect(mocks.spawn).not.toHaveBeenCalled();
});
it('uses the same owner credential service for SSH callback and session-token construction', () => {
  const credential = vi.fn(() => 'c'.repeat(64)), prepare = vi.fn();
  const manager = new PtyManager({ sessionCredential: credential, prepareNativePty: prepare });
  manager.setMcpBaseUrl('http://127.0.0.1:43123');
  manager.create({ nativeToolPolicyRequired: false, ...request, config: { ...config, remoteMcpEnabled: true }, remote: { host: 'fixture.example.invalid', remotePath: '/project' } });
  expect(credential).toHaveBeenCalled(); expect(mocks.signer).not.toHaveBeenCalled(); expect(prepare).toHaveBeenCalledOnce();
  expect(mocks.spawn.mock.calls[0]![2].env.ZCC_SESSION_TOKEN).toBe('c'.repeat(64));
  expect(mocks.spawn.mock.calls[0]![1].join(' ')).toContain('c'.repeat(64));
});
