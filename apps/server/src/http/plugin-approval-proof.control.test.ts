import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendConversationThreadEvent, archiveConversationThread, createConversationThread, createEnvironment, insertThreadPluginMetadata, openDatabase, setConversationProviderThreadId, unarchiveConversationThread, updateConversationThreadStatus, upsertHost } from '@zana-ai/zcc-db';
import { callControlAsProductServer, productServerHasDesktopCredential } from './cli-agent-ops.js';
import { createProductHttpContext } from './product-context.js';
import { createPluginApi } from '../plugins/plugin-api.js';
import { capturePluginToolApprovalIdentity, isPluginToolApprovalScopeLive, PLUGIN_APPROVAL_TTL_MS, requestPluginToolApprovalViaControl, signPluginApproval } from './plugin-approval-proof.js';

vi.mock('./cli-agent-ops.js', async importOriginal => ({
  ...await importOriginal<typeof import('./cli-agent-ops.js')>(),
  callControlAsProductServer: vi.fn(),
  productServerHasDesktopCredential: vi.fn()
}));

const secret = 's'.repeat(40);
const binding = { action: 'agent.activate', target: 'org', targetLabel: 'sandbox', subject: 'Agent', revision: 'sha' };
const input = { pluginId: 'approval-plugin', projectId: 'p', request: { binding, title: 'Activate', threadId: 't', invocationId: 'i', timeoutMs: 300000 } };
const approved = () => {
  const token = signPluginApproval(secret, input.pluginId, { ...binding, threadId: 't', invocationId: 'i' });
  return { approved: true as const, token, expiresAt: Number(token.split('.')[0]) + PLUGIN_APPROVAL_TTL_MS };
};
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });

describe('approval product-server control client', () => {
  it('requires desktop credential and validated request before calling control', async () => {
    vi.mocked(productServerHasDesktopCredential).mockReturnValue(false);
    expect(await requestPluginToolApprovalViaControl('/tmp', input)).toEqual({ approved: false, reason: 'unavailable' });
    vi.mocked(productServerHasDesktopCredential).mockReturnValue(true);
    expect(await requestPluginToolApprovalViaControl('/tmp', { ...input, request: { ...input.request, title: '' } })).toEqual({ approved: false, reason: 'invalid' });
    expect(callControlAsProductServer).not.toHaveBeenCalled();
  });

  it('sends derived scoped binding with bounded wait instead of generic control timeout', async () => {
    vi.mocked(productServerHasDesktopCredential).mockReturnValue(true);
    const result = approved();
    vi.mocked(callControlAsProductServer).mockResolvedValue({ ok: true, value: result });
    expect(await requestPluginToolApprovalViaControl('/tmp', input)).toEqual(result);
    expect(callControlAsProductServer).toHaveBeenCalledWith('/tmp', 'plugin.toolApproval.request', {
      ...input.request, pluginId: input.pluginId, projectId: 'p', binding: { ...binding, threadId: 't', invocationId: 'i' }
    }, 300000);
    for (const reason of ['cancelled', 'denied', 'timeout', 'unavailable', 'busy', 'invalid'] as const) {
      vi.mocked(callControlAsProductServer).mockResolvedValue({ ok: true, value: { approved: false, reason, token: 'untrusted' } });
      expect(await requestPluginToolApprovalViaControl('/tmp', input)).toEqual({ approved: false, reason });
    }
  });

  it('rejects malformed, expired, future or inconsistent proofs and control errors', async () => {
    vi.mocked(productServerHasDesktopCredential).mockReturnValue(true);
    const result = approved();
    for (const response of [null, { ok: false }, { ok: true }, { ok: true, value: {} }]) {
      vi.mocked(callControlAsProductServer).mockResolvedValue(response);
      expect(await requestPluginToolApprovalViaControl('/tmp', input)).toEqual({ approved: false, reason: 'unavailable' });
    }
    for (const value of [{ approved: false, reason: 'allow' }, { ...result, token: 'forged' }, { ...result, expiresAt: 0 },
      { ...result, expiresAt: result.expiresAt + 1 }, { ...result, expiresAt: 1.5 },
      { approved: true, token: signPluginApproval(secret, input.pluginId, binding, Date.now() + 1000), expiresAt: Date.now() + 301000 }]) {
      vi.mocked(callControlAsProductServer).mockResolvedValue({ ok: true, value });
      expect(await requestPluginToolApprovalViaControl('/tmp', input)).toEqual({ approved: false, reason: 'invalid' });
    }
    vi.useFakeTimers();
    vi.setSystemTime(result.expiresAt);
    vi.mocked(callControlAsProductServer).mockResolvedValue({ ok: true, value: result });
    expect(await requestPluginToolApprovalViaControl('/tmp', input)).toEqual({ approved: false, reason: 'invalid' });
    vi.mocked(callControlAsProductServer).mockRejectedValue(new Error('socket unavailable'));
    expect(await requestPluginToolApprovalViaControl('/tmp', input)).toEqual({ approved: false, reason: 'unavailable' });
  });
});

