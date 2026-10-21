// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  CompanionAgent,
  CompanionPanelState,
  CompanionRequest,
  CompanionSchedule,
  CompanionSnapshot
} from '@zana-ai/zcc-domain/product';

const h = vi.hoisted(() => ({
  request: vi.fn(),
  onSnapshot: vi.fn(),
  onPanel: vi.fn(),
  onPanelClosed: vi.fn(),
  panelState: vi.fn(),
  closePanel: vi.fn(),
  open: vi.fn(),
  exit: vi.fn(),
  runSchedule: vi.fn(),
  answer: vi.fn()
}));
vi.mock('../../lib/product-client.js', () => ({ product: { companion: h } }));
import { CompanionPanel } from './CompanionPanel.js';
import { EMPTY_SNAPSHOT } from './useCompanion.js';

let pushSnap: (s: CompanionSnapshot) => void;
let pushPanel: (s: CompanionPanelState) => void;
let pushClosed: () => void;
let roCallback: () => void;

const NOW = 1_700_000_000_000;
const st = (kind: CompanionPanelState['kind'], over: Partial<CompanionPanelState> = {}): CompanionPanelState => ({
  kind,
  railSide: 'right',
  anchorY: 100,
  ...over
});
const req = (n: number, over: Partial<CompanionRequest> = {}): CompanionRequest => ({
  id: `inbox:e${n}`,
  kind: 'question',
  entryId: `e${n}`,
  sessionId: `s${n}`,
  projectId: 'p',
  projectName: 'Proj',
  agentTitle: `Agent${n}`,
  prompt: `Prompt${n}`,
  questions: [{ options: [{ id: 'A', label: 'Yes' }] }],
  ts: NOW - 5 * 60_000,
  answerable: true,
  ...over
});
const agent = (n: number, over: Partial<CompanionAgent> = {}): CompanionAgent => ({
  sessionId: `a${n}`,
  projectId: 'p',
  projectName: 'Proj',
  title: `Worker${n}`,
  state: 'idle',
  createdAt: NOW - 2 * 3600_000,
  recentlyCompleted: false,
  ...over
});
const sched = (n: number, over: Partial<CompanionSchedule> = {}): CompanionSchedule => ({
  id: `t${n}`,
  name: `Task${n}`,
  projectId: 'p',
  projectName: 'Proj',
  enabled: true,
  running: false,
  nextRunAt: null,
  ...over
});
const snap = (over: Partial<CompanionSnapshot> = {}): CompanionSnapshot => ({ ...EMPTY_SNAPSHOT, ...over });

