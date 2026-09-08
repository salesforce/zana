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
  updateConversationThreadTitle,
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
    expect(view.status).toBe('active');
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

  it('updates provider task statuses from successive planSteps snapshots', () => {
    const { thread } = setup();
    completeItem(thread.id, {
      type: 'planSteps',
      steps: [
        { step: 'ping', status: 'pending' },
        { step: 'pong', status: 'pending' }
      ]
    });
    syncPlanFromLatestEvents(db!, thread.id);
    expect(getDurableThreadPlanView(db!, thread.id)!.tasks.map((task) => `${task.text}:${task.status}`)).toEqual([
      'ping:pending',
      'pong:pending'
    ]);

    completeItem(thread.id, {
      type: 'planSteps',
      steps: [
        { step: 'ping', status: 'active' },
        { step: 'pong', status: 'pending' }
      ]
    });
    syncPlanFromLatestEvents(db!, thread.id);
    expect(getDurableThreadPlanView(db!, thread.id)!.tasks.map((task) => `${task.text}:${task.status}`)).toEqual([
      'ping:in_progress',
      'pong:pending'
    ]);

    completeItem(thread.id, {
      type: 'planSteps',
      steps: [
        { step: 'ping', status: 'completed' },
        { step: 'pong', status: 'in_progress' }
      ]
    });
    syncPlanFromLatestEvents(db!, thread.id);
    expect(getDurableThreadPlanView(db!, thread.id)!.tasks.map((task) => `${task.text}:${task.status}`)).toEqual([
      'ping:completed',
      'pong:in_progress'
    ]);

    completeItem(thread.id, {
      type: 'planSteps',
      steps: [
        { step: 'ping', status: 'completed' },
        { step: 'pong', status: 'completed' }
      ]
    });
    syncPlanFromLatestEvents(db!, thread.id);
    const view = getDurableThreadPlanView(db!, thread.id)!;
    expect(view.tasks.map((task) => `${task.text}:${task.status}`)).toEqual([
      'ping:completed',
      'pong:completed'
    ]);
    expect(view.progress).toEqual({ completed: 2, total: 2 });
  });

  it('imports Cursor and OpenCode todo tool snapshots when planSteps are absent', () => {
    const { thread } = setup();
    completeItem(thread.id, {
      type: 'toolCall',
      tool: 'other',
      arguments: {
        _toolName: 'updateTodos',
        todos: [
          { id: 'ping', content: 'ping', status: 'TODO_STATUS_PENDING' },
          { id: 'pong', content: 'pong', status: 'TODO_STATUS_PENDING' }
        ]
      }
    });
    completeItem(thread.id, {
      type: 'toolCall',
      tool: 'other',
      arguments: {
        todos: [{ id: 'ping', content: 'ping', status: 'TODO_STATUS_IN_PROGRESS' }]
      }
    });
    syncPlanFromLatestEvents(db!, thread.id);
    expect(getDurableThreadPlanView(db!, thread.id)!.tasks.map((task) => `${task.text}:${task.status}`)).toEqual([
      'ping:in_progress',
      'pong:pending'
    ]);

    completeItem(thread.id, {
      type: 'toolCall',
      tool: 'other',
      arguments: {
        todos: [
          { content: 'ping', status: 'completed' },
          { content: 'pong', status: 'completed' }
        ]
      }
    });
    syncPlanFromLatestEvents(db!, thread.id);
    const view = getDurableThreadPlanView(db!, thread.id)!;
    expect(view.tasks.map((task) => `${task.text}:${task.status}`)).toEqual([
      'ping:completed',
      'pong:completed'
    ]);
    expect(view.progress).toEqual({ completed: 2, total: 2 });
  });

  it('promotes plan status from draft to active to completed', () => {
    const { thread } = setup();
    snapshotApprovedPlan(db!, { threadId: thread.id, markdown: '# Ship it', source: 'approval' });
    expect(getDurableThreadPlanView(db!, thread.id)!.status).toBe('draft');
    importProviderPlanSteps(db!, {
      threadId: thread.id,
      steps: [{ step: 'Write tests', status: 'in_progress' }]
    });
    expect(getDurableThreadPlanView(db!, thread.id)!.status).toBe('active');
    importProviderPlanSteps(db!, {
      threadId: thread.id,
      steps: [{ step: 'Write tests', status: 'completed' }]
    });
    expect(getDurableThreadPlanView(db!, thread.id)!.status).toBe('completed');
  });

  it('names referenced agents with role and assigned todo count', () => {
    const { thread } = setup();
    updateConversationThreadTitle(db!, thread.id, 'Pipe prefix in instructions');
    importProviderPlanSteps(db!, {
      threadId: thread.id,
      steps: [
        { step: 'Detect paste', status: 'completed' },
        { step: 'Write tests', status: 'pending' },
        { step: 'Ship', status: 'pending' }
      ]
    });
    const view = getDurableThreadPlanView(db!, thread.id)!;
    expect(view.referencedBy).toEqual([
      {
        threadId: thread.id,
        taskId: null,
        title: 'Pipe prefix in instructions',
        role: 'Author',
        todosAssigned: 3
      }
    ]);
  });

  it('labels a child thread as Agent with owned todo count', () => {
    const { thread } = setup();
    updateConversationThreadTitle(db!, thread.id, 'Author thread');
    const child = createConversationThread(db!, {
      projectId: 'proj-1',
      hostId: thread.hostId,
      environmentId: thread.environmentId!,
      providerId: 'claude-code',
      status: 'active',
      parentThreadId: thread.id,
      title: 'Helper'
    });
    importProviderPlanSteps(db!, {
      threadId: child.id,
      owningThreadId: child.id,
      steps: [{ step: 'Write tests', status: 'in_progress' }]
    });
    const view = getDurableThreadPlanView(db!, thread.id)!;
    expect(view.referencedBy).toEqual([
      {
        threadId: thread.id,
        taskId: null,
        title: 'Author thread',
        role: 'Author',
        todosAssigned: 0
      },
      {
        threadId: child.id,
        taskId: null,
        title: 'Helper',
        role: 'Agent',
        todosAssigned: 1
      }
    ]);
  });
});
