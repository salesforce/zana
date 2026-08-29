import { describe, it, expect, vi, beforeEach } from 'vitest';

// followup-manager.ts -> followup-store.ts -> electron. Mock import-time
// `app.getPath('home')`, and stub the store so the manager never touches disk.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/cc-test-home' }
}));

const saveFollowUp = vi.fn();
const deleteFollowUp = vi.fn();
const listAllFollowUps = vi.fn((_a?: unknown, _b?: unknown): unknown[] => []);
vi.mock('../followup-store.js', () => ({
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
  it('creates an open follow-up and persists it', () => {
    const m = makeManager();
    const f = m.create({ projectId: 'proj-1', title: 'Q?', scope: { projectId: 'proj-1' } });
    expect(f.status).toBe('open');
    expect(f.kind).toBe('question');
    expect(f.origin).toEqual({ source: 'user' });
    expect(saveFollowUp).toHaveBeenCalledOnce();
    expect(m.list()).toHaveLength(1);
  });

  it('requires a title', () => {
    const m = makeManager();
    expect(() => m.create({ projectId: 'proj-1', title: '  ' })).toThrow(/title/);
  });

  it('setStatus → resolved stamps resolvedAt + resolution; reopen clears them', () => {
    const m = makeManager();
    const f = m.create({ projectId: 'proj-1', title: 'Q?' });
    const resolved = m.setStatus(f.id, 'resolved', 'committed it');
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolvedAt).toBeTruthy();
    expect(resolved?.resolution).toBe('committed it');

    const reopened = m.setStatus(f.id, 'open');
    expect(reopened?.status).toBe('open');
    expect(reopened?.resolvedAt).toBeUndefined();
    expect(reopened?.resolution).toBeUndefined();
  });

  it('setStatus on an unknown id returns null', () => {
    const m = makeManager();
    expect(m.setStatus('nope', 'resolved')).toBeNull();
  });

  it('markSpawned stamps spawnedAt + bumps updatedAt and persists', () => {
    const m = makeManager();
    const f = m.create({ projectId: 'proj-1', title: 'Q?' });
    expect(f.spawnedAt).toBeUndefined();
    saveFollowUp.mockClear();
    const marked = m.markSpawned(f.id);
    expect(marked?.spawnedAt).toBeTruthy();
    expect(marked?.updatedAt).toBe(marked?.spawnedAt);
    expect(saveFollowUp).toHaveBeenCalledOnce();
    // The map reflects the stamp so a reload keeps the lock.
    expect(m.list().find((x) => x.id === f.id)?.spawnedAt).toBe(marked?.spawnedAt);
  });

  it('markSpawned on an unknown id returns null', () => {
    const m = makeManager();
    expect(m.markSpawned('nope')).toBeNull();
  });

  it('update edits title/detail/kind and bumps updatedAt', () => {
    const m = makeManager();
    const f = m.create({ projectId: 'proj-1', title: 'Q?' });
    const next = m.update(f.id, { title: 'Q2?', detail: 'more', kind: 'decision' });
    expect(next.title).toBe('Q2?');
    expect(next.detail).toBe('more');
    expect(next.kind).toBe('decision');
  });

  it('remove deletes from the map and disk', () => {
    const m = makeManager();
    const f = m.create({ projectId: 'proj-1', title: 'Q?' });
    m.remove(f.id);
    expect(m.list()).toHaveLength(0);
    expect(deleteFollowUp).toHaveBeenCalledOnce();
  });

  it('onProjectRemoved drops that project\'s follow-ups from memory', () => {
    const m = makeManager();
    m.create({ projectId: 'proj-1', title: 'A' });
    m.create({ projectId: 'proj-2', title: 'B' });
    m.onProjectRemoved('proj-1');
    expect(m.list().map((f) => f.projectId)).toEqual(['proj-2']);
  });
});

