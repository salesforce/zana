import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendConversationThreadEvent,
  createConversationThread,
  createEnvironment,
  listThreadPlanRevisions,
  openDatabase,
  updateThreadPlanTask,
  upsertHost,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import {
  ensureDraftThreadPlan,
  getDurableThreadPlanView,
  importProviderPlanSteps,
  markOwningThreadPlanTasksInterrupted,
  recordThreadExecutionMode,
  snapshotApprovedPlan,
  syncPlanFromLatestEvents
} from './conversation-plan.js';

let db: ZccDatabase | null = null;
let dir: string | null = null;

afterEach(() => {
  db?.close();
  db = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function setup() {
  dir = mkdtempSync(join(tmpdir(), 'zcc-plan-'));
  db = openDatabase(join(dir, 'zcc.sqlite'));
  const host = upsertHost(db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
  const environment = createEnvironment(db, {
    projectId: 'proj-1',
    hostId: host.id,
    path: dir
  });
  const thread = createConversationThread(db, {
    projectId: 'proj-1',
    hostId: host.id,
    environmentId: environment.id,
    providerId: 'claude-code',
    status: 'active'
  });
  return { thread };
}

function completeItem(
  threadId: string,
  item: Record<string, unknown>,
  turnId = 'turn-1'
) {
  appendConversationThreadEvent(db!, {
    threadId,
    type: 'item/completed',
    payload: {
      type: 'item/completed',
      scope: { kind: 'turn', turnId },
      item
    }
  });
}

function planDir(): string {
  return join(dir!, '.zcc', 'plans');
}

describe('durable thread plan', () => {
  it('snapshots approved markdown as a new revision without replacing history', () => {
    const { thread } = setup();
    snapshotApprovedPlan(db!, { threadId: thread.id, markdown: 'v1', source: 'approval' });
    snapshotApprovedPlan(db!, { threadId: thread.id, markdown: 'v2', source: 'approval' });
    snapshotApprovedPlan(db!, { threadId: thread.id, markdown: 'v2', source: 'approval' });
    const plan = ensureDraftThreadPlan(db!, thread.id);
    const revisions = listThreadPlanRevisions(db!, plan.id);
    expect(revisions.map((row) => row.markdown)).toEqual(['v1', 'v2']);
  });

  it('does not overwrite user-edited task text or regress completed tasks', () => {
    const { thread } = setup();
    importProviderPlanSteps(db!, {
      threadId: thread.id,
      steps: [{ step: 'Write tests', status: 'pending' }]
    });
    const view = getDurableThreadPlanView(db!, thread.id)!;
    const taskId = view.tasks[0]!.id;
    updateThreadPlanTask(db!, taskId, { text: 'User wording', userEdited: true, status: 'completed' });
    importProviderPlanSteps(db!, {
      threadId: thread.id,
      steps: [{ step: 'Write tests', status: 'in_progress' }]
    });
    const next = getDurableThreadPlanView(db!, thread.id)!;
    expect(next.tasks[0]).toMatchObject({
      text: 'User wording',
      status: 'completed',
      userEdited: true
    });
  });

  it('marks in-progress owned tasks interrupted on stop', () => {
    const { thread } = setup();
    importProviderPlanSteps(db!, {
      threadId: thread.id,
      steps: [{ step: 'Implement', status: 'in_progress' }]
    });
    markOwningThreadPlanTasksInterrupted(db!, thread.id);
    const view = getDurableThreadPlanView(db!, thread.id)!;
    expect(view.tasks[0]).toMatchObject({
      status: 'blocked',
      blockedReason: 'interrupted'
    });
  });

  it('writes approved markdown into .zcc/plans', () => {
    const { thread } = setup();
    snapshotApprovedPlan(db!, { threadId: thread.id, markdown: '# Ship it\n\nDo the work.', source: 'approval' });
    const view = getDurableThreadPlanView(db!, thread.id)!;
    expect(view.filePath).toBe(join(realpathSync(planDir()), 'ship-it.plan.md'));
    expect(readFileSync(view.filePath!, 'utf8')).toBe('# Ship it\n\nDo the work.');
  });

  it('skips the plan file when the environment has no project path', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-plan-'));
    db = openDatabase(join(dir, 'zcc.sqlite'));
    const host = upsertHost(db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    const environment = createEnvironment(db, { projectId: 'proj-1', hostId: host.id });
    const thread = createConversationThread(db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude-code',
      status: 'active'
    });
    snapshotApprovedPlan(db, { threadId: thread.id, markdown: '# Ship it\n\nDo the work.', source: 'approval' });
    const view = getDurableThreadPlanView(db, thread.id)!;
    expect(view.markdown).toBe('# Ship it\n\nDo the work.');
    expect(view.filePath).toBeNull();
    expect(existsSync(join(dir, '.zcc'))).toBe(false);
  });

  it('snapshots a Codex plan item as the plan document', () => {
    const { thread } = setup();
    completeItem(thread.id, { type: 'plan', text: '# Codex plan\n\nBuild the feature.' });
    completeItem(thread.id, {
      type: 'planSteps',
      steps: [{ step: 'Write tests', status: 'pending' }]
    });
    syncPlanFromLatestEvents(db!, thread.id);
    const view = getDurableThreadPlanView(db!, thread.id)!;
    expect(view.markdown).toBe('# Codex plan\n\nBuild the feature.');
    expect(view.tasks[0]?.text).toBe('Write tests');
    expect(existsSync(join(planDir(), 'codex-plan.plan.md'))).toBe(true);
  });

  it('snapshots planSteps explanation when there is no plan item', () => {
    const { thread } = setup();
    completeItem(thread.id, {
      type: 'planSteps',
      explanation: 'Here is the plan: ship the widget.',
      steps: [{ step: 'Ship', status: 'pending' }]
    });
    syncPlanFromLatestEvents(db!, thread.id);
    const view = getDurableThreadPlanView(db!, thread.id)!;
    expect(view.markdown).toBe('Here is the plan: ship the widget.');
    expect(readdirSync(planDir()).some((name) => name.endsWith('.md'))).toBe(true);
  });

  it('snapshots a same-turn plan-mode writeup with planSteps', () => {
    const { thread } = setup();
    recordThreadExecutionMode(db!, { threadId: thread.id, requestedMode: 'plan', effectiveMode: 'plan' });
    completeItem(thread.id, {
      type: 'agentMessage',
      text: '# Restore plans\n\nCapture the document and write it to disk.'
    });
    completeItem(thread.id, {
      type: 'planSteps',
      steps: [{ step: 'Write the file', status: 'pending' }]
    });
    syncPlanFromLatestEvents(db!, thread.id);
    const view = getDurableThreadPlanView(db!, thread.id)!;
    expect(view.markdown).toContain('Capture the document');
    expect(listThreadPlanRevisions(db!, view.id)[0]?.source).toBe('provider-draft');
  });

  it('does not treat a later-turn chat message as the plan', () => {
    const { thread } = setup();
    recordThreadExecutionMode(db!, { threadId: thread.id, requestedMode: 'plan', effectiveMode: 'plan' });
    completeItem(thread.id, {
      type: 'planSteps',
      explanation: 'Typed plan body',
      steps: [{ step: 'One', status: 'pending' }]
    }, 'turn-1');
    syncPlanFromLatestEvents(db!, thread.id);
    completeItem(thread.id, {
      type: 'agentMessage',
      text: '# Location\n\nThis is a 2-step interaction. Answered by docs search.'
    }, 'turn-2');
    completeItem(thread.id, {
      type: 'planSteps',
      steps: [{ step: 'One', status: 'in_progress' }]
    }, 'turn-2');
    syncPlanFromLatestEvents(db!, thread.id);
    const view = getDurableThreadPlanView(db!, thread.id)!;
    expect(view.markdown).toBe('Typed plan body');
    expect(view.markdown).not.toContain('docs search');
  });
});
