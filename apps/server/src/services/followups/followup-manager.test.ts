import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const fs = vi.hoisted(() => ({ watch: vi.fn(), existsSync: vi.fn(() => true), mkdirSync: vi.fn() }));
vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>(), ...fs }));
afterEach(() => vi.useRealTimers());

// followup-manager.ts -> followup-store.ts -> electron. Mock import-time
// `app.getPath('home')`, and stub the store so the manager never touches disk.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/cc-test-home' }
}));

const saveFollowUp = vi.fn();
const deleteFollowUp = vi.fn();
const listAllFollowUps = vi.fn((_a?: unknown, _b?: unknown): unknown[] => []);
vi.mock('./followup-store.js', () => ({
  saveFollowUp: (a: unknown, b: unknown) => saveFollowUp(a, b),
  deleteFollowUp: (a: unknown, b: unknown) => deleteFollowUp(a, b),
  listAllFollowUps: (a: unknown, b: unknown) => listAllFollowUps(a, b),
  globalDir: () => '/tmp/cc-test-home/.zcc/followups',
  projectDir: (p: { path: string }) => `${p.path}/.zcc/followups`
}));

import { FollowUpManager } from './followup-manager.js';
import type { IdleTriageResult, Project } from '@zana-ai/zcc-domain/product';
import type { store as Store } from '../projects/store.js';

const project: Project = {
  id: 'proj-1',
  name: 'P',
  path: '/tmp/proj',
  createdAt: 0,
  lastActiveAt: 0
};

function makeManager(opts?: {
  persistence?: import('../projects/project-record-store.js').MetadataPersistence<import('@zana-ai/zcc-domain/product').FollowUp>;
  followupsFromIdle?: boolean;
  session?: { scheduled?: boolean; headless?: boolean } | null;
  projectForSession?: string | undefined;
  /** When set, resolveResume returns these coords for ANY session id (null ⇒ dep returns null). */
  resume?: import('@zana-ai/zcc-domain/product').FollowUpResume | null;
}) {
  const fakeStore = {
    listProjects: () => [project]
  } as unknown as typeof Store;
  const manager = new FollowUpManager();
  manager.setDeps({
    store: fakeStore,
    persistence: opts?.persistence,
    getSession: () =>
      'session' in (opts ?? {}) ? opts!.session! : { scheduled: false, headless: false },
    resolveProjectForSession: () =>
      'projectForSession' in (opts ?? {}) ? opts!.projectForSession : 'proj-1',
    resolveResume: 'resume' in (opts ?? {}) ? () => opts!.resume! : undefined,
    followupsFromIdle: () => opts?.followupsFromIdle ?? true
  });
  return manager;
}

const idle = (over?: Partial<IdleTriageResult>): IdleTriageResult => ({
  sessionId: 's-1',
  resolution: 'awaiting-reply',
  summary: 'Should I commit these changes?',
  confidence: 0.8,
  at: 1767225600000,
  ...over
});

beforeEach(() => {
  saveFollowUp.mockClear();
  deleteFollowUp.mockClear();
  listAllFollowUps.mockClear();
});

