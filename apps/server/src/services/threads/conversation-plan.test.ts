import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendConversationThreadEvent,
  createConversationThread,
  createEnvironment,
  listThreadPlanRevisions,
  getThreadPlanTask,
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
  syncPlanFromLatestEvents,
  updateUserPlanTask
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

describe('BB provider plan snapshot semantics with the durable Plan display', () => {
  it('uses the latest checklist source and clears explicit empty todo snapshots', () => {
    const { thread } = setup();
    completeItem(thread.id, { type: 'planSteps', steps: [{ step: 'Old native plan' }] });
    completeItem(thread.id, { type: 'toolCall', arguments: { todos: [{ content: 'New todo', status: 'pending' }] } });
    syncPlanFromLatestEvents(db!, thread.id);
    expect(getDurableThreadPlanView(db!, thread.id)!.tasks.map(task => task.text)).toEqual(['New todo']);
    completeItem(thread.id, { type: 'toolCall', arguments: { todos: [] } });
    syncPlanFromLatestEvents(db!, thread.id);
    expect(getDurableThreadPlanView(db!, thread.id)!.tasks).toEqual([]);
  });
  it('adds child references to an existing plan without removing another thread\'s steps', () => {
    const { thread } = setup();
    importProviderPlanSteps(db!, { threadId: thread.id, steps: [{ step: 'Parent task' }] });
    const child = createConversationThread(db!, { projectId: thread.projectId, hostId: thread.hostId,
      environmentId: thread.environmentId!, providerId: thread.providerId, parentThreadId: thread.id, title: 'Child' });
    importProviderPlanSteps(db!, { threadId: child.id, steps: [{ step: 'Child task' }] });
    const view = getDurableThreadPlanView(db!, thread.id)!;
    expect(view.tasks.map(task => task.text).sort()).toEqual(['Child task', 'Parent task']);
    expect(view.referencedBy).toContainEqual(expect.objectContaining({ threadId: child.id, role: 'Agent', todosAssigned: 1 }));
  });
  it('updates rewritten steps that share the provider key prefix', () => {
    const { thread } = setup();
    const prefix = 'A'.repeat(90);
    importProviderPlanSteps(db!, { threadId: thread.id, steps: [{ step: `${prefix} first` }] });
    importProviderPlanSteps(db!, { threadId: thread.id, steps: [{ step: `${prefix} revised` }] });
    expect(getDurableThreadPlanView(db!, thread.id)!.tasks.map(task => task.text)).toEqual([`${prefix} revised`]);
  });
  it('rejects another plan\'s task before mutating it', () => {
    const { thread } = setup();
    const other = createConversationThread(db!, { projectId: thread.projectId, hostId: thread.hostId,
      environmentId: thread.environmentId!, providerId: thread.providerId });
    importProviderPlanSteps(db!, { threadId: thread.id, steps: [{ step: 'My task' }] });
    importProviderPlanSteps(db!, { threadId: other.id, steps: [{ step: 'Their task' }] });
    const task = getDurableThreadPlanView(db!, other.id)!.tasks[0]!;
    expect(() => updateUserPlanTask({ db } as never, thread.id, task.id, { text: 'Wrong plan' })).toThrow('plan task is not registered');
    expect(getThreadPlanTask(db!, task.id)).toMatchObject({ text: 'Their task', userEdited: false });
  });
  it('replaces stale steps, preserves reordered identities, and retains saved markdown', () => {
    const { thread } = setup();
    snapshotApprovedPlan(db!, { threadId: thread.id, markdown: '# The plan', source: 'approval' });
    importProviderPlanSteps(db!, { threadId: thread.id, steps: [{ step: 'One' }, { step: 'Two' }] });
    const before = getDurableThreadPlanView(db!, thread.id)!;
    const two = before.tasks.find(task => task.text === 'Two')!.id;
    importProviderPlanSteps(db!, { threadId: thread.id, steps: [{ step: 'Two', status: 'completed' }, { step: 'Three' }] });
    const after = getDurableThreadPlanView(db!, thread.id)!;
    expect(after.tasks.map(task => task.text)).toEqual(['Two', 'Three']);
    expect(after.tasks[0]).toMatchObject({ id: two, status: 'completed' });
    expect(after.markdown).toBe('# The plan');
    expect(after.revision).toBe(before.revision);
  });
  it('clears provider rows on an empty snapshot, retaining user edits and other owners', () => {
    const { thread } = setup();
    importProviderPlanSteps(db!, { threadId: thread.id, steps: [{ step: 'Keep' }, { step: 'Remove' }] });
    const plan = getDurableThreadPlanView(db!, thread.id)!;
    updateThreadPlanTask(db!, plan.tasks[0]!.id, { text: 'User edit', userEdited: true });
    completeItem(thread.id, { type: 'planSteps', steps: [] });
    syncPlanFromLatestEvents(db!, thread.id);
    expect(getDurableThreadPlanView(db!, thread.id)!.tasks.map(task => task.text)).toEqual(['User edit']);
  });
  it('handles repeated step labels without conflating distinct entries', () => {
    const { thread } = setup();
    importProviderPlanSteps(db!, { threadId: thread.id, steps: [{ step: 'Check' }, { step: 'Check' }] });
    const before = getDurableThreadPlanView(db!, thread.id)!;
    importProviderPlanSteps(db!, { threadId: thread.id, steps: [{ step: 'Check', status: 'completed' }, { step: 'Check', status: 'in_progress' }] });
    const after = getDurableThreadPlanView(db!, thread.id)!;
    expect(after.tasks.map(task => task.id)).toEqual(before.tasks.map(task => task.id));
    expect(after.tasks.map(task => task.status)).toEqual(['completed', 'in_progress']);
  });
});


