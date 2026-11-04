import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, symlinkSync, truncateSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendConversationThreadEvent, archiveConversationThread, createConversationThread, createDeferredThreadMessage,
  createEnvironment, getConversationThread, getEnvironment, listConversationThreadEvents, openDatabase,
  relocateConversationThread, pinConversationThread, setConversationProviderThreadId, updateConversationThreadStatus, upsertHost,
  type ConversationThreadRow, type ZccDatabase
} from '@zana-ai/zcc-db';
import { PROMPT_ATTACHMENT_MAX_BYTES } from '@zana-ai/zcc-domain/thread-runtime';
import type { ProductHttpContext } from '../../http/product-context.js';
import { moveConversationToProject } from './conversation-move.js';
import { copyMovedThreadAttachments } from './conversation-move-attachments.js';
import { withConversationSend } from './conversation-send-guard.js';

const mocks = vi.hoisted(() => ({ stop: vi.fn(), provision: vi.fn(), backgroundCount: 0 }));
vi.mock('./conversation-lifecycle.js', () => ({ stopConversation: mocks.stop }));
vi.mock('./spawn-environment-provision.js', () => ({ provisionProjectEnvironment: mocks.provision }));
vi.mock('./conversation-create.js', () => ({ conversationThreadView: (_ctx: unknown, thread: unknown) => ({
  ...thread as object, activity: { activeBackgroundCommandCount: mocks.backgroundCount }
}) }));

let dir: string;
let db: ZccDatabase;
let ctx: ProductHttpContext;
let thread: ConversationThreadRow;
let destination: ReturnType<typeof createEnvironment>;
const input = { projectId: 'p2', expectedProjectId: 'p1', stop: false };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zcc-move-'));
  db = openDatabase(join(dir, 'db.sqlite'));
  const host = upsertHost(db, { name: 'local', hostKeyHash: 'a'.repeat(64) });
  const source = createEnvironment(db, { projectId: 'p1', hostId: host.id, path: join(dir, 'one'), status: 'ready' });
  destination = createEnvironment(db, { projectId: 'p2', hostId: host.id, path: join(dir, 'two'), status: 'ready' });
  thread = createConversationThread(db, { projectId: 'p1', hostId: host.id, environmentId: source.id, providerId: 'fake', title: 'Keep my history', status: 'idle' });
  ctx = { db, dataDir: dir, toProjects: () => [
    { id: 'p1', name: 'One', path: source.path! },
    { id: 'p2', name: 'Two', path: destination.path! },
    { id: 'remote', name: 'Remote', path: '/remote', hostId: 'other-host' }
  ], hub: { emit: vi.fn() } } as unknown as ProductHttpContext;
  mocks.backgroundCount = 0;
  mocks.stop.mockReset().mockImplementation(async (_ctx, id) => updateConversationThreadStatus(db, id, 'idle'));
  mocks.provision.mockReset().mockResolvedValue(destination);
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

function event(parts: unknown[]) {
  appendConversationThreadEvent(db, { threadId: thread.id, type: 'client/turn/requested', payload: { input: parts } });
}
function attachment(name = 'image.png', content = 'image bytes') {
  mkdirSync(join(dir, 'attachments', 'p1'), { recursive: true });
  writeFileSync(join(dir, 'attachments', 'p1', name), content);
  return { type: 'localImage', path: name };
}