describe('FollowUpManager — CRUD + lifecycle', () => {
  it('creates an open follow-up and persists it', async () => {
    const m = makeManager();
    const f = await m.create({ projectId: 'proj-1', title: 'Q?', scope: { projectId: 'proj-1' } });
    expect(f.status).toBe('open');
    expect(f.kind).toBe('question');
    expect(f.origin).toEqual({ source: 'user' });
    expect(saveFollowUp).toHaveBeenCalledOnce();
    expect(m.list()).toHaveLength(1);
  });

  it('requires a title', async () => {
    const m = makeManager();
    await expect(m.create({ projectId: 'proj-1', title: '  ' })).rejects.toThrow(/title/);
  });

  it('setStatus → resolved stamps resolvedAt + resolution; reopen clears them', async () => {
    const m = makeManager();
    const f = await m.create({ projectId: 'proj-1', title: 'Q?' });
    const resolved = await m.setStatus(f.id, 'resolved', 'committed it');
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolvedAt).toBeTruthy();
    expect(resolved?.resolution).toBe('committed it');

    const reopened = await m.setStatus(f.id, 'open');
    expect(reopened?.status).toBe('open');
    expect(reopened?.resolvedAt).toBeUndefined();
    expect(reopened?.resolution).toBeUndefined();
  });

  it('setStatus on an unknown id returns null', async () => {
    const m = makeManager();
    expect(await m.setStatus('nope', 'resolved')).toBeNull();
  });

  it('markSpawned stamps spawnedAt + bumps updatedAt and persists', async () => {
    const m = makeManager();
    const f = await m.create({ projectId: 'proj-1', title: 'Q?' });
    expect(f.spawnedAt).toBeUndefined();
    saveFollowUp.mockClear();
    const marked = await m.markSpawned(f.id);
    expect(marked?.spawnedAt).toBeTruthy();
    expect(marked?.updatedAt).toBe(marked?.spawnedAt);
    expect(saveFollowUp).toHaveBeenCalledOnce();
    // The map reflects the stamp so a reload keeps the lock.
    expect(m.list().find((x) => x.id === f.id)?.spawnedAt).toBe(marked?.spawnedAt);
  });

  it('markSpawned on an unknown id returns null', async () => {
    const m = makeManager();
    expect(await m.markSpawned('nope')).toBeNull();
  });

  it('update edits title/detail/kind and bumps updatedAt', async () => {
    const m = makeManager();
    const f = await m.create({ projectId: 'proj-1', title: 'Q?' });
    const next = await m.update(f.id, { title: 'Q2?', detail: 'more', kind: 'decision' });
    expect(next.title).toBe('Q2?');
    expect(next.detail).toBe('more');
    expect(next.kind).toBe('decision');
  });

  it('remove deletes from the map and disk', async () => {
    const m = makeManager();
    const f = await m.create({ projectId: 'proj-1', title: 'Q?' });
    await m.remove(f.id);
    expect(m.list()).toHaveLength(0);
    expect(deleteFollowUp).toHaveBeenCalledOnce();
  });

  it('onProjectRemoved drops that project\'s follow-ups from memory', async () => {
    const m = makeManager();
    await m.create({ projectId: 'proj-1', title: 'A' });
    await m.create({ projectId: 'proj-2', title: 'B' });
    await m.onProjectRemoved('proj-1');
    expect(m.list().map((f) => f.projectId)).toEqual(['proj-2']);
  });
});