describe('approval live local scope', () => {
  it('refuses missing, non-running, hidden, archived, foreign-host/project/environment and remote-surface threads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'approval-scope-'));
    const db = openDatabase(join(dir, 'test.sqlite'));
    const project = { id: 'p', name: 'Project', path: dir, createdAt: 1, lastActiveAt: 1 };
    let projects: Array<typeof project & { remote?: unknown; hostId?: string }> = [project];
    const scope = { db, projects: { list: () => projects } } as Parameters<typeof isPluginToolApprovalScopeLive>[0];
    try {
      const host = upsertHost(db, { id: 'local', name: 'Local', hostKeyHash: 'local', isPrimary: true });
      const remote = upsertHost(db, { id: 'remote', name: 'Remote', hostKeyHash: 'remote', isPrimary: false });
      const localEnv = createEnvironment(db, { projectId: 'p', hostId: host.id, path: dir });
      const otherEnv = createEnvironment(db, { projectId: 'other', hostId: host.id, path: dir });
      const remoteEnv = createEnvironment(db, { projectId: 'p', hostId: remote.id, path: dir });
      const create = (extra = {}) => createConversationThread(db, { projectId: 'p', hostId: host.id, providerId: 'codex', status: 'active', ...extra });
      const local = create({ environmentId: localEnv.id });
      expect(isPluginToolApprovalScopeLive(scope, local.id, 'p')).toBe(true);
      expect(isPluginToolApprovalScopeLive(scope, create().id, 'p')).toBe(true);
      expect(isPluginToolApprovalScopeLive(scope, create({ status: 'idle' }).id, 'p')).toBe(false);
      for (const thread of [create({ visibility: 'hidden' }), create({ projectId: 'other' }), create({ hostId: remote.id }),
        create({ environmentId: otherEnv.id }), create({ environmentId: remoteEnv.id })]) {
        expect(isPluginToolApprovalScopeLive(scope, thread.id, 'p')).toBe(false);
      }
      expect(isPluginToolApprovalScopeLive(scope, 'missing', 'p')).toBe(false);
      for (const rows of [[], [{ ...project, remote: { hostId: 'remote' } }], [{ ...project, hostId: 'remote' }]]) {
        projects = rows;
        expect(isPluginToolApprovalScopeLive(scope, local.id, 'p')).toBe(false);
      }
      projects = [project];
      const remoteSurface = create({ originPluginId: 'slack' });
      insertThreadPluginMetadata(db, { threadId: remoteSurface.id, pluginId: 'slack', metadata: { interactionSurface: { kind: 'remote', label: 'Slack' } } });
      expect(isPluginToolApprovalScopeLive(scope, remoteSurface.id, 'p')).toBe(false);
      archiveConversationThread(db, local.id);
      expect(isPluginToolApprovalScopeLive(scope, local.id, 'p')).toBe(false);
      db.sqlite.prepare('UPDATE hosts SET destroyed_at = 1 WHERE id = ?').run(host.id);
      expect(isPluginToolApprovalScopeLive(scope, create({ hostId: remote.id }).id, 'p')).toBe(false);
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('keeps active thread identity live, then rejects replacement and resumed stale invocations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'approval-identity-'));
    const db = openDatabase(join(dir, 'test.sqlite'));
    const project = { id: 'p', name: 'Project', path: dir, createdAt: 1, lastActiveAt: 1 };
    const scope = { db, projects: { list: () => [project] } } as Parameters<typeof isPluginToolApprovalScopeLive>[0];
    try {
      const host = upsertHost(db, { id: 'local', name: 'Local', hostKeyHash: 'local', isPrimary: true });
      const thread = createConversationThread(db, { projectId: project.id, hostId: host.id, providerId: 'codex', providerThreadId: 'provider-original', status: 'active' });
      const identity = capturePluginToolApprovalIdentity(scope, thread.id);
      expect(identity).not.toBeNull();
      expect(isPluginToolApprovalScopeLive(scope, thread.id, project.id, identity!)).toBe(true);

      setConversationProviderThreadId(db, thread.id, 'provider-replaced');
      expect(isPluginToolApprovalScopeLive(scope, thread.id, project.id, identity!)).toBe(false);

      const resumed = capturePluginToolApprovalIdentity(scope, thread.id);
      expect(resumed).not.toBeNull();
      expect(isPluginToolApprovalScopeLive(scope, thread.id, project.id, resumed!)).toBe(true);
      appendConversationThreadEvent(db, { threadId: thread.id, type: 'system/thread/interrupted', payload: {} });
      updateConversationThreadStatus(db, thread.id, 'idle');
      updateConversationThreadStatus(db, thread.id, 'active');
      expect(isPluginToolApprovalScopeLive(scope, thread.id, project.id, resumed!)).toBe(false);
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('rechecks persisted thread scope after control wait and before consuming inside invocation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'approval-context-'));
    const ctx = createProductHttpContext({ dataDir: dir, origins: { serverPort: 0 }, uiSendSecret: secret });
    let handle: ReturnType<typeof createPluginApi> | undefined;
    try {
      const project = await ctx.projects.add(dir);
      const host = upsertHost(ctx.db, { name: 'Local', hostKeyHash: 'hash', isPrimary: true });
      const thread = createConversationThread(ctx.db, { projectId: project.id, hostId: host.id, providerId: 'codex', status: 'active' });
      const scope = { ...input, projectId: project.id, request: { ...input.request, threadId: thread.id } };
      vi.mocked(productServerHasDesktopCredential).mockReturnValue(true);
      vi.mocked(callControlAsProductServer).mockImplementation(async () => {
        archiveConversationThread(ctx.db, thread.id);
        return { ok: true, value: approved() };
      });
      expect(await ctx.requestPluginToolApproval!(scope)).toEqual({ approved: false, reason: 'unavailable' });
      expect(await ctx.requestPluginToolApproval!(scope)).toEqual({ approved: false, reason: 'unavailable' });
      expect(callControlAsProductServer).toHaveBeenCalledTimes(1);
      unarchiveConversationThread(ctx.db, thread.id);
      updateConversationThreadStatus(ctx.db, thread.id, 'active');
      vi.mocked(callControlAsProductServer).mockResolvedValue({ ok: true, value: approved() });
      expect(await ctx.requestPluginToolApproval!(scope)).toMatchObject({ approved: true });
      const live = createConversationThread(ctx.db, { projectId: project.id, hostId: host.id, providerId: 'codex', status: 'active' });
      const verify = vi.fn(({ token, pluginId, binding }: { token: string; pluginId: string; binding: unknown }) => ctx.verifyPluginApproval!(token, pluginId, binding));
      handle = createPluginApi(input.pluginId, dir, { productContext: ctx, consumePluginApproval: verify, requestPluginToolApproval: async request => {
        const token = signPluginApproval(secret, request.pluginId, request.request.binding);
        return { approved: true, token, expiresAt: Number(token.split('.')[0]) + PLUGIN_APPROVAL_TTL_MS };
      } });
      const api = handle.api;
      api.agents.registerTool({ name: 'approve', description: 'Approve', parameters: { type: 'object' }, execute: async () => {
        const result = await api.ui.requestToolApproval({ binding, title: 'Activate' });
        expect(result.approved).toBe(true);
        if (!result.approved) return;
        archiveConversationThread(ctx.db, live.id);
        expect(await api.ui.consumeApproval({ token: result.token, binding })).toBe(false);
      } });
      await handle.agentTools[0]!.execute({}, { threadId: live.id, projectId: project.id, signal: new AbortController().signal, desktopPresentation: true } as never);
      expect(verify).not.toHaveBeenCalled();
      unarchiveConversationThread(ctx.db, live.id);
      updateConversationThreadStatus(ctx.db, live.id, 'active');
      const fallback = createPluginApi(input.pluginId, dir, { productContext: ctx });
      try {
        fallback.api.agents.registerTool({ name: 'fallback', description: 'Approve', parameters: { type: 'object' },
          execute: () => fallback.api.ui.requestToolApproval({ binding, title: 'Activate' }) });
        expect(await fallback.agentTools[0]!.execute({}, { threadId: live.id, projectId: project.id,
          signal: new AbortController().signal, desktopPresentation: true } as never)).toMatchObject({ approved: true });
      } finally { await fallback.dispose(); }
    } finally {
      await handle?.dispose(); ctx.hostHub.close(); await ctx.dispose(); ctx.db.close(); rmSync(dir, { recursive: true, force: true });
    }
  });
});