describe('plain planning replies', () => {
  function begin(threadId: string, turnId: string, mode = 'plan') {
    appendConversationThreadEvent(db!, { threadId, type: 'client/turn/requested', payload: {
      type: 'client/turn/requested', execution: { acpMode: mode }, input: [{ type: 'text', text: 'Write the plan', mentions: [] }]
    } });
    appendConversationThreadEvent(db!, { threadId, type: 'turn/started', payload: { type: 'turn/started', scope: { turnId } } });
  }
  function finish(threadId: string, turnId: string, status = 'completed') {
    appendConversationThreadEvent(db!, { threadId, type: 'turn.completed', payload: { type: 'turn/completed', scope: { turnId }, status } });
    syncPlanFromLatestEvents(db!, threadId);
  }
  it('captures a completed plain reply without a checklist, once, and saves later revisions', () => {
    const { thread } = setup();
    begin(thread.id, 'first');
    completeItem(thread.id, { type: 'agentMessage', text: '# Draft one\n\nImplement a temperature converter.' }, 'first');
    syncPlanFromLatestEvents(db!, thread.id);
    expect(getDurableThreadPlanView(db!, thread.id)).toBeNull();
    finish(thread.id, 'first');
    expect(getDurableThreadPlanView(db!, thread.id)).toMatchObject({ markdown: '# Draft one\n\nImplement a temperature converter.', revision: 1, revisionSource: 'provider-draft', tasks: [] });
    syncPlanFromLatestEvents(db!, thread.id);
    expect(getDurableThreadPlanView(db!, thread.id)?.revision).toBe(1);
    begin(thread.id, 'second');
    completeItem(thread.id, { type: 'agentMessage', text: '# Draft two\n\nAlso support Kelvin.' }, 'second');
    finish(thread.id, 'second');
    const plan = getDurableThreadPlanView(db!, thread.id)!;
    expect(plan).toMatchObject({ revision: 2, markdown: '# Draft two\n\nAlso support Kelvin.' });
    expect(readFileSync(plan.filePath!, 'utf8')).toBe(plan.markdown);
  });
  it('does not anchor a new plain revision to an older checklist', () => {
    const { thread } = setup();
    begin(thread.id, 'first');
    completeItem(thread.id, { type: 'agentMessage', text: '# Old draft' }, 'first');
    completeItem(thread.id, { type: 'planSteps', steps: [{ step: 'Inspect', status: 'pending' }] }, 'first');
    finish(thread.id, 'first');
    begin(thread.id, 'second');
    completeItem(thread.id, { type: 'agentMessage', text: '# Revised draft' }, 'second');
    finish(thread.id, 'second');
    expect(getDurableThreadPlanView(db!, thread.id)?.markdown).toBe('# Revised draft');
  });
  it.each(['agent', 'ask'])('does not capture ordinary %s replies after planning', mode => {
    const { thread } = setup();
    recordThreadExecutionMode(db!, { threadId: thread.id, requestedMode: 'plan' });
    begin(thread.id, 'one', mode);
    completeItem(thread.id, { type: 'agentMessage', text: '# Ordinary response' }, 'one');
    finish(thread.id, 'one');
    expect(getDurableThreadPlanView(db!, thread.id)?.markdown).toBeNull();
  });
  it.each(['interrupted', 'failed'])('does not capture a %s planning turn', status => {
    const { thread } = setup();
    begin(thread.id, 'one');
    completeItem(thread.id, { type: 'agentMessage', text: '# Partial draft' }, 'one');
    finish(thread.id, 'one', status);
    expect(getDurableThreadPlanView(db!, thread.id)).toBeNull();
  });
  it('does not replay provider history over a user edit', () => {
    const { thread } = setup();
    completeItem(thread.id, { type: 'plan', text: '# Native draft' });
    syncPlanFromLatestEvents(db!, thread.id);
    snapshotApprovedPlan(db!, { threadId: thread.id, markdown: '# User correction', source: 'user' });
    syncPlanFromLatestEvents(db!, thread.id);
    expect(getDurableThreadPlanView(db!, thread.id)?.markdown).toBe('# User correction');
  });
  it('keeps the reviewed document when implementation emits checklist commentary', () => {
    const { thread } = setup();
    begin(thread.id, 'plan');
    completeItem(thread.id, { type: 'agentMessage', text: '# Reviewed proposal' }, 'plan');
    finish(thread.id, 'plan');
    begin(thread.id, 'implementation', 'agent');
    completeItem(thread.id, { type: 'planSteps', explanation: 'Finished implementation and tests.', steps: [{ step: 'Implement', status: 'completed' }] }, 'implementation');
    finish(thread.id, 'implementation');
    expect(getDurableThreadPlanView(db!, thread.id)).toMatchObject({ markdown: '# Reviewed proposal', revision: 1, progress: { completed: 1, total: 1 } });
  });
  it('allows an explicit new planning turn to revise a user document', () => {
    const { thread } = setup();
    snapshotApprovedPlan(db!, { threadId: thread.id, markdown: '# User draft', source: 'user' });
    begin(thread.id, 'revision');
    completeItem(thread.id, { type: 'agentMessage', text: '# Requested revision' }, 'revision');
    finish(thread.id, 'revision');
    expect(getDurableThreadPlanView(db!, thread.id)).toMatchObject({ markdown: '# Requested revision', revision: 2 });
  });
  it('ignores short answers and nested turns', () => {
    const { thread } = setup();
    begin(thread.id, 'one');
    completeItem(thread.id, { type: 'agentMessage', text: 'Okay.' }, 'one');
    finish(thread.id, 'one');
    expect(getDurableThreadPlanView(db!, thread.id)).toBeNull();
    appendConversationThreadEvent(db!, { threadId: thread.id, type: 'turn/started', payload: { type: 'turn/started', scope: { turnId: 'child' }, parentToolCallId: 'tool' } });
    completeItem(thread.id, { type: 'agentMessage', text: '# Nested report' }, 'child');
    finish(thread.id, 'child');
    expect(getDurableThreadPlanView(db!, thread.id)).toBeNull();
  });
  it('prefers a native document after the checklist and excludes nested replies', () => {
    const { thread } = setup();
    begin(thread.id, 'one');
    completeItem(thread.id, { type: 'planSteps', steps: [] }, 'one');
    completeItem(thread.id, { type: 'plan', text: '# Native document' }, 'one');
    completeItem(thread.id, { type: 'agentMessage', text: '# Child report', parentToolCallId: 'child' }, 'one');
    finish(thread.id, 'one');
    expect(getDurableThreadPlanView(db!, thread.id)?.markdown).toBe('# Native document');
  });
});