describe('FollowUpManager — dedupe/coalescing on create()', () => {
  it('coalesces two near-identical agent follow-ups from the same session into one', async () => {
    const m = makeManager();
    const first = await m.create({
      projectId: 'proj-1',
      title: 'Should I commit these changes?',
      origin: { source: 'agent', sessionId: 's-9' },
      scope: { projectId: 'proj-1' }
    });
    const second = await m.create({
      projectId: 'proj-1',
      title: '  should i commit these changes  ', // trailing/case/ws differences
      origin: { source: 'agent', sessionId: 's-9' },
      scope: { projectId: 'proj-1' }
    });
    expect(second.id).toBe(first.id);
    expect(second.occurrences).toBe(2);
    expect(m.list()).toHaveLength(1);
  });

  it('keeps genuinely different agent questions as separate records', async () => {
    const m = makeManager();
    await m.create({
      projectId: 'proj-1',
      title: 'Commit now?',
      origin: { source: 'agent', sessionId: 's-9' },
      scope: { projectId: 'proj-1' }
    });
    await m.create({
      projectId: 'proj-1',
      title: 'Which of two auth approaches?',
      origin: { source: 'agent', sessionId: 's-9' },
      scope: { projectId: 'proj-1' }
    });
    expect(m.list()).toHaveLength(2);
  });

  it('does not coalesce the same title across different sessions', async () => {
    const m = makeManager();
    await m.create({
      projectId: 'proj-1',
      title: 'Commit now?',
      origin: { source: 'agent', sessionId: 's-a' },
      scope: { projectId: 'proj-1' }
    });
    await m.create({
      projectId: 'proj-1',
      title: 'Commit now?',
      origin: { source: 'agent', sessionId: 's-b' },
      scope: { projectId: 'proj-1' }
    });
    expect(m.list()).toHaveLength(2);
  });

  it('never collapses user-created follow-ups (no dedupeKey)', async () => {
    const m = makeManager();
    const a = await m.create({ projectId: 'proj-1', title: 'Same note', scope: { projectId: 'proj-1' } });
    const b = await m.create({ projectId: 'proj-1', title: 'Same note', scope: { projectId: 'proj-1' } });
    expect(b.id).not.toBe(a.id);
    expect(a.dedupeKey).toBeUndefined();
    expect(m.list()).toHaveLength(2);
  });

  it('fills detail on coalesce only when the existing record has none', async () => {
    const m = makeManager();
    const first = await m.create({
      projectId: 'proj-1',
      title: 'Commit?',
      origin: { source: 'agent', sessionId: 's-9' },
      scope: { projectId: 'proj-1' }
    });
    expect(first.detail).toBeUndefined();
    const filled = await m.create({
      projectId: 'proj-1',
      title: 'Commit?',
      detail: 'model-supplied body',
      origin: { source: 'agent', sessionId: 's-9' },
      scope: { projectId: 'proj-1' }
    });
    expect(filled.detail).toBe('model-supplied body');
    // A later re-file must NOT clobber the now-present detail.
    const again = await m.create({
      projectId: 'proj-1',
      title: 'Commit?',
      detail: 'different body',
      origin: { source: 'agent', sessionId: 's-9' },
      scope: { projectId: 'proj-1' }
    });
    expect(again.detail).toBe('model-supplied body');
    expect(again.occurrences).toBe(3);
  });

  it('does not coalesce onto a resolved record — a re-file opens a fresh one', async () => {
    const m = makeManager();
    const first = await m.create({
      projectId: 'proj-1',
      title: 'Commit?',
      origin: { source: 'agent', sessionId: 's-9' },
      scope: { projectId: 'proj-1' }
    });
    await m.setStatus(first.id, 'resolved');
    const reopened = await m.create({
      projectId: 'proj-1',
      title: 'Commit?',
      origin: { source: 'agent', sessionId: 's-9' },
      scope: { projectId: 'proj-1' }
    });
    expect(reopened.id).not.toBe(first.id);
    expect(reopened.status).toBe('open');
  });
});

describe('FollowUpManager — resume-coord stamping (answer loop)', () => {
  const RESUME = {
    claudeSessionId: 'claude-123',
    profile: 'claude' as const,
    personaId: 'p-reviewer',
    cwd: '/tmp/proj'
  };

  it('stamps host-resolved resume coords onto an agent origin', async () => {
    const m = makeManager({ resume: RESUME });
    const f = await m.create({
      projectId: 'proj-1',
      title: 'Commit?',
      origin: { source: 'agent', sessionId: 's-9' },
      scope: { projectId: 'proj-1' }
    });
    expect(f.origin).toEqual({ source: 'agent', sessionId: 's-9', resume: RESUME });
  });

  it('stamps resume coords onto an idle-triage follow-up too', async () => {
    const m = makeManager({ resume: RESUME });
    const f = await m.createFromIdle(idle());
    expect(f!.origin).toMatchObject({ source: 'idle-triage', resume: RESUME });
  });

  it('leaves a user origin untouched (no session to resume)', async () => {
    const m = makeManager({ resume: RESUME });
    const f = await m.create({ projectId: 'proj-1', title: 'Note', scope: { projectId: 'proj-1' } });
    expect(f.origin).toEqual({ source: 'user' });
  });

  it('omits resume when the dep returns null (session gone / not resumable)', async () => {
    const m = makeManager({ resume: null });
    const f = await m.create({
      projectId: 'proj-1',
      title: 'Commit?',
      origin: { source: 'agent', sessionId: 's-9' },
      scope: { projectId: 'proj-1' }
    });
    expect(f.origin).toEqual({ source: 'agent', sessionId: 's-9' });
  });

  it('coalesce keeps the earlier resume coords when a later re-file has none', async () => {
    // First file resolves coords; a later re-file (session now dead → null) must
    // NOT erase the reopen target.
    const fakeStore = { listProjects: () => [project] } as unknown as typeof Store;
    const m = new FollowUpManager();
    let live = true;
    m.setDeps({
      store: fakeStore,
      getSession: () => ({ scheduled: false, headless: false }),
      resolveProjectForSession: () => 'proj-1',
      resolveResume: () => (live ? RESUME : null),
      followupsFromIdle: () => true
    });
    const first = await m.create({
      projectId: 'proj-1',
      title: 'Commit?',
      origin: { source: 'agent', sessionId: 's-9' },
      scope: { projectId: 'proj-1' }
    });
    expect(first.origin).toMatchObject({ resume: RESUME });
    live = false; // the agent's tab has since died
    const again = await m.create({
      projectId: 'proj-1',
      title: 'Commit?',
      origin: { source: 'agent', sessionId: 's-9' },
      scope: { projectId: 'proj-1' }
    });
    expect(again.id).toBe(first.id);
    expect(again.origin).toMatchObject({ resume: RESUME });
  });
});