describe('FollowUpManager — dedupe/coalescing on create()', () => {
  it('coalesces two near-identical agent follow-ups from the same session into one', () => {
    const m = makeManager();
    const first = m.create({
      projectId: 'proj-1',
      title: 'Should I commit these changes?',
      origin: { source: 'agent', sessionId: 's-9' },
      scope: { projectId: 'proj-1' }
    });
    const second = m.create({
      projectId: 'proj-1',
      title: '  should i commit these changes  ', // trailing/case/ws differences
      origin: { source: 'agent', sessionId: 's-9' },
      scope: { projectId: 'proj-1' }
    });
    expect(second.id).toBe(first.id);
    expect(second.occurrences).toBe(2);
    expect(m.list()).toHaveLength(1);
  });

  it('keeps genuinely different agent questions as separate records', () => {
    const m = makeManager();
    m.create({
      projectId: 'proj-1',
      title: 'Commit now?',
      origin: { source: 'agent', sessionId: 's-9' },
      scope: { projectId: 'proj-1' }
    });
    m.create({
      projectId: 'proj-1',
      title: 'Which of two auth approaches?',
      origin: { source: 'agent', sessionId: 's-9' },
      scope: { projectId: 'proj-1' }
    });
    expect(m.list()).toHaveLength(2);
  });

  it('does not coalesce the same title across different sessions', () => {
    const m = makeManager();
    m.create({
      projectId: 'proj-1',
      title: 'Commit now?',
      origin: { source: 'agent', sessionId: 's-a' },
      scope: { projectId: 'proj-1' }
    });
    m.create({
      projectId: 'proj-1',
      title: 'Commit now?',
      origin: { source: 'agent', sessionId: 's-b' },
      scope: { projectId: 'proj-1' }
    });
    expect(m.list()).toHaveLength(2);
  });

  it('never collapses user-created follow-ups (no dedupeKey)', () => {
    const m = makeManager();
    const a = m.create({ projectId: 'proj-1', title: 'Same note', scope: { projectId: 'proj-1' } });
    const b = m.create({ projectId: 'proj-1', title: 'Same note', scope: { projectId: 'proj-1' } });
    expect(b.id).not.toBe(a.id);
    expect(a.dedupeKey).toBeUndefined();
    expect(m.list()).toHaveLength(2);
  });

  it('fills detail on coalesce only when the existing record has none', () => {
    const m = makeManager();
    const first = m.create({
      projectId: 'proj-1',
      title: 'Commit?',
      origin: { source: 'agent', sessionId: 's-9' },
      scope: { projectId: 'proj-1' }
    });
    expect(first.detail).toBeUndefined();
    const filled = m.create({
      projectId: 'proj-1',
      title: 'Commit?',
      detail: 'model-supplied body',
      origin: { source: 'agent', sessionId: 's-9' },
      scope: { projectId: 'proj-1' }
    });
    expect(filled.detail).toBe('model-supplied body');
    // A later re-file must NOT clobber the now-present detail.
    const again = m.create({
      projectId: 'proj-1',
      title: 'Commit?',
      detail: 'different body',
      origin: { source: 'agent', sessionId: 's-9' },
      scope: { projectId: 'proj-1' }
    });
    expect(again.detail).toBe('model-supplied body');
    expect(again.occurrences).toBe(3);
  });

  it('does not coalesce onto a resolved record — a re-file opens a fresh one', () => {
    const m = makeManager();
    const first = m.create({
      projectId: 'proj-1',
      title: 'Commit?',
      origin: { source: 'agent', sessionId: 's-9' },
      scope: { projectId: 'proj-1' }
    });
    m.setStatus(first.id, 'resolved');
    const reopened = m.create({
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

  it('stamps host-resolved resume coords onto an agent origin', () => {
    const m = makeManager({ resume: RESUME });
    const f = m.create({
      projectId: 'proj-1',
      title: 'Commit?',
      origin: { source: 'agent', sessionId: 's-9' },
      scope: { projectId: 'proj-1' }
    });
    expect(f.origin).toEqual({ source: 'agent', sessionId: 's-9', resume: RESUME });
  });

  it('stamps resume coords onto an idle-triage follow-up too', () => {
    const m = makeManager({ resume: RESUME });
    const f = m.createFromIdle(idle());
    expect(f!.origin).toMatchObject({ source: 'idle-triage', resume: RESUME });
  });

  it('leaves a user origin untouched (no session to resume)', () => {
    const m = makeManager({ resume: RESUME });
    const f = m.create({ projectId: 'proj-1', title: 'Note', scope: { projectId: 'proj-1' } });
    expect(f.origin).toEqual({ source: 'user' });
  });

  it('omits resume when the dep returns null (session gone / not resumable)', () => {
    const m = makeManager({ resume: null });
    const f = m.create({
      projectId: 'proj-1',
      title: 'Commit?',
      origin: { source: 'agent', sessionId: 's-9' },
      scope: { projectId: 'proj-1' }
    });
    expect(f.origin).toEqual({ source: 'agent', sessionId: 's-9' });
  });

  it('coalesce keeps the earlier resume coords when a later re-file has none', () => {
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
    const first = m.create({
      projectId: 'proj-1',
      title: 'Commit?',
      origin: { source: 'agent', sessionId: 's-9' },
      scope: { projectId: 'proj-1' }
    });
    expect(first.origin).toMatchObject({ resume: RESUME });
    live = false; // the agent's tab has since died
    const again = m.create({
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
  it('creates an open question from an awaiting-reply verdict (acceptance scenario)', () => {
    const m = makeManager();
    const f = m.createFromIdle(idle());
    expect(f).not.toBeNull();
    expect(f!.status).toBe('open');
    expect(f!.kind).toBe('question');
    expect(f!.title).toBe('Should I commit these changes?');
    expect(f!.origin).toEqual({ source: 'idle-triage', sessionId: 's-1', confidence: 0.8 });
    expect(f!.sessionId).toBe('s-1');
    expect(m.list()).toHaveLength(1);
  });

  it('ignores non-awaiting-reply verdicts', () => {
    const m = makeManager();
    expect(m.createFromIdle(idle({ resolution: 'done' }))).toBeNull();
    expect(m.createFromIdle(idle({ resolution: 'paused' }))).toBeNull();
    expect(m.list()).toHaveLength(0);
  });

  it('is gated off by the followupsFromIdle flag', () => {
    const m = makeManager({ followupsFromIdle: false });
    expect(m.createFromIdle(idle())).toBeNull();
    expect(m.list()).toHaveLength(0);
  });

  it('never fires for background (scheduled/headless) sessions', () => {
    const scheduled = makeManager({ session: { scheduled: true } });
    expect(scheduled.createFromIdle(idle())).toBeNull();
    const headless = makeManager({ session: { headless: true } });
    expect(headless.createFromIdle(idle())).toBeNull();
  });

  it('skips when the session is unknown or has no project', () => {
    const noSession = makeManager({ session: null });
    expect(noSession.createFromIdle(idle())).toBeNull();
    const noProject = makeManager({ projectForSession: undefined });
    expect(noProject.createFromIdle(idle())).toBeNull();
  });

  it('dedups: a re-triaged session refreshes ONE open follow-up in place', () => {
    const m = makeManager();
    const first = m.createFromIdle(idle({ summary: 'Commit?' }));
    const second = m.createFromIdle(idle({ summary: 'Commit now?', confidence: 0.9 }));
    expect(m.list()).toHaveLength(1);
    expect(second!.id).toBe(first!.id);
    expect(second!.title).toBe('Commit now?');
    expect(second!.origin).toEqual({ source: 'idle-triage', sessionId: 's-1', confidence: 0.9 });
  });

  it('files a fresh follow-up once the prior one is resolved', () => {
    const m = makeManager();
    const first = m.createFromIdle(idle());
    m.setStatus(first!.id, 'resolved');
    const second = m.createFromIdle(idle());
    expect(second!.id).not.toBe(first!.id);
    expect(m.list().filter((f) => f.status === 'open')).toHaveLength(1);
  });

  it('falls back to a default title when the summary is empty', () => {
    const m = makeManager();
    const f = m.createFromIdle(idle({ summary: '' }));
    expect(f!.title).toBe('Agent is waiting on you');
  });

  it('carries the triage detail into the follow-up body', () => {
    const m = makeManager();
    const f = m.createFromIdle(idle({ detail: 'Finished 3-part feature; tests pass. Commit or iterate?' }));
    expect(f!.detail).toBe('Finished 3-part feature; tests pass. Commit or iterate?');
  });

  it('carries offered options into the follow-up so the picker lights up', () => {
    const m = makeManager();
    const f = m.createFromIdle(idle({ options: ['Commit now', 'Keep iterating'] }));
    expect(f!.options).toEqual(['Commit now', 'Keep iterating']);
  });

  it('leaves options undefined when the verdict offered none', () => {
    const m = makeManager();
    const f = m.createFromIdle(idle({ options: undefined }));
    expect(f!.options).toBeUndefined();
  });

  it('fills options on re-triage when the record had none, but never clobbers existing ones', () => {
    const m = makeManager();
    const first = m.createFromIdle(idle({ options: undefined }));
    expect(first!.options).toBeUndefined();
    const second = m.createFromIdle(idle({ options: ['Yes', 'No'] }));
    expect(second!.id).toBe(first!.id);
    expect(second!.options).toEqual(['Yes', 'No']);
    // A later re-triage with different options must NOT overwrite the original form.
    const third = m.createFromIdle(idle({ options: ['Maybe'] }));
    expect(third!.id).toBe(first!.id);
    expect(third!.options).toEqual(['Yes', 'No']);
  });

  it('preserves a human-edited detail across a re-triage', () => {
    const m = makeManager();
    const first = m.createFromIdle(idle({ detail: 'original body' }));
    m.update(first!.id, { detail: 'human notes' });
    const second = m.createFromIdle(idle({ detail: 'new model body' }));
    expect(second!.id).toBe(first!.id);
    expect(second!.detail).toBe('human notes');
  });

  it('fills detail on re-triage when the record had none', () => {
    const m = makeManager();
    const first = m.createFromIdle(idle({ detail: undefined }));
    expect(first!.detail).toBeUndefined();
    const second = m.createFromIdle(idle({ detail: 'now we have a body' }));
    expect(second!.id).toBe(first!.id);
    expect(second!.detail).toBe('now we have a body');
  });
});