async function mount(s: CompanionSnapshot, state: CompanionPanelState | null) {
  h.request.mockResolvedValue(s);
  h.panelState.mockResolvedValue(state);
  const r = render(<CompanionPanel />);
  await act(async () => {});
  return r;
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  for (const k of Object.keys(h)) (h as Record<string, ReturnType<typeof vi.fn>>)[k].mockReset();
  h.onSnapshot.mockImplementation((cb: typeof pushSnap) => ((pushSnap = cb), () => undefined));
  h.onPanel.mockImplementation((cb: typeof pushPanel) => ((pushPanel = cb), () => undefined));
  h.onPanelClosed.mockImplementation((cb: typeof pushClosed) => ((pushClosed = cb), () => undefined));
  h.closePanel.mockResolvedValue(undefined);
  h.open.mockResolvedValue(undefined);
  h.exit.mockResolvedValue(undefined);
  h.runSchedule.mockResolvedValue(true);
  h.answer.mockResolvedValue({ ok: true });
  localStorage.clear();
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    constructor(cb: () => void) {
      roCallback = cb;
    }
    observe() {}
    disconnect() {}
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('renders nothing until main reports a panel state', async () => {
  const { container } = await mount(snap(), null);
  expect(container.firstChild).toBeNull();
  act(() => pushPanel(st('status')));
  expect(screen.getByRole('dialog', { name: 'Status' })).toBeTruthy();
});

it('positions the card at the anchor, clamped to the window, and re-places on resize', async () => {
  const { container } = await mount(snap(), st('status', { anchorY: 5000 }));
  const card = container.querySelector('.cc-card') as HTMLElement;
  Object.defineProperty(card, 'offsetHeight', { configurable: true, value: 200 });
  act(() => roCallback());
  expect(card.style.top).toBe(`${window.innerHeight - 200 - 8}px`);
  act(() => pushPanel(st('status', { anchorY: 0 })));
  expect(card.style.top).toBe('8px');
});

it('needs-you: empty state, then lists requests with age and question count', async () => {
  await mount(snap({ counts: { ...EMPTY_SNAPSHOT.counts, working: 2 } }), st('needs-you'));
  expect(screen.getByText('All clear')).toBeTruthy();
  expect(screen.getByText('2 agents working')).toBeTruthy();
  act(() =>
    pushSnap(
      snap({
        requests: [
          req(1),
          req(2, {
            prompt: '',
            questions: [{ options: [] }, { options: [] }]
          })
        ],
        counts: { ...EMPTY_SNAPSHOT.counts, working: 1 }
      })
    )
  );
  expect(screen.getByText('Prompt1')).toBeTruthy();
  expect(screen.getByText('Waiting for your input')).toBeTruthy();
  expect(screen.getByText(/Proj · 5m$/)).toBeTruthy();
  expect(screen.getByText(/2 questions/)).toBeTruthy();
});

it('all-clear wording for one / zero working agents', async () => {
  await mount(snap({ counts: { ...EMPTY_SNAPSHOT.counts, working: 1 } }), st('needs-you'));
  expect(screen.getByText('1 agent working')).toBeTruthy();
  act(() => pushSnap(snap()));
  expect(screen.getByText('Nothing needs you')).toBeTruthy();
});

it('drills into a question, Esc goes back to the list, Esc again closes the panel', async () => {
  await mount(snap({ requests: [req(1), req(2)] }), st('needs-you'));
  fireEvent.click(screen.getByText('Prompt1'));
  expect(document.querySelector('.cc-card.is-expanded')).toBeTruthy();
  fireEvent.keyDown(window, { key: 'a' });
  expect(h.closePanel).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(document.querySelector('.cc-card.is-expanded')).toBeNull();
  expect(h.closePanel).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(h.closePanel).toHaveBeenCalledOnce();
});

it('a focusRequestId opens the question straight away; a same-kind relayout keeps it', async () => {
  await mount(snap({ requests: [req(1)] }), st('needs-you', { focusRequestId: 'inbox:e1' }));
  expect(document.querySelector('.cc-card.is-expanded')).toBeTruthy();
  act(() => pushPanel(st('needs-you', { anchorY: 50 })));
  expect(document.querySelector('.cc-card.is-expanded')).toBeTruthy();
  act(() => pushPanel(st('agents')));
  expect(screen.getByRole('dialog', { name: 'Agents' })).toBeTruthy();
  act(() => pushPanel(st('needs-you')));
  expect(document.querySelector('.cc-card.is-expanded')).toBeNull();
});

it('a focused request that is no longer pending falls back to the list', async () => {
  await mount(snap(), st('needs-you', { focusRequestId: 'inbox:gone' }));
  expect(screen.getByText('All clear')).toBeTruthy();
});

it('the question back button returns to the list', async () => {
  await mount(snap({ requests: [req(1)] }), st('needs-you', { focusRequestId: 'inbox:e1' }));
  fireEvent.click(screen.getByRole('button', { name: /back/i }));
  expect(screen.getByText('Prompt1')).toBeTruthy();
});

it('answering the last question resolves it and closes the panel after a beat', async () => {
  await mount(snap({ requests: [req(1)] }), st('needs-you', { focusRequestId: 'inbox:e1' }));
  fireEvent.click(screen.getByRole('button', { name: /Yes/ }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  });
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(h.answer).toHaveBeenCalledWith('inbox:e1', 'Yes');
  expect(localStorage.getItem('zcc.inbox-answered.v1')).toContain('e1');
  expect(screen.getByText('All clear')).toBeTruthy();
  act(() => {
    vi.advanceTimersByTime(250);
  });
  expect(h.closePanel).toHaveBeenCalledOnce();
});

it('answering with others still pending keeps the panel open', async () => {
  await mount(snap({ requests: [req(1), req(2)] }), st('needs-you', { focusRequestId: 'inbox:e1' }));
  fireEvent.click(screen.getByRole('button', { name: /Yes/ }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  });
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  expect(h.closePanel).not.toHaveBeenCalled();
  expect(screen.getByText('Prompt2')).toBeTruthy();
});

it('clicking the transparent stage closes; clicking the card does not', async () => {
  const { container } = await mount(snap(), st('status'));
  fireEvent.mouseDown(screen.getByRole('dialog'));
  expect(h.closePanel).not.toHaveBeenCalled();
  fireEvent.mouseDown(container.querySelector('.cc-panel-stage')!);
  expect(h.closePanel).toHaveBeenCalledOnce();
  expect(container.querySelector('.cc-panel-stage.cc-rail-right')).toBeTruthy();
});

it('panelClosed clears the panel', async () => {
  const { container } = await mount(snap(), st('status'));
  act(() => pushClosed());
  expect(container.firstChild).toBeNull();
});

it('agents: empty state, New agent and Open Agents', async () => {
  await mount(snap(), st('agents'));
  expect(screen.getByText('No agents running.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'New agent' }));
  expect(h.open).toHaveBeenLastCalledWith({ kind: 'home' });
  fireEvent.click(screen.getByRole('button', { name: 'Open Agents' }));
  expect(h.open).toHaveBeenLastCalledWith({ kind: 'agents' });
});

it('agents: groups needs-you / working / idle and opens a session', async () => {
  await mount(
    snap({
      requests: [req(1, { sessionId: 'a3' })],
      agents: [
        agent(1, { state: 'blocked' }),
        agent(2, { state: 'working', createdAt: NOW - 10 * 60_000 }),
        agent(3),
        agent(4, { recentlyCompleted: true })
      ]
    }),
    st('agents')
  );
  const groups = document.querySelectorAll('.cc-group');
  expect(groups).toHaveLength(3);
  expect(within(groups[0] as HTMLElement).getByText('Worker1')).toBeTruthy();
  expect(within(groups[0] as HTMLElement).getByText('Worker3')).toBeTruthy(); // asking via pending request
  expect(screen.getByText(/Working · Proj · 10m/)).toBeTruthy();
  expect(screen.getByText(/Completed · Proj/)).toBeTruthy();
  fireEvent.click(screen.getByTitle('Worker2 — Working'));
  expect(h.open).toHaveBeenLastCalledWith({ kind: 'session', sessionId: 'a2' });
});

it('agents: a Modern thread row opens the thread', async () => {
  await mount(snap({ agents: [agent(5, { sessionId: 'thread:t5', threadId: 't5', state: 'working' })] }), st('agents'));
  fireEvent.click(screen.getByTitle('Worker5 — Working'));
  expect(h.open).toHaveBeenLastCalledWith({ kind: 'thread', threadId: 't5' });
});

it('agents: omits empty groups', async () => {
  await mount(snap({ agents: [agent(1)] }), st('agents'));
  expect(document.querySelectorAll('.cc-group')).toHaveLength(1);
});

it('scheduler: empty state and Open Scheduler', async () => {
  await mount(snap(), st('scheduler'));
  expect(screen.getByText('No schedules yet.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open Scheduler' }));
  expect(h.open).toHaveBeenLastCalledWith({ kind: 'scheduler' });
});

it('scheduler: statuses, running count, row open target, failed highlight', async () => {
  await mount(
    snap({
      schedules: [
        sched(1, { running: true }),
        sched(2, { enabled: false }),
        sched(3, { lastResult: 'error', lastRunAt: new Date(NOW - 3600_000).toISOString() }),
        sched(4, { nextRunAt: new Date(NOW + 2 * 3600_000).toISOString() })
      ]
    }),
    st('scheduler')
  );
  expect(screen.getByText(/^Running · Proj/)).toBeTruthy();
  expect(screen.getByText(/^Paused/)).toBeTruthy();
  expect(screen.getByText(/Last run failed 1h ago/)).toBeTruthy();
  expect(screen.getByText(/^in 2h/)).toBeTruthy();
  expect(document.querySelectorAll('.cc-dot-attention')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Run Task1 now' })).toBeNull();
  fireEvent.click(screen.getByText('Task2'));
  expect(h.open).toHaveBeenLastCalledWith({ kind: 'scheduler', taskId: 't2' });
});

it('scheduler: Run now shows Starting…, then clears once the run appears', async () => {
  await mount(snap({ schedules: [sched(1)] }), st('scheduler'));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Run Task1 now' }));
  });
  expect(h.runSchedule).toHaveBeenCalledWith('t1');
  expect(screen.getByText(/Starting…/)).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Run Task1 now' }) as HTMLButtonElement).disabled).toBe(true);
  act(() => pushSnap(snap({ schedules: [sched(1, { running: true })] })));
  expect(screen.getByText(/^Running/)).toBeTruthy();
});

it('scheduler: Starting… gives up after the grace window', async () => {
  await mount(snap({ schedules: [sched(1)] }), st('scheduler'));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Run Task1 now' }));
  });
  act(() => {
    vi.advanceTimersByTime(30_000); // useNow tick re-evaluates the grace
  });
  expect(screen.queryByText(/Starting…/)).toBeNull();
});