describe('FollowUpManager — createFromIdle bridge', () => {
  it('creates an open question from an awaiting-reply verdict (acceptance scenario)', async () => {
    const m = makeManager();
    const f = await m.createFromIdle(idle());
    expect(f).not.toBeNull();
    expect(f!.status).toBe('open');
    expect(f!.kind).toBe('question');
    expect(f!.title).toBe('Should I commit these changes?');
    expect(f!.origin).toEqual({ source: 'idle-triage', sessionId: 's-1', confidence: 0.8 });
    expect(f!.sessionId).toBe('s-1');
    expect(m.list()).toHaveLength(1);
  });

  it('ignores non-awaiting-reply verdicts', async () => {
    const m = makeManager();
    expect(await m.createFromIdle(idle({ resolution: 'done' }))).toBeNull();
    expect(await m.createFromIdle(idle({ resolution: 'paused' }))).toBeNull();
    expect(m.list()).toHaveLength(0);
  });

  it('is gated off by the followupsFromIdle flag', async () => {
    const m = makeManager({ followupsFromIdle: false });
    expect(await m.createFromIdle(idle())).toBeNull();
    expect(m.list()).toHaveLength(0);
  });

  it('never fires for background (scheduled/headless) sessions', async () => {
    const scheduled = makeManager({ session: { scheduled: true } });
    expect(await scheduled.createFromIdle(idle())).toBeNull();
    const headless = makeManager({ session: { headless: true } });
    expect(await headless.createFromIdle(idle())).toBeNull();
  });

  it('skips when the session is unknown or has no project', async () => {
    const noSession = makeManager({ session: null });
    expect(await noSession.createFromIdle(idle())).toBeNull();
    const noProject = makeManager({ projectForSession: undefined });
    expect(await noProject.createFromIdle(idle())).toBeNull();
  });

  it('dedups: a re-triaged session refreshes ONE open follow-up in place', async () => {
    const m = makeManager();
    const first = await m.createFromIdle(idle({ summary: 'Commit?' }));
    const second = await m.createFromIdle(idle({ summary: 'Commit now?', confidence: 0.9 }));
    expect(m.list()).toHaveLength(1);
    expect(second!.id).toBe(first!.id);
    expect(second!.title).toBe('Commit now?');
    expect(second!.origin).toEqual({ source: 'idle-triage', sessionId: 's-1', confidence: 0.9 });
  });

  it('files a fresh follow-up once the prior one is resolved', async () => {
    const m = makeManager();
    const first = await m.createFromIdle(idle());
    await m.setStatus(first!.id, 'resolved');
    const second = await m.createFromIdle(idle());
    expect(second!.id).not.toBe(first!.id);
    expect(m.list().filter((f) => f.status === 'open')).toHaveLength(1);
  });

  it('falls back to a default title when the summary is empty', async () => {
    const m = makeManager();
    const f = await m.createFromIdle(idle({ summary: '' }));
    expect(f!.title).toBe('Agent is waiting on you');
  });

  it('carries the triage detail into the follow-up body', async () => {
    const m = makeManager();
    const f = await m.createFromIdle(idle({ detail: 'Finished 3-part feature; tests pass. Commit or iterate?' }));
    expect(f!.detail).toBe('Finished 3-part feature; tests pass. Commit or iterate?');
  });

  it('carries offered options into the follow-up so the picker lights up', async () => {
    const m = makeManager();
    const f = await m.createFromIdle(idle({ options: ['Commit now', 'Keep iterating'] }));
    expect(f!.options).toEqual(['Commit now', 'Keep iterating']);
  });

  it('leaves options undefined when the verdict offered none', async () => {
    const m = makeManager();
    const f = await m.createFromIdle(idle({ options: undefined }));
    expect(f!.options).toBeUndefined();
  });

  it('fills options on re-triage when the record had none, but never clobbers existing ones', async () => {
    const m = makeManager();
    const first = await m.createFromIdle(idle({ options: undefined }));
    expect(first!.options).toBeUndefined();
    const second = await m.createFromIdle(idle({ options: ['Yes', 'No'] }));
    expect(second!.id).toBe(first!.id);
    expect(second!.options).toEqual(['Yes', 'No']);
    // A later re-triage with different options must NOT overwrite the original form.
    const third = await m.createFromIdle(idle({ options: ['Maybe'] }));
    expect(third!.id).toBe(first!.id);
    expect(third!.options).toEqual(['Yes', 'No']);
  });

  it('preserves a human-edited detail across a re-triage', async () => {
    const m = makeManager();
    const first = await m.createFromIdle(idle({ detail: 'original body' }));
    await m.update(first!.id, { detail: 'human notes' });
    const second = await m.createFromIdle(idle({ detail: 'new model body' }));
    expect(second!.id).toBe(first!.id);
    expect(second!.detail).toBe('human notes');
  });

  it('fills detail on re-triage when the record had none', async () => {
    const m = makeManager();
    const first = await m.createFromIdle(idle({ detail: undefined }));
    expect(first!.detail).toBeUndefined();
    const second = await m.createFromIdle(idle({ detail: 'now we have a body' }));
    expect(second!.id).toBe(first!.id);
    expect(second!.detail).toBe('now we have a body');
  });
});