describe('move conversation between registered projects', () => {
  it('keeps identity, provider resume ID, pins and history, binds the destination, and can move back', async () => {
    setConversationProviderThreadId(db, thread.id, 'native-session');
    pinConversationThread(db, thread.id);
    event([attachment()]);
    const history = listConversationThreadEvents(db, thread.id);
    const moved = await moveConversationToProject(ctx, thread.id, input);
    expect(moved).toMatchObject({ id: thread.id, projectId: 'p2', environmentId: destination.id, providerThreadId: 'native-session', title: 'Keep my history' });
    expect(moved.pinnedAt).toBeTruthy();
    expect(getEnvironment(db, moved.environmentId!)?.path).toBe(destination.path);
    expect(listConversationThreadEvents(db, thread.id)).toEqual(history);
    expect(readFileSync(join(dir, 'attachments/p2/image.png'), 'utf8')).toBe('image bytes');
    expect(mocks.stop).toHaveBeenCalledWith(ctx, thread.id, { requireHostRelease: true });
    expect(ctx.hub.emit).toHaveBeenCalledWith('threads:updated', expect.objectContaining({ projectId: 'p2' }));
    const back = createEnvironment(db, { projectId: 'p1', hostId: thread.hostId, path: '/one', status: 'ready' });
    mocks.provision.mockResolvedValueOnce(back);
    await expect(moveConversationToProject(ctx, thread.id, { projectId: 'p1', expectedProjectId: 'p2', stop: false })).resolves.toMatchObject({ projectId: 'p1' });
  });

  it.each([
    ['unknown thread', 'missing', input, 'unknown-thread'],
    ['stale source', '', { ...input, expectedProjectId: 'stale' }, 'project-changed'],
    ['unknown project', '', { ...input, projectId: 'missing' }, 'unknown-project'],
    ['different machine', '', { ...input, projectId: 'remote' }, 'different-machine']
  ])('rejects %s before touching a running send', async (_name, id, request, code) => {
    await withConversationSend(db, thread.id, async lease => {
      await expect(moveConversationToProject(ctx, id || thread.id, request)).rejects.toMatchObject({ code });
      expect(lease.cancelled).toBe(false);
    });
    expect(mocks.stop).not.toHaveBeenCalled();
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it.each(['wrong source', 'wrong project', 'wrong host', 'not ready', 'active', 'archived'])(
    'the database refuses a move with %s even if validation is bypassed', async condition => {
      const request = { threadId: thread.id, expectedProjectId: 'p1', projectId: 'p2', environmentId: destination.id };
      if (condition === 'wrong source') request.expectedProjectId = 'stale';
      if (condition === 'wrong project') request.projectId = 'p1';
      if (condition === 'wrong host') {
        const host = upsertHost(db, { name: 'Other', hostKeyHash: 'b'.repeat(64) });
        request.environmentId = createEnvironment(db, { projectId: 'p2', hostId: host.id, status: 'ready' }).id;
      }
      if (condition === 'not ready') db.sqlite.prepare("UPDATE environments SET status = 'provisioning' WHERE id = ?").run(destination.id);
      if (condition === 'active') updateConversationThreadStatus(db, thread.id, 'active');
      if (condition === 'archived') archiveConversationThread(db, thread.id);
      expect(relocateConversationThread(db, request)).toBeNull();
      expect(getConversationThread(db, thread.id)?.projectId).toBe('p1');
    }
  );

  it('does nothing when already in the destination', async () => {
    await withConversationSend(db, thread.id, async lease => {
      await expect(moveConversationToProject(ctx, thread.id, { ...input, projectId: 'p1' })).resolves.toEqual(thread);
      expect(lease.cancelled).toBe(false);
    });
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it.each(['active', 'starting', 'stopping'] as const)('requires confirmation for %s and releases it when confirmed', async status => {
    updateConversationThreadStatus(db, thread.id, status);
    await expect(moveConversationToProject(ctx, thread.id, input)).rejects.toMatchObject({ code: 'session-running' });
    expect(mocks.stop).not.toHaveBeenCalled();
    await expect(moveConversationToProject(ctx, thread.id, { ...input, stop: true })).resolves.toMatchObject({ projectId: 'p2', status: 'idle' });
  });

  it('requires confirmation for a send still being prepared before its active status is written', async () => {
    await withConversationSend(db, thread.id, async lease => {
      await expect(moveConversationToProject(ctx, thread.id, input)).rejects.toMatchObject({ code: 'session-running' });
      expect(lease.cancelled).toBe(false);expect(mocks.stop).not.toHaveBeenCalled();
      await expect(moveConversationToProject(ctx, thread.id, { ...input, stop: true })).resolves.toMatchObject({ projectId: 'p2' });
      expect(lease.cancelled).toBe(true);
    });
  });

  it('also confirms background processes on an idle session', async () => {
    mocks.backgroundCount = 1;
    await expect(moveConversationToProject(ctx, thread.id, input)).rejects.toMatchObject({ code: 'session-running' });
  });

  it.each(['archived', 'parent', 'child', 'hidden', 'plugin', 'queue'])('rejects an %s session', async kind => {
    if (kind === 'archived') archiveConversationThread(db, thread.id);
    if (kind === 'parent') {
      const parent = createConversationThread(db, { projectId: 'p1', hostId: thread.hostId, environmentId: thread.environmentId!, providerId: 'fake' });
      db.sqlite.prepare('UPDATE threads SET parent_thread_id = ? WHERE id = ?').run(parent.id, thread.id);
    }
    if (kind === 'child') createConversationThread(db, { projectId: 'p1', hostId: thread.hostId, environmentId: thread.environmentId!, providerId: 'fake', parentThreadId: thread.id });
    if (kind === 'hidden') db.sqlite.prepare("UPDATE threads SET visibility = 'hidden' WHERE id = ?").run(thread.id);
    if (kind === 'plugin') db.sqlite.prepare("UPDATE threads SET origin_plugin_id = 'plugin' WHERE id = ?").run(thread.id);
    if (kind === 'queue') createDeferredThreadMessage(db, { threadId: thread.id, kind: 'send', payload: '{}' });
    await expect(moveConversationToProject(ctx, thread.id, input)).rejects.toMatchObject({ code: kind === 'archived' ? 'archived-thread' : kind === 'queue' ? 'queued-messages' : 'owned-session' });
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it('preserves the source when provisioning or strict host release fails', async () => {
    mocks.provision.mockRejectedValueOnce(new Error('path missing'));
    await expect(moveConversationToProject(ctx, thread.id, input)).rejects.toThrow('path missing');
    expect(mocks.stop).not.toHaveBeenCalled();
    mocks.stop.mockRejectedValueOnce(new Error('host offline'));
    await expect(moveConversationToProject(ctx, thread.id, input)).rejects.toThrow('host offline');
    expect(getConversationThread(db, thread.id)?.projectId).toBe('p1');
    mocks.provision.mockResolvedValueOnce({ ...destination, hostId: 'other-host' });
    await expect(moveConversationToProject(ctx, thread.id, input)).rejects.toMatchObject({ code: 'different-machine' });
  });

  it('blocks sends and duplicate moves until completion, then releases the lock', async () => {
    let release!: () => void;
    mocks.provision.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(destination); }));
    const first = moveConversationToProject(ctx, thread.id, input);
    await expect(moveConversationToProject(ctx, thread.id, input)).rejects.toMatchObject({ code: 'move-in-progress' });
    await expect(withConversationSend(db, thread.id, async () => {})).rejects.toMatchObject({ code: 'stopping' });
    release();
    await first;
    await expect(withConversationSend(db, thread.id, async lease => lease.assertCurrent())).resolves.toBeUndefined();
  });

  it('serializes attachment publication into the same destination project', async () => {
    const other = createConversationThread(db, { projectId: 'p1', hostId: thread.hostId,
      environmentId: thread.environmentId, providerId: 'fake', status: 'idle' });
    let release!: () => void;
    mocks.provision.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(destination); }));
    const first = moveConversationToProject(ctx, thread.id, input);
    await expect(moveConversationToProject(ctx, other.id, input)).rejects.toMatchObject({ code: 'move-in-progress' });
    release();await first;
    await expect(moveConversationToProject(ctx, other.id, input)).resolves.toMatchObject({ projectId: 'p2' });
  });

  it('rechecks queued messages after stopping and rolls back copied files', async () => {
    event([attachment()]);
    mocks.stop.mockImplementationOnce(async () => {
      createDeferredThreadMessage(db, { threadId: thread.id, kind: 'send', payload: '{}' });
      return thread;
    });
    await expect(moveConversationToProject(ctx, thread.id, input)).rejects.toMatchObject({ code: 'queued-messages' });
    expect(getConversationThread(db, thread.id)?.projectId).toBe('p1');
    expect(existsSync(join(dir, 'attachments/p2/image.png'))).toBe(false);
  });

  it('keeps committed attachments if publishing the update fails', async () => {
    event([attachment()]);
    vi.mocked(ctx.hub.emit).mockImplementationOnce(() => { throw new Error('Event listener failed'); });
    await expect(moveConversationToProject(ctx, thread.id, input)).rejects.toThrow('Event listener failed');
    expect(getConversationThread(db, thread.id)?.projectId).toBe('p2');
    expect(readFileSync(join(dir, 'attachments/p2/image.png'), 'utf8')).toBe('image bytes');
  });

  it('rolls back new attachment copies if the thread changes before commit', async () => {
    event([attachment()]);
    mocks.stop.mockImplementationOnce(async () => {
      archiveConversationThread(db, thread.id);
      return getConversationThread(db, thread.id);
    });
    await expect(moveConversationToProject(ctx, thread.id, input)).rejects.toMatchObject({ code: 'archived-thread' });
    expect(existsSync(join(dir, 'attachments/p2/image.png'))).toBe(false);
    expect(getConversationThread(db, thread.id)?.projectId).toBe('p1');
  });
});

