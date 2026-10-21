import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A fake electron surface: `BrowserWindow` records what the controller does to
// each rail / panel / tooltip window, and `screen` is an emitter (display
// hooks) with one 1440×900 display and a movable cursor.
const fake = vi.hoisted(() => ({ windows: [] as unknown[], cursor: { x: 0, y: 0 } }));
vi.mock('electron', async () => {
  const { EventEmitter: EE } = await import('node:events');
  const work = { x: 0, y: 25, width: 1440, height: 875 };
  const display = { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: work };
  let nextId = 100;
  class FakeWindow extends EE {
    destroyed = false;
    visible = false;
    focused = false;
    ignoreMouse = false;
    bounds: { x: number; y: number; width: number; height: number };
    url = '';
    webContents: { id: number; send: ReturnType<typeof vi.fn>; isDestroyed: () => boolean; setWindowOpenHandler: () => void; on: () => void };
    constructor(opts: { x: number; y: number; width: number; height: number }) {
      super();
      this.bounds = { x: opts.x, y: opts.y, width: opts.width, height: opts.height };
      this.webContents = { id: nextId++, send: vi.fn(), isDestroyed: () => this.destroyed, setWindowOpenHandler: () => undefined, on: () => undefined };
      fake.windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    isVisible() { return this.visible; }
    show() { this.visible = true; }
    showInactive() { this.visible = true; }
    hide() { this.visible = false; }
    focus() { this.focused = true; }
    setBounds(b: FakeWindow['bounds']) { this.bounds = { ...b }; }
    getBounds() { return { ...this.bounds }; }
    getPosition() { return [this.bounds.x, this.bounds.y]; }
    setPosition(x: number, y: number) { this.bounds = { ...this.bounds, x, y }; }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setIgnoreMouseEvents(v: boolean) { this.ignoreMouse = v; }
    loadURL(u: string) { this.url = u; return Promise.resolve(); }
    loadFile(f: string, o?: { search?: string }) { this.url = `${f}?${o?.search ?? ''}`; return Promise.resolve(); }
  }
  const screen = Object.assign(new EE(), {
    getAllDisplays: () => [display],
    getPrimaryDisplay: () => display,
    getDisplayMatching: () => display,
    getDisplayNearestPoint: () => display,
    getCursorScreenPoint: () => ({ ...fake.cursor })
  });
  return { BrowserWindow: FakeWindow, screen };
});
import {
  CompanionController,
  EDGE_MARGIN,
  PANEL_MAX_HEIGHT,
  PANEL_WIDTH,
  RAIL_HEIGHT,
  RAIL_PAD,
  RAIL_WIDTH,
  RECENT_DONE_MS,
  REQUEST_MAX_AGE_MS,
  ANSWER_MAX_CHARS,
  INBOX_CACHE_MAX,
  initialsFor,
  panelLayout,
  railRect,
  railWindowBounds,
  resolveDisplay,
  sanitizeAnswer,
  sanitizeTooltip,
  hideAppWindows,
  snapPlacement,
  tooltipBounds,
  TOOLTIP_HEIGHT,
  TOOLTIP_WIDTH,
  type CompanionDeps
} from './companion.js';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import type { AgentState, InboxEntry, TerminalSession } from '@zana-ai/zcc-domain/product';

const WORK = { x: 0, y: 25, width: 1440, height: 875 };

describe('placement math', () => {
  it('docks the rail on the right edge, slightly above centre, by default', () => {
    const r = railRect(WORK, undefined);
    expect(r.x).toBe(WORK.width - EDGE_MARGIN - RAIL_WIDTH);
    expect(r.width).toBe(RAIL_WIDTH);
    expect(r.height).toBe(RAIL_HEIGHT);
    const centre = r.y + r.height / 2;
    expect(centre).toBeLessThan(WORK.y + WORK.height / 2);
    expect(centre).toBeGreaterThan(WORK.y + WORK.height * 0.3);
  });

  it('honours a left edge + offset and clamps it on screen', () => {
    expect(railRect(WORK, { edge: 'left', offsetY: 100 })).toMatchObject({ x: EDGE_MARGIN, y: 125 });
    const low = railRect(WORK, { edge: 'left', offsetY: 99_999 });
    expect(low.y + low.height).toBe(WORK.y + WORK.height - EDGE_MARGIN);
    expect(railRect(WORK, { edge: 'right', offsetY: 0 }).y).toBe(WORK.y + EDGE_MARGIN);
  });

  it('pads the rail window for the shadow', () => {
    const r = railRect(WORK, undefined);
    expect(railWindowBounds(r)).toEqual({
      x: r.x - RAIL_PAD,
      y: r.y - RAIL_PAD,
      width: RAIL_WIDTH + 2 * RAIL_PAD,
      height: RAIL_HEIGHT + 2 * RAIL_PAD
    });
  });

  it('snaps a dropped rail to the nearer edge and keeps its height', () => {
    const display = { id: 9, workArea: WORK };
    expect(snapPlacement({ x: 300, y: 225, width: RAIL_WIDTH, height: RAIL_HEIGHT }, display)).toEqual({
      edge: 'left',
      displayId: 9,
      offsetY: 200
    });
    expect(snapPlacement({ x: 1000, y: -50, width: RAIL_WIDTH, height: RAIL_HEIGHT }, display)).toEqual({
      edge: 'right',
      displayId: 9,
      offsetY: EDGE_MARGIN
    });
  });

  it('places the panel beside the rail on the inner side, clamped to the work area', () => {
    const rail = railRect(WORK, { edge: 'right', offsetY: 300 });
    const right = panelLayout(rail, WORK, 'right');
    expect(right.x + right.width).toBeLessThan(rail.x);
    expect(right.width).toBe(PANEL_WIDTH);
    expect(right.height).toBe(PANEL_MAX_HEIGHT);
    expect(right.y).toBeGreaterThanOrEqual(WORK.y + EDGE_MARGIN);
    expect(right.y + right.anchorY).toBe(rail.y);

    const leftRail = railRect(WORK, { edge: 'left', offsetY: 0 });
    const left = panelLayout(leftRail, WORK, 'left');
    expect(left.x).toBeGreaterThan(leftRail.x + leftRail.width);
    expect(left.y).toBe(WORK.y + EDGE_MARGIN);

    const short = { x: 0, y: 0, width: 1280, height: 500 };
    expect(panelLayout(railRect(short, undefined), short, 'right').height).toBe(500 - 2 * EDGE_MARGIN);
  });

  it('floats the tooltip beside the rail, centred on the icon and on screen', () => {
    const rail = railRect(WORK, { edge: 'right', offsetY: 300 });
    const iconY = 60;
    const r = tooltipBounds(rail, WORK, 'right', iconY);
    expect(r.x + r.width).toBeLessThan(rail.x);
    expect(r).toMatchObject({ width: TOOLTIP_WIDTH, height: TOOLTIP_HEIGHT });
    expect(r.y + TOOLTIP_HEIGHT / 2).toBe(rail.y - RAIL_PAD + iconY);
    const leftRail = railRect(WORK, { edge: 'left', offsetY: 0 });
    const l = tooltipBounds(leftRail, WORK, 'left', 0);
    expect(l.x).toBeGreaterThan(leftRail.x + leftRail.width);
    expect(l.y).toBe(WORK.y);
  });

  it('validates renderer tooltips', () => {
    expect(sanitizeTooltip({ label: ' Agents ', detail: ' 2 working ', y: 40 })).toEqual({ label: 'Agents', detail: '2 working', y: 40 });
    expect(sanitizeTooltip({ label: 'x'.repeat(200), detail: '', y: 1 })).toEqual({ label: 'x'.repeat(60), detail: undefined, y: 1 });
    expect(sanitizeTooltip(null)).toBeNull();
    expect(sanitizeTooltip({ label: '', y: 1 })).toBeNull();
    expect(sanitizeTooltip({ label: 'a', y: -1 })).toBeNull();
    expect(sanitizeTooltip({ label: 'a', y: 5000 })).toBeNull();
    expect(sanitizeTooltip({ label: 'a', y: Number.NaN })).toBeNull();
  });

  it('resolves the saved display, then the fallback, then the primary', () => {
    const a = { id: 1 };
    const b = { id: 2 };
    const primary = { id: 3 };
    expect(resolveDisplay([a, b, primary], { edge: 'right', displayId: 2 }, a, primary)).toBe(b);
    expect(resolveDisplay([a, primary], { edge: 'right', displayId: 2 }, a, primary)).toBe(a);
    expect(resolveDisplay([a, primary], undefined, null, primary)).toBe(primary);
  });

  it('derives avatar initials', () => {
    expect(initialsFor('p.camprubi')).toBe('PC');
    expect(initialsFor('Ana Lopez')).toBe('AL');
    expect(initialsFor('ana')).toBe('AN');
    expect(initialsFor('')).toBe('?');
  });

  it('sanitizes answers', () => {
    expect(sanitizeAnswer('  yes\r\n', false)).toBe('yes');
    expect(sanitizeAnswer('a\nb', false)).toBe('a b');
    expect(sanitizeAnswer('Q1: x\nA: y\n\n\n\nQ2', true)).toBe('Q1: x\nA: y\n\nQ2');
    expect(sanitizeAnswer(42, false)).toBe('');
    expect(sanitizeAnswer('ok\u001b[201~ then\u0007\tmore\u009b', false)).toBe('ok[201~ then\tmore');
    expect(sanitizeAnswer('x'.repeat(ANSWER_MAX_CHARS + 50), false)).toHaveLength(ANSWER_MAX_CHARS);
  });
});

// ----- controller ------------------------------------------------------------------

const NOW = 10_000_000_000;

function session(over: Partial<TerminalSession> & { id: string }): TerminalSession {
  return {
    projectId: 'p1',
    title: over.id,
    profile: 'claude',
    cwd: '/tmp',
    status: 'running',
    createdAt: NOW - 60_000,
    ...over
  } as TerminalSession;
}

function question(over: Partial<InboxEntry> & { id: string }): InboxEntry {
  return {
    ts: NOW - 1000,
    projectId: 'p1',
    projectLabel: 'Proj',
    comments: 'Which way?',
    sessionId: 's1',
    question: { options: [{ id: 'A', label: 'Left (Recommended)' }, { id: 'B', label: 'Right' }], blocking: true },
    ...over
  } as InboxEntry;
}

function setup(opts: {
  sessions?: TerminalSession[];
  states?: Record<string, AgentState>;
  entries?: InboxEntry[];
  enabled?: boolean;
  appWindows?: unknown[];
  isEnabled?: () => boolean;
  schedules?: Array<{
    id: string;
    projectId: string;
    enabled: boolean;
    nextRunAt?: string;
    runs?: unknown[];
    lastRunResult?: 'success' | 'error';
    lastRunAt?: string;
  }>;
}) {
  const sessions = opts.sessions ?? [];
  const states = opts.states ?? {};
  const ptys = Object.assign(new EventEmitter(), {
    listAll: () => sessions,
    list: (pid: string) => sessions.filter((s) => s.projectId === pid),
    getSession: (id: string) => sessions.find((s) => s.id === id) ?? null,
    reply: vi.fn((id: string, _text: string) => sessions.some((s) => s.id === id && s.status === 'running'))
  });
  const agentStatus = Object.assign(new EventEmitter(), { get: (id: string) => states[id] ?? 'unknown' });
  const schedules = (opts.schedules ?? []).map((s) => ({
    id: s.id,
    name: `Task ${s.id}`,
    projectId: s.projectId,
    enabled: s.enabled,
    status: { nextRunAt: s.nextRunAt, runs: s.runs ?? [], runCount: 0, lastRunResult: s.lastRunResult, lastRunAt: s.lastRunAt }
  }));
  const scheduler = Object.assign(new EventEmitter(), { list: () => schedules, runNow: vi.fn() });
  const listeners = { appended: new Set<(e: InboxEntry) => void>(), updated: new Set<(e: InboxEntry) => void>(), removed: new Set<(id: string) => void>(), pruned: new Set<(ids: string[]) => void>() };
  const sub = <T>(set: Set<T>) => (fn: T) => {
    set.add(fn);
    return () => set.delete(fn);
  };
  const inboxStore = {
    read: vi.fn(async () => ({ entries: opts.entries ?? [], hasMore: false })),
    onAppended: sub(listeners.appended),
    onUpdated: sub(listeners.updated),
    onRemoved: sub(listeners.removed),
    onPruned: sub(listeners.pruned)
  };
  const sendToApp = vi.fn();
  const showMainWindow = vi.fn();
  const restoreWindows = vi.fn();
  const deps: CompanionDeps = {
    ptys: ptys as unknown as CompanionDeps['ptys'],
    agentStatus: agentStatus as unknown as CompanionDeps['agentStatus'],
    scheduler: scheduler as unknown as CompanionDeps['scheduler'],
    inboxStore: inboxStore as unknown as CompanionDeps['inboxStore'],
    projectName: (id) => `name-${id}`,
    projectColor: () => undefined,
    triage: (id) => (id === 'b1' ? ({ sessionId: id, resolution: 'awaiting-reply', summary: 'Approve deploy?' } as never) : null),
    theme: () => 'light',
    isEnabled: opts.isEnabled ?? (() => opts.enabled ?? true),
    getPlacement: () => undefined,
    savePlacement: vi.fn(),
    mainWindows: () => (opts.appWindows ?? []) as never,
    showMainWindow,
    restoreWindows,
    sendToApp,
    preloadPath: '/preload.js',
    logger: () => undefined,
    now: () => NOW
  };
  const c = new CompanionController(deps);
  return { c, deps, ptys, agentStatus, scheduler, inboxStore, listeners, sendToApp, showMainWindow, restoreWindows, states };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('CompanionController snapshot', () => {
  it('turns unanswered inbox questions into answerable Needs You requests', async () => {
    const { c } = setup({ sessions: [session({ id: 's1', title: 'Fixer' })], states: { s1: 'blocked' }, entries: [question({ id: 'e1' })] });
    c.start();
    await flush();
    const snap = c.buildSnapshot();
    expect(snap.requests).toHaveLength(1);
    expect(snap.requests[0]).toMatchObject({
      id: 'inbox:e1',
      kind: 'question',
      entryId: 'e1',
      agentTitle: 'Fixer',
      prompt: 'Which way?',
      answerable: true,
      projectName: 'Proj'
    });
    expect(snap.requests[0].questions?.[0].options).toHaveLength(2);
    // The blocked agent that asked is NOT listed twice.
    expect(snap.requests.filter((r) => r.sessionId === 's1')).toHaveLength(1);
    expect(snap.theme).toBe('light');
    expect(snap.counts.blocked).toBe(1);
    c.stop();
  });

  it('flags ended, background and execution requests as not answerable', async () => {
    const { c } = setup({
      sessions: [session({ id: 'bg', scheduled: true })],
      entries: [
        question({ id: 'gone', sessionId: 'dead' }),
        question({ id: 'bg', sessionId: 'bg' }),
        question({ id: 'ex', sessionId: 'bg', executionId: 'x1' })
      ]
    });
    c.start();
    await flush();
    const byId = Object.fromEntries(c.buildSnapshot().requests.map((r) => [r.entryId, r]));
    expect(byId.gone).toMatchObject({ answerable: false, reason: 'ended' });
    expect(byId.bg).toMatchObject({ answerable: false, reason: 'background' });
    expect(byId.ex).toMatchObject({ answerable: false, reason: 'execution' });
    c.stop();
  });

  it('drops stale and non-question entries and follows inbox events', async () => {
    const { c, listeners } = setup({
      entries: [question({ id: 'old', ts: NOW - REQUEST_MAX_AGE_MS - 1 }), { ...question({ id: 'note' }), question: undefined }]
    });
    c.start();
    await flush();
    expect(c.buildSnapshot().requests).toHaveLength(0);
    for (const fn of listeners.appended) fn(question({ id: 'new' }));
    expect(c.buildSnapshot().requests.map((r) => r.entryId)).toEqual(['new']);
    for (const fn of listeners.removed) fn('new');
    expect(c.buildSnapshot().requests).toHaveLength(0);
    for (const fn of listeners.updated) fn(question({ id: 'u' }));
    for (const fn of listeners.pruned) fn(['u']);
    expect(c.buildSnapshot().requests).toHaveLength(0);
    c.stop();
  });

  it('adds blocked agents without a question, glossed by triage', () => {
    const { c } = setup({ sessions: [session({ id: 'b1', title: 'Deployer' })], states: { b1: 'blocked' } });
    const [r] = c.buildSnapshot().requests;
    expect(r).toMatchObject({ id: 'agent:b1', kind: 'blocked', prompt: 'Approve deploy?', answerable: true });
  });

  it('groups counts and marks working → idle as recently completed', () => {
    const { c, agentStatus, states } = setup({
      sessions: [session({ id: 'w' }), session({ id: 'i' }), session({ id: 'x', status: 'exited' })],
      states: { w: 'working', i: 'working' }
    });
    c.start();
    agentStatus.emit('status', 'i', 'working', 1);
    states.i = 'idle';
    agentStatus.emit('status', 'i', 'idle', 2);
    const snap = c.buildSnapshot();
    expect(snap.agents.map((a) => a.sessionId)).toEqual(['w', 'i']);
    expect(snap.counts).toMatchObject({ working: 1, idle: 1, recentlyCompleted: 1 });
    expect(snap.agents.find((a) => a.sessionId === 'i')?.recentlyCompleted).toBe(true);
    c.stop();
  });

  it('expires recently-completed after the window', () => {
    let now = NOW;
    const env = setup({ sessions: [session({ id: 'i' })], states: { i: 'working' } });
    (env.c as unknown as { deps: CompanionDeps }).deps.now = () => now;
    env.c.start();
    env.agentStatus.emit('status', 'i', 'working', 1);
    env.states.i = 'done';
    env.agentStatus.emit('status', 'i', 'done', 2);
    now += RECENT_DONE_MS + 1;
    expect(env.c.buildSnapshot().counts.recentlyCompleted).toBe(0);
    env.c.stop();
  });

  it('lists schedules running-first with their next run', () => {
    const { c } = setup({
      sessions: [session({ id: 'run' })],
      schedules: [
        { id: 'later', projectId: 'p1', enabled: true, nextRunAt: new Date(NOW + 3600_000).toISOString() },
        { id: 'busy', projectId: 'p1', enabled: true, runs: [{ sessionId: 'run' }] },
        { id: 'off', projectId: 'p1', enabled: false, nextRunAt: new Date(NOW).toISOString(), lastRunResult: 'error', lastRunAt: '2026-10-05T09:00:00Z' }
      ]
    });
    const snap = c.buildSnapshot();
    expect(snap.schedules[2]).toMatchObject({ lastResult: 'error', lastRunAt: '2026-10-05T09:00:00Z' });
    expect(snap.schedules.map((s) => s.id)).toEqual(['busy', 'later', 'off']);
    expect(snap.schedules[0].running).toBe(true);
    expect(snap.schedules[2].nextRunAt).toBeNull();
    expect(snap.counts.runningSchedules).toBe(1);
  });
});

describe('CompanionController.answer (Rule 1 gates)', () => {
  let env: ReturnType<typeof setup>;
  beforeEach(async () => {
    env = setup({
      sessions: [session({ id: 's1' }), session({ id: 'b1' }), session({ id: 'hl', headless: true })],
      states: { b1: 'blocked', s1: 'blocked', hl: 'blocked' },
      entries: [
        question({ id: 'e1' }),
        question({ id: 'multi', question: undefined, questions: [{ options: [{ id: 'A', label: 'x' }] }, { options: [{ id: 'A', label: 'y' }] }] }),
        question({ id: 'ex', executionId: 'x' }),
        question({ id: 'dead', sessionId: 'nope' })
      ]
    });
    env.c.start();
    await flush();
    env.c.enter();
  });
  afterEach(() => env.c.stop());

  it('refuses while the rail is down or the flag is off', async () => {
    env.c.leave();
    expect(env.c.answer('inbox:e1', 'Left')).toEqual({ ok: false, reason: 'unknown' });
    let enabled = true;
    const off = setup({ sessions: [session({ id: 's1' })], entries: [question({ id: 'e1' })], isEnabled: () => enabled });
    off.c.start();
    await flush();
    off.c.enter();
    enabled = false;
    expect(off.c.answer('inbox:e1', 'Left')).toEqual({ ok: false, reason: 'unknown' });
    expect(off.ptys.reply).not.toHaveBeenCalled();
    off.c.stop();
  });

  it('injects a sanitized answer into the asking session', () => {
    expect(env.c.answer('inbox:e1', ' Left\r\n')).toEqual({ ok: true });
    expect(env.ptys.reply).toHaveBeenCalledWith('s1', 'Left');
  });

  it('keeps newlines for a multi-question reply', () => {
    env.c.answer('inbox:multi', 'Q1: a\nA: x\n\nQ2: b\nA: y');
    expect(env.ptys.reply).toHaveBeenCalledWith('s1', 'Q1: a\nA: x\n\nQ2: b\nA: y');
  });

  it('replies to a blocked agent by session', () => {
    expect(env.c.answer('agent:b1', 'go')).toEqual({ ok: true });
    expect(env.ptys.reply).toHaveBeenCalledWith('b1', 'go');
  });

  it('refuses unknown, execution, ended, background, unblocked and empty', () => {
    expect(env.c.answer('inbox:missing', 'x')).toEqual({ ok: false, reason: 'unknown' });
    expect(env.c.answer('bogus', 'x')).toEqual({ ok: false, reason: 'unknown' });
    expect(env.c.answer(7, 'x')).toEqual({ ok: false, reason: 'unknown' });
    expect(env.c.answer('inbox:ex', 'x')).toEqual({ ok: false, reason: 'execution' });
    expect(env.c.answer('inbox:dead', 'x')).toEqual({ ok: false, reason: 'ended' });
    expect(env.c.answer('agent:hl', 'x')).toEqual({ ok: false, reason: 'background' });
    env.states.b1 = 'working';
    expect(env.c.answer('agent:b1', 'x')).toEqual({ ok: false, reason: 'unknown' });
    expect(env.c.answer('inbox:e1', '   ')).toEqual({ ok: false, reason: 'empty' });
    expect(env.ptys.reply).not.toHaveBeenCalled();
  });
});

describe('CompanionController deep links', () => {
  it('validates targets against main state before navigating', async () => {
    const env = setup({
      sessions: [session({ id: 's1', projectId: 'p9' })],
      entries: [question({ id: 'e1', projectId: 'p9' })],
      schedules: [{ id: 't1', projectId: 'p1', enabled: true }]
    });
    env.c.start();
    await flush();
    env.c.open({ kind: 'session', sessionId: 's1' });
    expect(env.sendToApp).toHaveBeenLastCalledWith('app:focusSession', 's1', 'p9');
    env.c.open({ kind: 'session', sessionId: 'forged' });
    expect(env.sendToApp).toHaveBeenCalledTimes(1);
    env.c.open({ kind: 'request', requestId: 'inbox:e1' });
    expect(env.sendToApp).toHaveBeenLastCalledWith('app:focusInboxEntry', 'e1', 'p9');
    env.c.open({ kind: 'request', requestId: 'agent:s1' });
    expect(env.sendToApp).toHaveBeenLastCalledWith('app:focusSession', 's1', 'p9');
    env.c.open({ kind: 'scheduler', taskId: 'nope' });
    expect(env.sendToApp).toHaveBeenLastCalledWith('app:openScheduler', undefined);
    env.c.open({ kind: 'scheduler', taskId: 't1' });
    expect(env.sendToApp).toHaveBeenLastCalledWith('app:openScheduler', 't1');
    env.c.open({ kind: 'home' });
    expect(env.sendToApp).toHaveBeenLastCalledWith('app:openHome');
    env.c.open({ kind: 'agents' });
    expect(env.sendToApp).toHaveBeenLastCalledWith('app:openAgents');
    env.c.open({ kind: 'main' });
    env.c.open(null);
    expect(env.showMainWindow).toHaveBeenCalledTimes(8);
    env.c.stop();
  });

  it('runs only known schedules', () => {
    const env = setup({ schedules: [{ id: 't1', projectId: 'p1', enabled: true }] });
    expect(env.c.runSchedule('t1')).toBe(true);
    expect(env.scheduler.runNow).toHaveBeenCalledWith('t1');
    expect(env.c.runSchedule('t2')).toBe(false);
    expect(env.c.runSchedule(undefined)).toBe(false);
  });
});

describe('CompanionController lifecycle', () => {
  it('subscribes once and releases every listener on stop (Rule 3)', () => {
    const env = setup({});
    env.c.start();
    env.c.start();
    expect(env.ptys.listenerCount('exit')).toBe(1);
    expect(env.agentStatus.listenerCount('status')).toBe(1);
    expect(env.scheduler.listenerCount('changed')).toBe(1);
    expect(env.listeners.appended.size).toBe(1);
    env.c.stop();
    expect(env.ptys.listenerCount('exit')).toBe(0);
    expect(env.ptys.listenerCount('sessionUpdated')).toBe(0);
    expect(env.agentStatus.listenerCount('status')).toBe(0);
    expect(env.scheduler.listenerCount('changed')).toBe(0);
    expect(env.listeners.appended.size + env.listeners.removed.size + env.listeners.pruned.size + env.listeners.updated.size).toBe(0);
  });

  it('follows display hot-plug and releases it on stop', async () => {
    const { screen } = (await import('electron')) as unknown as { screen: EventEmitter };
    const events = ['display-added', 'display-removed', 'display-metrics-changed'];
    const before = events.map((ev) => screen.listenerCount(ev));
    const env = setup({});
    env.c.start();
    expect(events.map((ev) => screen.listenerCount(ev))).toEqual(before.map((n) => n + 1));
    env.c.stop();
    expect(events.map((ev) => screen.listenerCount(ev))).toEqual(before);
  });

  it('ignores tooltips, drags and panels while the rail is down', () => {
    const env = setup({});
    expect(() => {
      env.c.tooltip({ label: 'Agents', y: 40 });
      env.c.dragEnd();
      env.c.openPanel('agents');
    }).not.toThrow();
    expect(env.c.getPanelState()).toBeNull();
  });

  it('hides visible and minimized app windows, skipping destroyed ones', () => {
    const win = (state: { visible?: boolean; minimized?: boolean; destroyed?: boolean }) => ({
      isDestroyed: () => state.destroyed === true,
      isVisible: () => state.visible === true,
      isMinimized: () => state.minimized === true,
      hide: vi.fn()
    });
    const wins = [win({ visible: true }), win({ minimized: true }), win({}), win({ visible: true, destroyed: true })];
    hideAppWindows(wins);
    expect(wins.map((w) => w.hide.mock.calls.length)).toEqual([1, 1, 0, 0]);
  });

  it('will not enter when the opt-in flag is off', () => {
    const env = setup({ enabled: false });
    expect(env.c.enter()).toBe(false);
    expect(env.c.isActive()).toBe(false);
  });
});

// ----- live rail: windows, panel, tooltip, drag ---------------------------------------

type FakeWin = {
  destroyed: boolean;
  visible: boolean;
  focused: boolean;
  ignoreMouse: boolean;
  url: string;
  bounds: { x: number; y: number; width: number; height: number };
  webContents: { id: number; send: ReturnType<typeof vi.fn> };
  emit: (ev: string) => void;
  destroy: () => void;
};

const created = () => fake.windows as FakeWin[];
const partWin = (part: 'rail' | 'panel' | 'tooltip') =>
  created().find((w) => !w.destroyed && w.url.includes(`part=${part}`));
const sent = (w: FakeWin | undefined, channel: string) =>
  (w?.webContents.send.mock.calls ?? []).filter(([ch]) => ch === channel).map(([, ...args]) => args);

function appWindow(state: { visible?: boolean; minimized?: boolean } = { visible: true }) {
  const w = {
    destroyed: false,
    visible: state.visible === true,
    minimized: state.minimized === true,
    isDestroyed: () => w.destroyed,
    isVisible: () => w.visible,
    isMinimized: () => w.minimized,
    getBounds: () => ({ x: 100, y: 100, width: 800, height: 600 }),
    hide: vi.fn(() => {
      w.visible = false;
    })
  };
  return w;
}

describe('CompanionController inbox cache', () => {
  it('uses a lone question\'s own text when the entry has no comments (AskUserQuestion hook)', async () => {
    const hooked = question({ id: 'h1', comments: undefined, question: { prompt: 'Which side?', options: [{ id: 'A', label: 'L' }] } });
    const multi = question({
      id: 'm1',
      comments: undefined,
      questions: [{ prompt: 'One?', options: [{ id: 'A', label: 'x' }] }, { prompt: 'Two?', options: [{ id: 'A', label: 'y' }] }]
    } as Partial<InboxEntry>);
    const env = setup({ sessions: [session({ id: 's1' })], entries: [hooked, multi] });
    env.c.start();
    await flush();
    const byId = new Map(env.c.buildSnapshot().requests.map((r) => [r.entryId, r.prompt]));
    expect(byId.get('h1')).toBe('Which side?');
    expect(byId.get('m1')).toBe('');
    env.c.stop();
  });

  it('keeps the NEWEST questions when the seeded inbox overflows the cache', async () => {
    // `read` returns newest-first, like the real store.
    const entries = Array.from({ length: INBOX_CACHE_MAX + 10 }, (_, i) =>
      question({ id: `q${i}`, ts: NOW - 1000 - i * 1000 })
    );
    const env = setup({ sessions: [session({ id: 's1' })], entries });
    env.c.start();
    await flush();
    const ids = env.c.buildSnapshot().requests.map((r) => r.entryId);
    expect(ids).toHaveLength(INBOX_CACHE_MAX);
    expect(ids[0]).toBe('q0');
    expect(ids).not.toContain(`q${INBOX_CACHE_MAX + 9}`);
    env.c.stop();
  });

  it('ships every cached question plus every blocked agent (the renderer filters answered)', async () => {
    const entries = Array.from({ length: 30 }, (_, i) => question({ id: `q${i}`, ts: NOW - 1000 - i }));
    const env = setup({
      sessions: [session({ id: 's1' }), session({ id: 'b1' })],
      states: { b1: 'blocked' },
      entries
    });
    env.c.start();
    await flush();
    const requests = env.c.buildSnapshot().requests;
    expect(requests).toHaveLength(31);
    expect(requests.at(-1)?.id).toBe('agent:b1');
    env.c.stop();
  });
});

describe('CompanionController windows', () => {
  beforeEach(() => {
    fake.windows.length = 0;
  });

  it('enter floats the rail and hides the app windows; exit brings back exactly those', () => {
    const shown = appWindow({ visible: true });
    const minimized = appWindow({ minimized: true });
    const closed = appWindow({ visible: false });
    const env = setup({ appWindows: [shown, minimized, closed] });
    expect(env.c.enter()).toBe(true);
    const rail = partWin('rail')!;
    expect(rail.visible).toBe(true);
    expect(env.c.isActive()).toBe(true);
    expect(shown.hide).toHaveBeenCalledOnce();
    expect(minimized.hide).toHaveBeenCalledOnce();
    expect(closed.hide).not.toHaveBeenCalled();
    expect(sent(rail, IPC.companion.onSnapshot)).toHaveLength(1);

    minimized.destroyed = true;
    env.c.exit();
    expect(env.c.isActive()).toBe(false);
    expect(rail.visible).toBe(false);
    expect(env.restoreWindows).toHaveBeenCalledWith([shown]);
    expect(env.showMainWindow).toHaveBeenCalledOnce();

    // A second exit has nothing left to restore.
    env.c.exit();
    expect(env.restoreWindows).toHaveBeenLastCalledWith([]);
    env.c.stop();
  });

  it('survives a restoreWindows failure and still shows the main window', () => {
    const env = setup({ appWindows: [appWindow()] });
    env.restoreWindows.mockImplementation(() => {
      throw new Error('boom');
    });
    env.c.enter();
    expect(() => env.c.exit()).not.toThrow();
    expect(env.showMainWindow).toHaveBeenCalledOnce();
    env.c.stop();
  });

  it('puts a re-minimized window back behind a live rail, and only then', () => {
    const later = appWindow({ minimized: true });
    const env = setup({});
    env.c.hideBehindRail(later as never);
    expect(later.hide).not.toHaveBeenCalled();
    env.c.enter();
    env.c.hideBehindRail(later as never);
    expect(later.hide).toHaveBeenCalledOnce();
    env.c.exit();
    expect(env.restoreWindows).toHaveBeenCalledWith([later]);
    env.c.stop();
  });

  it('recognises its own windows and senders, and destroys them on stop', () => {
    const env = setup({});
    env.c.enter();
    env.c.openPanel('agents');
    env.c.tooltip({ label: 'x', y: 40 });
    const rail = partWin('rail')!;
    const panel = partWin('panel')!;
    expect(env.c.ownsWindow(rail as never)).toBe(true);
    expect(env.c.ownsWindow(panel as never)).toBe(true);
    expect(env.c.ownsWindow({} as never)).toBe(false);
    expect(env.c.ownsWindow(null)).toBe(false);
    expect(env.c.ownsSender(rail.webContents as never)).toBe(true);
    expect(env.c.ownsSender({ id: -1 } as never)).toBe(false);
    env.c.stop();
    expect(rail.destroyed && panel.destroyed).toBe(true);
    expect(env.c.ownsWindow(rail as never)).toBe(false);
  });

  it('turning the flag off while the rail is up restores the app', () => {
    let enabled = true;
    const env = setup({ isEnabled: () => enabled });
    env.c.enter();
    env.c.onConfigChanged();
    expect(env.c.isActive()).toBe(true);
    enabled = false;
    env.c.onConfigChanged();
    expect(env.c.isActive()).toBe(false);
    expect(env.showMainWindow).toHaveBeenCalledOnce();
    env.c.stop();
  });

  it('debounces snapshot pushes while active and never pushes while down', () => {
    vi.useFakeTimers();
    try {
      const env = setup({});
      env.c.refresh();
      env.c.enter();
      const rail = partWin('rail')!;
      const base = sent(rail, IPC.companion.onSnapshot).length;
      env.c.refresh();
      env.c.refresh();
      vi.advanceTimersByTime(150);
      expect(sent(rail, IPC.companion.onSnapshot).length).toBe(base + 1);
      env.c.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('CompanionController panel', () => {
  beforeEach(() => {
    fake.windows.length = 0;
  });

  it('opens one panel beside the rail, switches it in place, and closes it', () => {
    const env = setup({});
    env.c.enter();
    env.c.openPanel('bogus');
    expect(partWin('panel')).toBeUndefined();

    env.c.openPanel('agents', 'inbox:e1');
    const panel = partWin('panel')!;
    const rail = partWin('rail')!;
    expect(panel.visible && panel.focused).toBe(true);
    expect(env.c.getPanelState()).toMatchObject({ kind: 'agents', railSide: 'right', focusRequestId: 'inbox:e1' });
    expect(panel.bounds.x + panel.bounds.width).toBeLessThan(rail.bounds.x + RAIL_PAD);
    expect(sent(rail, IPC.companion.onPanel).at(-1)?.[0]).toMatchObject({ kind: 'agents' });

    env.c.openPanel('needs-you', 42);
    expect(partWin('panel')).toBe(panel);
    expect(env.c.getPanelState()).toMatchObject({ kind: 'needs-you', focusRequestId: undefined });

    env.c.closePanel();
    expect(panel.visible).toBe(false);
    expect(env.c.getPanelState()).toBeNull();
    expect(sent(panel, IPC.companion.onPanelClosed)).toHaveLength(1);
    expect(sent(rail, IPC.companion.onPanelClosed)).toHaveLength(1);
    env.c.stop();
  });

  it('closes on blur after a beat, unless a rail click re-opens it first', () => {
    vi.useFakeTimers();
    try {
      const env = setup({});
      env.c.enter();
      env.c.openPanel('agents');
      const panel = partWin('panel')!;
      panel.emit('blur');
      env.c.openPanel('scheduler');
      vi.advanceTimersByTime(200);
      expect(env.c.getPanelState()?.kind).toBe('scheduler');
      panel.emit('blur');
      panel.emit('blur');
      vi.advanceTimersByTime(200);
      expect(env.c.getPanelState()).toBeNull();
      expect(panel.visible).toBe(false);
      env.c.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-fits an open panel when the displays change, keeping its kind', async () => {
    const { screen } = (await import('electron')) as unknown as { screen: EventEmitter };
    const env = setup({});
    env.c.start();
    env.c.enter();
    env.c.openPanel('status');
    const panel = partWin('panel')!;
    const before = sent(panel, IPC.companion.onPanel).length;
    env.deps.getPlacement = () => ({ edge: 'left' });
    screen.emit('display-metrics-changed');
    expect(sent(panel, IPC.companion.onPanel).length).toBe(before + 1);
    expect(env.c.getPanelState()).toMatchObject({ kind: 'status', railSide: 'left' });
    expect(panel.bounds.x).toBeGreaterThan(partWin('rail')!.bounds.x);
    env.c.stop();
  });

  it('a closed panel window is recreated on the next open', () => {
    const env = setup({});
    env.c.enter();
    env.c.openPanel('agents');
    const first = partWin('panel')!;
    first.destroy();
    env.c.openPanel('agents');
    expect(partWin('panel')).not.toBe(first);
    env.c.stop();
  });
});

describe('CompanionController tooltip', () => {
  beforeEach(() => {
    fake.windows.length = 0;
  });

  it('floats a click-through tooltip beside the icon and hides it on demand', () => {
    const env = setup({});
    env.c.enter();
    env.c.tooltip({ label: '  Agents  ', detail: '2 working', y: 60 });
    const tip = partWin('tooltip')!;
    expect(tip.visible && tip.ignoreMouse).toBe(true);
    expect(env.c.getTooltip()).toEqual({ label: 'Agents', detail: '2 working', side: 'right', theme: 'light' });
    expect(sent(tip, IPC.companion.onTooltip).at(-1)?.[0]).toMatchObject({ label: 'Agents' });

    env.c.tooltip(null);
    expect(tip.visible).toBe(false);
    expect(env.c.getTooltip()).toBeNull();
    expect(sent(tip, IPC.companion.onTooltip).at(-1)?.[0]).toBeNull();
    env.c.stop();
  });

  it('stays hidden while a panel is open', () => {
    const env = setup({});
    env.c.enter();
    env.c.openPanel('agents');
    env.c.tooltip({ label: 'Agents', y: 60 });
    expect(partWin('tooltip')).toBeUndefined();
    env.c.stop();
  });
});

describe('CompanionController drag', () => {
  beforeEach(() => {
    fake.windows.length = 0;
  });

  it('follows the cursor, then snaps to the nearer edge and saves the placement', () => {
    vi.useFakeTimers();
    try {
      const env = setup({});
      env.c.enter();
      env.c.openPanel('agents');
      const rail = partWin('rail')!;
      fake.cursor = { x: rail.bounds.x + 5, y: rail.bounds.y + 5 };
      env.c.dragStart();
      env.c.dragStart(); // idempotent while dragging
      expect(env.c.getPanelState()).toBeNull();
      env.c.tooltip({ label: 'x', y: 40 });
      expect(partWin('tooltip')).toBeUndefined();

      fake.cursor = { x: 205, y: 305 };
      vi.advanceTimersByTime(20);
      expect(rail.bounds).toMatchObject({ x: 200, y: 300 });

      env.c.dragEnd();
      expect(env.deps.savePlacement).toHaveBeenCalledWith({ edge: 'left', displayId: 1, offsetY: 300 + RAIL_PAD - 25 });
      env.c.dragEnd(); // no drag in flight → no second save
      expect(env.deps.savePlacement).toHaveBeenCalledOnce();
      env.c.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('self-ends a drag whose pointerup never arrives', () => {
    vi.useFakeTimers();
    let now = NOW;
    try {
      const env = setup({});
      env.deps.now = () => now;
      env.c.enter();
      env.c.dragStart();
      now += 61_000;
      vi.advanceTimersByTime(20);
      expect(env.deps.savePlacement).toHaveBeenCalledOnce();
      env.c.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs a failed placement save instead of throwing', () => {
    vi.useFakeTimers();
    try {
      const logger = vi.fn();
      const env = setup({});
      env.deps.logger = logger;
      env.deps.savePlacement = () => {
        throw new Error('disk full');
      };
      env.c.enter();
      env.c.dragStart();
      expect(() => env.c.dragEnd()).not.toThrow();
      expect(logger).toHaveBeenCalledWith('companion.savePlacement', expect.any(Error));
      env.c.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