describe('asynchronous metadata commits', () => {
  const persistence = () => ({ load: vi.fn(async () => []), save: vi.fn(async () => {}), remove: vi.fn(async () => {}), localProjects: () => [project] });
  it('serializes duplicate agent filings and publishes only durable state', async () => {
    const disk = persistence(); let commit!: () => void;
    disk.save.mockImplementationOnce(() => new Promise<void>(resolve => { commit = resolve; }));
    const m = makeManager({ persistence: disk }); const changed = vi.fn(); m.on('changed', changed);
    const input = { projectId: project.id, title: 'Question?', origin: { source: 'agent' as const, sessionId: 's' } };
    const first = m.create(input); const second = m.create(input);
    await Promise.resolve(); expect(m.list()).toEqual([]); expect(changed).not.toHaveBeenCalled();
    commit(); const [a, b] = await Promise.all([first, second]);
    expect(a.id).toBe(b.id); expect(b.occurrences).toBe(2); expect(m.list()).toHaveLength(1);
    expect(disk.save).toHaveBeenCalledTimes(2);
  });
  it('does not publish failed creates, edits, deletes or reloads and resumes after failure', async () => {
    const disk = persistence(); const m = makeManager({ persistence: disk });
    disk.save.mockRejectedValueOnce(new Error('offline'));
    await expect(m.create({ projectId: project.id, title: 'Q' })).rejects.toThrow('offline'); expect(m.list()).toEqual([]);
    const f = await m.create({ projectId: project.id, title: 'Q' });
    disk.save.mockRejectedValueOnce(new Error('conflict'));
    await expect(m.update(f.id, { title: 'Other' })).rejects.toThrow('conflict'); expect(m.list()[0].title).toBe('Q');
    disk.remove.mockRejectedValueOnce(new Error('offline'));
    await expect(m.remove(f.id)).rejects.toThrow('offline'); expect(m.list()).toHaveLength(1);
    disk.load.mockRejectedValueOnce(new Error('unreadable'));
    await expect(m.loadAll([project])).rejects.toThrow('unreadable'); expect(m.list()).toHaveLength(1);
    await m.remove(f.id); expect(m.list()).toEqual([]);
  });
  it('bounds a stalled mutation queue and drains it after recovery', async () => {
    const disk = persistence(); let commit!: () => void;
    disk.save.mockImplementationOnce(() => new Promise<void>(resolve => { commit = resolve; }));
    const m = makeManager({ persistence: disk });
    const pending = Array.from({ length: 100 }, () => m.create({ projectId: project.id, title: 'Q' }));
    await expect(m.create({ projectId: project.id, title: 'Overflow' })).rejects.toThrow('Too many pending');
    commit(); await Promise.all(pending); expect(m.list()).toHaveLength(100);
  });
});