describe('attachments during moves', () => {
  it('paginates history, skips non-upload inputs, and copies only referenced files', async () => {
    event([attachment('old.png'), null, { type: 'text', text: 'keep' }, { type: 'localFile', path: '/absolute/file' }]);
    for (let i = 0; i < 60; i++) event([{ type: 'text', text: String(i) }]);
    attachment('other-session.png');
    event([{ type: 'localImage', path: 'old.png' }]);
    const cleanup = await copyMovedThreadAttachments(ctx, thread.id, 'p1', 'p2');
    expect(existsSync(join(dir, 'attachments/p2/old.png'))).toBe(true);
    expect(existsSync(join(dir, 'attachments/p2/other-session.png'))).toBe(false);
    await cleanup();
    expect(existsSync(join(dir, 'attachments/p2/old.png'))).toBe(false);
  });

  it('keeps existing identical files and rejects a name collision without overwriting it', async () => {
    event([attachment()]);
    mkdirSync(join(dir, 'attachments/p2'), { recursive: true });
    const path = join(dir, 'attachments/p2/image.png');
    writeFileSync(path, 'image bytes');
    await copyMovedThreadAttachments(ctx, thread.id, 'p1', 'p2');
    writeFileSync(path, 'different bytes');
    await expect(copyMovedThreadAttachments(ctx, thread.id, 'p1', 'p2')).rejects.toMatchObject({ code: 'attachment-conflict' });
    expect(readFileSync(path, 'utf8')).toBe('different bytes');
  });

  it.each(['missing.png', '../outside.png', 'nested/image.png', 'nested\\image.png'])('refuses unavailable or escaping attachment %s', async path => {
    event([{ type: 'localFile', path }]);
    await expect(copyMovedThreadAttachments(ctx, thread.id, 'p1', 'p2')).rejects.toBeTruthy();
  });

  it('refuses a symlink source and leaves an existing destination symlink untouched', async () => {
    event([attachment()]);
    const outside = join(dir, 'outside');writeFileSync(outside, 'image bytes');
    rmSync(join(dir, 'attachments/p1/image.png'));symlinkSync(outside, join(dir, 'attachments/p1/image.png'));
    await expect(copyMovedThreadAttachments(ctx, thread.id, 'p1', 'p2')).rejects.toMatchObject({ code: 'attachment-unavailable' });
    rmSync(join(dir, 'attachments/p1/image.png'));attachment();
    mkdirSync(join(dir, 'attachments/p2'), { recursive: true });
    symlinkSync(outside, join(dir, 'attachments/p2/image.png'));
    await expect(copyMovedThreadAttachments(ctx, thread.id, 'p1', 'p2')).rejects.toMatchObject({ code: 'attachment-conflict' });
  });

  it.each(['p1', 'p2'])('refuses a project attachment directory symlink outside the upload store (%s)', async projectId => {
    event([attachment()]);
    const outside = join(dir, 'other-data');mkdirSync(outside);
    writeFileSync(join(outside, 'image.png'), 'image bytes');
    rmSync(join(dir, 'attachments', projectId), { recursive: true, force: true });
    symlinkSync(outside, join(dir, 'attachments', projectId));
    await expect(copyMovedThreadAttachments(ctx, thread.id, 'p1', 'p2')).rejects.toMatchObject({
      code: projectId === 'p1' ? 'attachment-unavailable' : 'attachment-escape'
    });
    expect(readFileSync(join(outside, 'image.png'), 'utf8')).toBe('image bytes');
  });

  it('rejects oversized files and removes copies made before failure', async () => {
    event([attachment('first.png'), attachment('large.png')]);
    truncateSync(join(dir, 'attachments/p1/large.png'), PROMPT_ATTACHMENT_MAX_BYTES + 1);
    await expect(copyMovedThreadAttachments(ctx, thread.id, 'p1', 'p2')).rejects.toMatchObject({ code: 'move-attachments-too-large' });
    expect(existsSync(join(dir, 'attachments/p2/first.png'))).toBe(false);
  });
});
