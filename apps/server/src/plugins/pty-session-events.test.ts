import { afterEach, describe, expect, it, vi } from 'vitest';
import { PTY_LIFECYCLE_KINDS, PtyLifecycleEventMainRequestSchema } from '@zana-ai/zcc-contracts/runtime';
import { emitMainOwnedPtyLifecycle } from './pty-session-events.js';
import { emitPluginThreadEvent } from './thread-events.js';

const base = { sessionId: 's1', projectId: 'p1', profile: 'claude' } as const;
const ctx = (emit: ReturnType<typeof vi.fn>) => ({ plugins: { emitThreadEvent: emit } }) as never;

afterEach(() => vi.restoreAllMocks());

describe('emitMainOwnedPtyLifecycle', () => {
  it('reports not delivered when no plugin service exists', () => {
    expect(emitMainOwnedPtyLifecycle(undefined, { ...base, kind: 'created' })).toEqual({ delivered: false });
    expect(emitMainOwnedPtyLifecycle({} as never, { ...base, kind: 'created' })).toEqual({ delivered: false });
  });

  it.each([
    ['created', 'thread.created'], ['active', 'thread.active'], ['idle', 'thread.idle'],
    ['failed', 'thread.failed'], ['deleted', 'thread.deleted']
  ] as const)('maps %s to %s with pty identity', (kind, name) => {
    const emit = vi.fn().mockResolvedValue(undefined);
    expect(emitMainOwnedPtyLifecycle(ctx(emit), { ...base, kind })).toEqual({ delivered: true });
    expect(emit).toHaveBeenCalledOnce();
    expect(emit.mock.calls[0]![0]).toMatchObject({
      name, surface: 'pty', sessionId: 's1', threadId: 's1', projectId: 'p1', providerId: 'claude-code',
      id: expect.any(String), sequence: expect.any(Number), timestamp: expect.any(Number), schemaVersion: 1
    });
  });

  it('maps every contract kind', () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    for (const kind of PTY_LIFECYCLE_KINDS) emitMainOwnedPtyLifecycle(ctx(emit), { ...base, kind });
    expect(emit).toHaveBeenCalledTimes(PTY_LIFECYCLE_KINDS.length);
  });

  it('uses the bound thread id when main has one', () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    emitMainOwnedPtyLifecycle(ctx(emit), { ...base, kind: 'idle', threadId: 't9', profile: 'codex-yolo' });
    expect(emit.mock.calls[0]![0]).toMatchObject({ threadId: 't9', sessionId: 's1', providerId: 'codex' });
  });

  it('redacts and carries a failure cause, and omits error otherwise', () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    emitMainOwnedPtyLifecycle(ctx(emit), { ...base, kind: 'failed', error: 'token=abc exited with code 3' });
    emitMainOwnedPtyLifecycle(ctx(emit), { ...base, kind: 'created' });
    expect(emit.mock.calls[0]![0].error).toContain('[redacted]');
    expect('error' in emit.mock.calls[1]![0]).toBe(false);
  });

  it('never throws or rejects into the caller when a plugin fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const emit = vi.fn().mockRejectedValue(new Error('plugin down'));
    expect(emitMainOwnedPtyLifecycle(ctx(emit), { ...base, kind: 'created' })).toEqual({ delivered: true });
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
  });

  it('gives PTY and Modern payloads the same identity fields', () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    emitMainOwnedPtyLifecycle(ctx(emit), { ...base, kind: 'idle', threadId: 't1' });
    emitPluginThreadEvent(ctx(emit), { name: 'thread.idle', threadId: 't1', projectId: 'p1' });
    const [pty, modern] = emit.mock.calls.map(([event]) => event);
    for (const field of ['name', 'threadId', 'projectId', 'schemaVersion']) expect(pty[field]).toEqual(modern[field]);
    expect(pty.surface).toBe('pty');
    expect(modern.surface).toBe('modern');
    expect(pty.sessionId).toBe('s1');
    expect('sessionId' in modern).toBe(false);
  });
});

describe('PtyLifecycleEventMainRequestSchema', () => {
  it('accepts a minimal request and rejects extras, bad kinds and oversized fields', () => {
    expect(PtyLifecycleEventMainRequestSchema.safeParse({ ...base, kind: 'created' }).success).toBe(true);
    expect(PtyLifecycleEventMainRequestSchema.safeParse({ ...base, kind: 'created', extra: 1 }).success).toBe(false);
    expect(PtyLifecycleEventMainRequestSchema.safeParse({ ...base, kind: 'archived' }).success).toBe(false);
    expect(PtyLifecycleEventMainRequestSchema.safeParse({ ...base, kind: 'failed', error: 'x'.repeat(1025) }).success).toBe(false);
    expect(PtyLifecycleEventMainRequestSchema.safeParse({ ...base, kind: 'created', profile: 'Bad Profile' }).success).toBe(false);
  });
});

describe('emitMainOwnedPtyLifecycle session tracking', () => {
  const tracked = (emit = vi.fn().mockResolvedValue(undefined)) => {
    const ptyInteractions = { noteSession: vi.fn(), endSession: vi.fn() };
    return { ptyInteractions, ctx: { plugins: { emitThreadEvent: emit }, ptyInteractions } as never };
  };

  it.each(['created', 'active', 'idle'] as const)('notes the session live on %s', (kind) => {
    const { ctx: c, ptyInteractions } = tracked();
    emitMainOwnedPtyLifecycle(c, { ...base, kind });
    expect(ptyInteractions.noteSession).toHaveBeenCalledWith({ sessionId: 's1', projectId: 'p1' });
    expect(ptyInteractions.endSession).not.toHaveBeenCalled();
  });

  it.each(['failed', 'deleted'] as const)('ends the session on %s', (kind) => {
    const { ctx: c, ptyInteractions } = tracked();
    emitMainOwnedPtyLifecycle(c, { ...base, kind });
    expect(ptyInteractions.endSession).toHaveBeenCalledWith('s1');
    expect(ptyInteractions.noteSession).not.toHaveBeenCalled();
  });

  it('tracks the session even when no plugin service exists', () => {
    const ptyInteractions = { noteSession: vi.fn(), endSession: vi.fn() };
    expect(emitMainOwnedPtyLifecycle({ ptyInteractions } as never, { ...base, kind: 'created' })).toEqual({ delivered: false });
    expect(ptyInteractions.noteSession).toHaveBeenCalledOnce();
  });
});
