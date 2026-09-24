import { beforeEach, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(), errors: new Map<string, (...args: any[]) => any>(),
  projects: [] as any[], start: vi.fn(), get: vi.fn(), scope: vi.fn(), query: vi.fn(), refresh: vi.fn(), release: vi.fn(), find: vi.fn(),
  transcript: vi.fn(), create: vi.fn(), resume: vi.fn(), claude: vi.fn(), opencode: vi.fn()
}));
vi.mock('electron', () => ({ ipcMain: {} }));
vi.mock('./ctx.js', () => ({ ctx: {
  safeHandle: (name: string, handler: any, error: any) => { mocks.handlers.set(name, handler); mocks.errors.set(name, error); },
  safeHandleFromWindow: (name: string, handler: any, error: any) => { mocks.handlers.set(name, handler); mocks.errors.set(name, error); },
  conversationHistory: { start: mocks.start, get: mocks.get, scope: mocks.scope, query: mocks.query, refresh: mocks.refresh, release: mocks.release, find: mocks.find },
  nativeConversationIndex: { transcript: mocks.transcript, openCodeTranscript: mocks.transcript }, createInteractiveTerminal: mocks.create
} }));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: { listProjects: () => mocks.projects, getConfig: () => ({ opencodeBinary: 'opencode' }) } }));
vi.mock('@zana-ai/zcc-server/services/projects/claude', () => ({ listClaudeSessions: mocks.claude }));
vi.mock('@zana-ai/zcc-server/services/projects/opencode-sessions', () => ({ listOpenCodeSessions: mocks.opencode }));
vi.mock('@zana-ai/zcc-server/services/projects/git', () => ({ gitCommonDir: vi.fn() }));
vi.mock('@zana-ai/zcc-host-daemon/harness/registry', () => ({ registrationFor: () => ({ nativeConversationResume: mocks.resume }) }));
import { registerSessionsIpc } from './sessions.js';
const call = (method: string, ...args: unknown[]) => mocks.handlers.get(`history:${method}`)!({ id: 7 }, ...args);
beforeEach(() => {
  vi.clearAllMocks(); mocks.handlers.clear(); mocks.errors.clear();
  mocks.projects = [{ id: 'p', path: tmpdir() }, { id: 'remote', path: tmpdir(), remote: { host: 'remote' } }];
  mocks.get.mockReturnValue({ status: 'ready' }); mocks.scope.mockReturnValue('p'); mocks.query.mockReturnValue('query');
  mocks.find.mockReturnValue({ source: 'codex', nativeConversationId: 'exact-id', projectId: 'p', projectPath: tmpdir(), title: 'Saved' });
  mocks.transcript.mockResolvedValue({ messages: [{ role: 'user', text: 'Saved' }], truncated: false });
  mocks.resume.mockReturnValue({ profile: 'codex-resume', resumeSessionId: 'exact-id' }); mocks.create.mockResolvedValue({ ok: true });
  mocks.opencode.mockResolvedValue([{ id: 'exact-id' }]);
  registerSessionsIpc();
});

it('permits explicitly global browsing and validates project-scoped requests', () => {
  call('start', { filter: 'all', query: 'word' }); expect(mocks.start).toHaveBeenCalledWith(7, undefined, 'word');
  call('start', { filter: 'project', projectId: 'p' }); expect(mocks.start).toHaveBeenLastCalledWith(7, 'p', '');
  const calls = mocks.start.mock.calls.length;
  for (const input of [undefined, {}, { filter: 'project' }, { filter: 'project', projectId: 'remote' }, { filter: 'project', projectId: 'unknown' }]) call('start', input);
  expect(mocks.start).toHaveBeenCalledTimes(calls);
});

it('forwards opaque page coordinates and preserves query on refresh', () => {
  call('page', 's', '40'); expect(mocks.get).toHaveBeenCalledWith(7, 's', '40');
  call('refresh', 's'); expect(mocks.refresh).toHaveBeenCalledWith(7, 'p', 'query'); expect(mocks.release).toHaveBeenCalledWith(7, 's');
  call('release', 's'); expect(mocks.release).toHaveBeenCalledTimes(2);
  mocks.get.mockReturnValue({ status: 'expired' }); call('refresh', 's'); expect(mocks.refresh).toHaveBeenCalledTimes(1);
});

it('validates native membership before exact resume and uses the row owner, never renderer paths', async () => {
  await call('resume', 's', 'opaque');
  expect(mocks.transcript).toHaveBeenCalledWith('codex', tmpdir(), 'exact-id');
  expect(mocks.resume).toHaveBeenCalledWith('exact-id');
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p', resumeSessionId: 'exact-id', title: 'Saved' }));
  mocks.transcript.mockResolvedValue({ unavailableReason: 'Missing transcript' });
  expect(await call('resume', 's', 'opaque')).toMatchObject({ ok: false, code: 'NOT_FOUND' }); expect(mocks.create).toHaveBeenCalledTimes(1);
  mocks.find.mockReturnValue(undefined);
  expect(await call('resume', 's', 'opaque')).toMatchObject({ ok: false, code: 'DENIED' });
  expect(await call('transcript', 's', 'opaque')).toHaveProperty('unavailableReason');
});

it('rejects removed or moved projects and providers without exact resume', async () => {
  mocks.projects = []; expect(await call('resume', 's', 'opaque')).toMatchObject({ code: 'NOT_FOUND' });
  mocks.projects = [{ id: 'p', path: '/' }]; expect(await call('resume', 's', 'opaque')).toMatchObject({ code: 'DENIED' });
  expect(await call('transcript', 's', 'opaque')).toHaveProperty('unavailableReason');
  mocks.projects = [{ id: 'p', path: tmpdir() }]; mocks.resume.mockReturnValue(undefined);
  expect(await call('resume', 's', 'opaque')).toMatchObject({ code: 'DENIED' }); expect(mocks.create).not.toHaveBeenCalled();
});

it('revalidates OpenCode sessions and reads its transcript', async () => {
  mocks.find.mockReturnValue({ source: 'opencode', nativeConversationId: 'exact-id', projectId: 'p', projectPath: tmpdir(), title: 'Saved' });
  expect(await call('transcript', 's', 'opaque')).toHaveProperty('messages');
  await call('resume', 's', 'opaque'); expect(mocks.transcript).toHaveBeenCalledWith(tmpdir(), 'exact-id'); expect(mocks.create).toHaveBeenCalledTimes(1);
  mocks.transcript.mockResolvedValue({ unavailableReason: 'Missing' }); expect(await call('resume', 's', 'opaque')).toMatchObject({ code: 'NOT_FOUND' }); expect(mocks.create).toHaveBeenCalledTimes(1);
});

it('returns native previews for validated rows and safe failure shapes for IPC exceptions', async () => {
  expect(await call('transcript', 's', 'opaque')).toHaveProperty('messages');
  expect(mocks.errors.get('history:transcript')!()).toHaveProperty('unavailableReason');
  expect(mocks.errors.get('history:resume')!()).toMatchObject({ ok: false });
  for (const name of ['start', 'refresh', 'page', 'release']) mocks.errors.get(`history:${name}`)!();
});