it('scheduler: a refused (false) or rejected run shows an error and can retry', async () => {
  h.runSchedule.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('x')).mockResolvedValue(true);
  await mount(snap({ schedules: [sched(1)] }), st('scheduler'));
  const run = () =>
    act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run Task1 now' }));
    });
  await run();
  expect(screen.getByText(/Couldn't start/)).toBeTruthy();
  expect(screen.queryByText(/Starting…/)).toBeNull();
  await run();
  expect(screen.getByText(/Couldn't start/)).toBeTruthy();
  await run();
  expect(screen.queryByText(/Couldn't start/)).toBeNull();
  expect(screen.getByText(/Starting…/)).toBeTruthy();
});

it('status: clear and pending variants, Open Zana and Exit', async () => {
  await mount(
    snap({ userInitials: 'PC', counts: { blocked: 0, working: 3, idle: 1, recentlyCompleted: 0, runningSchedules: 2 } }),
    st('status')
  );
  expect(screen.getByText('All clear')).toBeTruthy();
  expect(screen.getByText('PC')).toBeTruthy();
  expect(screen.getByText('3 working · 1 idle · 2 scheduled running')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open Zana' }));
  expect(h.open).toHaveBeenLastCalledWith({ kind: 'main' });
  fireEvent.click(screen.getByRole('button', { name: 'Exit Command Center' }));
  expect(h.exit).toHaveBeenCalledOnce();
  act(() => pushSnap(snap({ requests: [req(1)] })));
  expect(screen.getByText('1 needs you')).toBeTruthy();
  expect(screen.getByText('·')).toBeTruthy();
  act(() => pushSnap(snap({ requests: [req(1), req(2)] })));
  expect(screen.getByText('2 need you')).toBeTruthy();
});
