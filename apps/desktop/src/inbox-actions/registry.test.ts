import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openExecutionDatabase, type ExecutionDatabase } from '@zana-ai/zcc-db';
import type { InboxEntry } from '@zana-ai/zcc-domain/product';
import { createInboxActionRegistry, InboxActionOperatorError } from './registry.js';

let directory: string | null = null;
let database: ExecutionDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = null;
});

function entry(overrides: Partial<InboxEntry> = {}): InboxEntry {
  return {
    id: 'entry-1',
    ts: 1,
    projectId: 'project-1',
    subject: 'Subject',
    comments: 'Choose one',
    question: { options: [{ id: 'A', label: 'Accept' }] },
    ...overrides
  };
}

function open(): ExecutionDatabase {
  directory = mkdtempSync(join(tmpdir(), 'zcc-inbox-actions-'));
  database = openExecutionDatabase(join(directory, 'execution.sqlite'));
  return database;
}

describe('inbox action registry', () => {
  it('is inert when execution SQLite is unavailable', async () => {
    const registry = createInboxActionRegistry();
    expect(registry.enabled).toBe(false);
    expect(registry.bind(entry(), { kind: 'test', ref: 'ref' })).toBe(false);
    expect(registry.list([entry()])).toEqual([]);
    expect(await registry.run(entry())).toEqual({ ok: false, status: 'missing' });
  });

  it('binds immutable content, dispatches once, and cleans removed rows', async () => {
    const registry = createInboxActionRegistry(open());
    const handler = vi.fn(async () => {});
    registry.register('test', handler);
    expect(registry.bind(entry(), { kind: 'test', ref: 'private-ref' })).toBe(true);
    expect(registry.bind(entry(), { kind: 'test', ref: 'private-ref' })).toBe(false);
    expect(registry.list([entry()])).toEqual([{ entryId: 'entry-1', kind: 'test', status: 'pending' }]);

    expect(await registry.run(entry(), { optionId: 'A' })).toEqual({ ok: true, status: 'done' });
    expect(handler).toHaveBeenCalledWith({ ref: 'private-ref', input: { optionId: 'A' } });
    expect(await registry.run(entry(), { optionId: 'A' })).toEqual({ ok: true, status: 'done' });
    expect(handler).toHaveBeenCalledTimes(1);

    registry.remove(['entry-1']);
    expect(registry.list([entry()])).toEqual([]);
  });

  it('only surfaces registered pending actions and rejects labels or unknown option ids', async () => {
    const registry = createInboxActionRegistry(open());
    registry.bind(entry(), { kind: 'test', ref: 'private-ref' });
    expect(registry.list([entry()])).toEqual([]);

    const handler = vi.fn();
    registry.register('test', handler);
    expect(await registry.run(entry(), { optionId: 'Accept' })).toEqual({ ok: false, status: 'missing' });
    expect(await registry.run(entry(), { optionId: 'unknown' })).toEqual({ ok: false, status: 'missing' });
    expect(handler).not.toHaveBeenCalled();
    expect(registry.list([entry()])).toEqual([{ entryId: 'entry-1', kind: 'test', status: 'pending' }]);
  });

  it('rejects modified entry content and resets interrupted claims after restart', async () => {
    const db = open();
    const registry = createInboxActionRegistry(db);
    registry.register('test', async () => new Promise(() => {}));
    registry.bind(entry(), { kind: 'test', ref: 'private-ref' });
    const pending = registry.run(entry(), { optionId: 'A' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(registry.list([entry()])).toEqual([{ entryId: 'entry-1', kind: 'test', status: 'claimed' }]);
    expect(registry.list([entry({ comments: 'Changed' })])).toEqual([]);

    db.close();
    database = openExecutionDatabase(join(directory!, 'execution.sqlite'));
    const restarted = createInboxActionRegistry(database);
    restarted.register('test', vi.fn());
    expect(restarted.list([entry()])).toEqual([{ entryId: 'entry-1', kind: 'test', status: 'pending' }]);
    void pending;
  });

  it('keeps handler failures host-owned and pending for retry', async () => {
    const registry = createInboxActionRegistry(open());
    const handler = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(undefined);
    registry.register('test', handler);
    registry.bind(entry(), { kind: 'test', ref: 'private-ref' });

    await expect(registry.run(entry(), { optionId: 'A' })).resolves.toEqual({ ok: false, status: 'failed' });
    expect(registry.list([entry()])).toEqual([{
      entryId: 'entry-1', kind: 'test', status: 'pending', message: 'Could not complete this decision. Try again.'
    }]);
    await expect(registry.run(entry(), { optionId: 'A' })).resolves.toEqual({ ok: true, status: 'done' });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('retains unexpected handler failure details outside renderer projection', async () => {
    const registry = createInboxActionRegistry(open());
    registry.register('test', vi.fn().mockRejectedValue(new Error('/private/worktree secret failure')));
    registry.bind(entry(), { kind: 'test', ref: 'private-ref' });

    await expect(registry.run(entry(), { optionId: 'A' })).resolves.toEqual({ ok: false, status: 'failed' });
    expect(registry.list([entry()])).toEqual([{
      entryId: 'entry-1', kind: 'test', status: 'pending', message: 'Could not complete this decision. Try again.'
    }]);
  });

  it('projects operator-visible safety rejection without changing generic retry behavior', async () => {
    const registry = createInboxActionRegistry(open());
    const handler = vi.fn()
      .mockRejectedValueOnce(new InboxActionOperatorError('Worktree is in use by an active follow-up agent. Wait for it to exit, then try again.'))
      .mockResolvedValueOnce(undefined);
    registry.register('test', handler);
    registry.bind(entry(), { kind: 'test', ref: 'private-ref' });

    await expect(registry.run(entry(), { optionId: 'A' })).resolves.toEqual({ ok: false, status: 'failed' });
    expect(registry.list([entry()])).toEqual([{
      entryId: 'entry-1', kind: 'test', status: 'pending',
      message: 'Worktree is in use by an active follow-up agent. Wait for it to exit, then try again.'
    }]);
    await expect(registry.run(entry(), { optionId: 'A' })).resolves.toEqual({ ok: true, status: 'done' });
  });

  it('keeps superseded actions visible but unavailable', async () => {
    const registry = createInboxActionRegistry(open());
    registry.register('test', vi.fn());
    registry.bind(entry(), { kind: 'test', ref: 'private-ref' });
    registry.markUnavailable('test', 'private-ref', 'This confirmation is unavailable because the retained Squad worktree was deleted.');

    expect(registry.list([entry()])).toEqual([{
      entryId: 'entry-1', kind: 'test', status: 'failed', unavailable: true,
      message: 'This confirmation is unavailable because the retained Squad worktree was deleted.'
    }]);
    await expect(registry.run(entry(), { optionId: 'A' })).resolves.toEqual({ ok: false, status: 'missing' });
  });

  it('keeps claimed and completed actions host-owned', async () => {
    const registry = createInboxActionRegistry(open());
    let finish!: () => void;
    registry.register('test', () => new Promise<void>((resolve) => { finish = resolve; }));
    registry.bind(entry(), { kind: 'test', ref: 'private-ref' });

    const running = registry.run(entry(), { optionId: 'A' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(registry.list([entry()])).toEqual([{ entryId: 'entry-1', kind: 'test', status: 'claimed' }]);
    finish();
    await expect(running).resolves.toEqual({ ok: true, status: 'done' });
    expect(registry.list([entry()])).toEqual([{ entryId: 'entry-1', kind: 'test', status: 'done' }]);
  });

  it('requires text only for the main-declared text option', async () => {
    const registry = createInboxActionRegistry(open());
    const instruct = entry({ question: { options: [{ id: 'leave', label: 'Leave' }, { id: 'instruct', label: 'Instruct an agent' }] } });
    const handler = vi.fn();
    registry.register('test', handler);
    registry.bind(instruct, { kind: 'test', ref: 'private-ref', textOptionId: 'instruct' });

    expect(registry.list([instruct])).toEqual([{ entryId: 'entry-1', kind: 'test', status: 'pending', textOptionId: 'instruct' }]);
    await expect(registry.run(instruct, { optionId: 'instruct' })).resolves.toEqual({ ok: false, status: 'missing' });
    await expect(registry.run(instruct, { optionId: 'leave', text: 'forged' })).resolves.toEqual({ ok: false, status: 'missing' });
    await expect(registry.run(instruct, { optionId: 'instruct', text: 'x'.repeat(64 * 1024 + 1) })).resolves.toEqual({ ok: false, status: 'missing' });
    await expect(registry.run(instruct, { optionId: 'instruct', text: 'Check the changes' })).resolves.toEqual({ ok: true, status: 'done' });
    expect(handler).toHaveBeenCalledWith({ ref: 'private-ref', input: { optionId: 'instruct', text: 'Check the changes' } });
  });

  it('keeps an operator-unavailable failure terminal (failed, not pending)', async () => {
    const registry = createInboxActionRegistry(open());
    registry.register('test', vi.fn().mockRejectedValue(new InboxActionOperatorError('gone', true)));
    registry.bind(entry(), { kind: 'test', ref: 'private-ref' });
    await expect(registry.run(entry(), { optionId: 'A' })).resolves.toEqual({ ok: false, status: 'failed' });
    expect(registry.list([entry()])).toEqual([{ entryId: 'entry-1', kind: 'test', status: 'failed', unavailable: true, message: 'gone' }]);
    await expect(registry.run(entry(), { optionId: 'A' })).resolves.toEqual({ ok: false, status: 'missing' });
  });

  it('does not overwrite markUnavailable that lands while a handler is running (success)', async () => {
    const registry = createInboxActionRegistry(open());
    let finish!: () => void;
    registry.register('test', () => new Promise<void>((resolve) => { finish = resolve; }));
    registry.bind(entry(), { kind: 'test', ref: 'private-ref' });
    const running = registry.run(entry(), { optionId: 'A' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    registry.markUnavailable('test', 'private-ref', 'Superseded.');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    finish();
    await expect(running).resolves.toEqual({ ok: false, status: 'failed' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('handler succeeded but the action was marked unavailable'));
    warn.mockRestore();
    expect(registry.list([entry()])).toEqual([{ entryId: 'entry-1', kind: 'test', status: 'failed', unavailable: true, message: 'Superseded.' }]);
    await expect(registry.run(entry(), { optionId: 'A' })).resolves.toEqual({ ok: false, status: 'missing' });
  });

  it('does not overwrite markUnavailable that lands while a handler is running (failure)', async () => {
    const registry = createInboxActionRegistry(open());
    let fail!: (error: Error) => void;
    registry.register('test', () => new Promise<void>((_, reject) => { fail = reject; }));
    registry.bind(entry(), { kind: 'test', ref: 'private-ref' });
    const running = registry.run(entry(), { optionId: 'A' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    registry.markUnavailable('test', 'private-ref', 'Superseded.');
    fail(new Error('boom'));
    await expect(running).resolves.toEqual({ ok: false, status: 'failed' });
    expect(registry.list([entry()])).toEqual([{ entryId: 'entry-1', kind: 'test', status: 'failed', unavailable: true, message: 'Superseded.' }]);
  });

  it('tolerates the row being removed mid-handler and reports handler-unavailable', async () => {
    const registry = createInboxActionRegistry(open());
    let finish!: () => void;
    const off = registry.register('test', () => new Promise<void>((resolve) => { finish = resolve; }));
    registry.bind(entry(), { kind: 'test', ref: 'private-ref' });
    const running = registry.run(entry(), { optionId: 'A' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    registry.remove(['entry-1']);
    finish();
    await expect(running).resolves.toEqual({ ok: true, status: 'done' });
    expect(registry.list([entry()])).toEqual([]);
    off();
    expect(registry.bound('entry-1')).toBeNull();
  });

  it('reports handler unavailable when the kind is unregistered between list and run', async () => {
    const registry = createInboxActionRegistry(open());
    const off = registry.register('test', vi.fn());
    registry.bind(entry(), { kind: 'test', ref: 'private-ref' });
    off();
    await expect(registry.run(entry(), { optionId: 'A' })).resolves.toEqual({ ok: false, status: 'failed' });
    expect(registry.bound('entry-1')).toEqual({ kind: 'test', ref: 'private-ref' });
  });
});