describe('metadata watcher lifetime', () => {
  it('subscribes only local paths, polls foreign owners once, and disposes resources', async () => {
    vi.useFakeTimers();
    const watchers: { close: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }[] = [];
    const callbacks: (() => void)[] = [];
    fs.existsSync.mockReturnValue(true);
    fs.watch.mockImplementation((_dir, _options, callback) => {
      callbacks.push(callback); const watcher = { close: vi.fn(), on: vi.fn() }; watchers.push(watcher); return watcher;
    });
    const disk = { load: vi.fn(async () => []), save: vi.fn(async () => {}), remove: vi.fn(async () => {}), localProjects: () => [project] };
    const m = makeManager({ persistence: disk }); m.startWatching(); m.startWatching();
    expect(watchers[0].close).toHaveBeenCalledOnce(); expect(watchers[1].close).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(15_000); expect(disk.load).toHaveBeenCalledTimes(1);
    callbacks.at(-1)!(); callbacks.at(-1)!(); await vi.advanceTimersByTimeAsync(250); expect(disk.load).toHaveBeenCalledTimes(2);
    const error = watchers.at(-1)!.on.mock.calls[0][1];
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    error(new Error('watch closed')); expect(watchers.at(-1)!.close).toHaveBeenCalledOnce();
    m.stopWatching(); await vi.advanceTimersByTimeAsync(30_000); expect(disk.load).toHaveBeenCalledTimes(2); log.mockRestore();
  });
  it('creates the global watch dir, skips absent project dirs, and tolerates watcher failures', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    fs.existsSync.mockReturnValue(false); fs.watch.mockImplementation(() => { throw new Error('cannot watch'); });
    const m = makeManager(); m.startWatching(); expect(fs.mkdirSync).toHaveBeenCalled(); m.stopWatching(); log.mockRestore();
  });
});

describe('poll reloads emit only on content change', () => {
  const store = () => {
    const records = new Map<string, import('@zana-ai/zcc-domain/product').FollowUp>();
    const persistence = {
      load: vi.fn(async () => structuredClone([...records.values()])),
      save: vi.fn(async (f: import('@zana-ai/zcc-domain/product').FollowUp) => { records.set(f.id, structuredClone(f)); }),
      remove: vi.fn(async (f: import('@zana-ai/zcc-domain/product').FollowUp) => { records.delete(f.id); }),
      localProjects: () => [project]
    };
    return { records, persistence };
  };
  it('emits once for two polls over unchanged persistence', async () => {
    const m = makeManager({ persistence: store().persistence }); const changed = vi.fn(); m.on('changed', changed);
    await m.loadAll([project]); await m.loadAll([project]);
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it('emits when a record changes externally', async () => {
    const { records, persistence } = store(); const m = makeManager({ persistence });
    const f = await m.create({ projectId: project.id, title: 'Q' });
    const changed = vi.fn(); m.on('changed', changed);
    await m.loadAll([project]); expect(changed).not.toHaveBeenCalled();
    records.set(f.id, { ...records.get(f.id)!, title: 'Other' });
    await m.loadAll([project]);
    expect(changed).toHaveBeenCalledTimes(1); expect(m.list()[0].title).toBe('Other');
  });
  it('does not re-emit after a mutation when the poll sees identical content', async () => {
    const m = makeManager({ persistence: store().persistence }); const changed = vi.fn(); m.on('changed', changed);
    await m.create({ projectId: project.id, title: 'Q' });
    const afterCreate = changed.mock.calls.length; expect(afterCreate).toBeGreaterThan(0);
    await m.loadAll([project]);
    expect(changed).toHaveBeenCalledTimes(afterCreate);
  });
});

it('passes other events through without touching the change fingerprint', async () => {
  const m = makeManager({ persistence: { load: async () => [], save: async () => {}, remove: async () => {}, localProjects: () => [project] } as never });
  const other = vi.fn(); const changed = vi.fn(); m.on('other', other); m.on('changed', changed);
  expect(m.emit('other', 1)).toBe(true); expect(other).toHaveBeenCalledWith(1);
  await m.loadAll([project]); expect(changed).toHaveBeenCalledTimes(1);
});
