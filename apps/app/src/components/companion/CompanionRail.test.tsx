// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CompanionPanelState, CompanionRequest, CompanionSnapshot } from '@zana-ai/zcc-domain/product';

const h = vi.hoisted(() => ({
  request: vi.fn(),
  onSnapshot: vi.fn(),
  onPanel: vi.fn(),
  onPanelClosed: vi.fn(),
  openPanel: vi.fn(),
  closePanel: vi.fn(),
  tooltip: vi.fn(),
  dragStart: vi.fn(),
  dragEnd: vi.fn(),
  exit: vi.fn()
}));
vi.mock('../../lib/product-client.js', () => ({ product: { companion: h } }));
import { CompanionRail } from './CompanionRail.js';
import { EMPTY_SNAPSHOT } from './useCompanion.js';

let pushSnap: (s: CompanionSnapshot) => void;
let pushPanel: (s: CompanionPanelState) => void;
let pushClosed: () => void;

const req = (n: number): CompanionRequest => ({
  id: `inbox:e${n}`,
  kind: 'question',
  entryId: `e${n}`,
  projectId: 'p',
  projectName: 'P',
  agentTitle: 'A',
  prompt: 'q',
  ts: 0,
  answerable: true
});
const snap = (over: Partial<CompanionSnapshot> = {}): CompanionSnapshot => ({ ...EMPTY_SNAPSHOT, ...over });

async function mount(s: CompanionSnapshot = snap()) {
  h.request.mockResolvedValue(s);
  const r = render(<CompanionRail />);
  await act(async () => {});
  return r;
}

beforeEach(() => {
  vi.useFakeTimers();
  for (const k of Object.keys(h)) (h as Record<string, ReturnType<typeof vi.fn>>)[k].mockReset();
  h.request.mockResolvedValue(null);
  h.onSnapshot.mockImplementation((cb: typeof pushSnap) => ((pushSnap = cb), () => undefined));
  h.onPanel.mockImplementation((cb: typeof pushPanel) => ((pushPanel = cb), () => undefined));
  h.onPanelClosed.mockImplementation((cb: typeof pushClosed) => ((pushClosed = cb), () => undefined));
  h.openPanel.mockResolvedValue(undefined);
  h.closePanel.mockResolvedValue(undefined);
  h.tooltip.mockResolvedValue(undefined);
  h.dragStart.mockResolvedValue(undefined);
  h.dragEnd.mockResolvedValue(undefined);
  h.exit.mockResolvedValue(undefined);
  // happy-dom lacks pointer capture
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const btn = (re: RegExp) => screen.getByRole('button', { name: re });

it('opens each panel kind from its icon, with idle labels', async () => {
  await mount();
  fireEvent.click(btn(/^Needs you: Nothing needs attention/));
  expect(h.openPanel).toHaveBeenLastCalledWith('needs-you', undefined);
  fireEvent.click(btn(/^Agents: 0 working · 0 idle/));
  expect(h.openPanel).toHaveBeenLastCalledWith('agents', undefined);
  fireEvent.click(btn(/^Scheduler: 0 schedules/));
  expect(h.openPanel).toHaveBeenLastCalledWith('scheduler', undefined);
  fireEvent.click(btn(/^Status: All clear/));
  expect(h.openPanel).toHaveBeenLastCalledWith('status', undefined);
  expect(screen.getByText('·')).toBeTruthy();
});

it('toggles closed when the active panel icon is clicked again, and tracks panel push/close', async () => {
  await mount();
  act(() => pushPanel({ kind: 'agents', railSide: 'right', anchorY: 0 }));
  const agents = btn(/^Agents:/);
  expect(agents.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(agents);
  expect(h.closePanel).toHaveBeenCalledOnce();
  expect(h.openPanel).not.toHaveBeenCalled();
  act(() => pushClosed());
  expect(btn(/^Agents:/).getAttribute('aria-pressed')).toBe('false');
});

it('keeps an Agents hover passive until clicking pins it, then toggles closed normally', async () => {
  await mount();
  const agents = btn(/^Agents:/);
  fireEvent.mouseEnter(agents);
  act(() => vi.advanceTimersByTime(350));
  expect(h.tooltip).toHaveBeenLastCalledWith(expect.objectContaining({ panel: 'agents' }));
  act(() => pushPanel({ kind: 'agents', preview: true, railSide: 'right', anchorY: 0 }));
  expect(agents.getAttribute('aria-pressed')).toBe('false');
  expect(h.tooltip).not.toHaveBeenCalledWith(null);
  fireEvent.pointerDown(agents, { button: 0, screenX: 10, screenY: 10 });
  expect(h.tooltip).not.toHaveBeenCalledWith(null);
  fireEvent.pointerUp(agents);
  fireEvent.click(agents);
  expect(h.openPanel).toHaveBeenCalledWith('agents', undefined);
  expect(h.closePanel).not.toHaveBeenCalled();
  act(() => pushPanel({ kind: 'agents', preview: false, railSide: 'right', anchorY: 0 }));
  expect(agents.getAttribute('aria-pressed')).toBe('true');
  expect(h.tooltip).toHaveBeenLastCalledWith(null);
  fireEvent.mouseLeave(agents);
  act(() => vi.advanceTimersByTime(100));
  expect(h.closePanel).not.toHaveBeenCalled();
  fireEvent.click(agents);
  expect(h.closePanel).toHaveBeenCalledOnce();
});

it('shows the pending badge (9+ cap), pulses once, and opens the first request', async () => {
  const many = Array.from({ length: 10 }, (_, i) => req(i));
  await mount(snap({ requests: many, userInitials: 'PC', counts: { ...EMPTY_SNAPSHOT.counts, runningSchedules: 2 }, schedules: [] }));
  const badge = screen.getByRole('button', { name: /10 pending/ });
  expect(badge.textContent).toBe('9+');
  expect(badge.className).toContain('cc-pulse');
  act(() => {
    vi.advanceTimersByTime(1600);
  });
  expect(badge.className).not.toContain('cc-pulse');
  fireEvent.click(badge);
  expect(h.openPanel).toHaveBeenCalledWith('needs-you', 'inbox:e0');
  expect(screen.getByText('PC')).toBeTruthy();
  expect(btn(/^Scheduler: 2 running/)).toBeTruthy();
  expect(btn(/^Status: 10 need attention/)).toBeTruthy();
  // active needs-you + badge click still re-opens with focus instead of closing
  act(() => pushPanel({ kind: 'needs-you', railSide: 'right', anchorY: 0 }));
  fireEvent.click(screen.getByRole('button', { name: /10 pending/ }));
  expect(h.closePanel).not.toHaveBeenCalled();
});

it('shows exact counts under 10 and re-pulses when attention grows', async () => {
  await mount(snap({ requests: [req(1)] }));
  expect(screen.getByRole('button', { name: /1 pending/ }).textContent).toBe('1');
  act(() => pushSnap(snap({ requests: [req(1), req(2)] })));
  expect(screen.getByRole('button', { name: /2 pending/ }).className).toContain('cc-pulse');
  act(() => {
    vi.advanceTimersByTime(1600);
  });
  expect(screen.getByRole('button', { name: /2 pending/ }).className).not.toContain('cc-pulse');
  act(() => pushSnap(snap({ requests: [req(1)] })));
  expect(screen.getByRole('button', { name: /1 pending/ }).className).not.toContain('cc-pulse');
});

it('a shrink mid-pulse stops the pulse instead of leaving it stuck', async () => {
  await mount(snap({ requests: [req(1)] }));
  act(() => pushSnap(snap({ requests: [req(1), req(2), req(3)] })));
  expect(screen.getByRole('button', { name: /3 pending/ }).className).toContain('cc-pulse');
  act(() => pushSnap(snap({ requests: [req(1), req(2)] })));
  expect(screen.getByRole('button', { name: /2 pending/ }).className).not.toContain('cc-pulse');
});

it('the logo exits Command Center', async () => {
  const { container } = await mount();
  // The shipped glyph asset resolves (a missing file once rendered a broken image).
  expect((container.querySelector('img.cc-rail-glyph') as HTMLImageElement).getAttribute('src')).toMatch(/zana-favicon|^data:image\/svg/);
  fireEvent.click(btn(/Open the full window/));
  expect(h.exit).toHaveBeenCalledOnce();
});

it('hover shows a tooltip after a delay, then instantly for the next icon, and hides on leave', async () => {
  await mount();
  const agents = btn(/^Agents:/);
  fireEvent.mouseEnter(agents);
  expect(h.tooltip).not.toHaveBeenCalled();
  act(() => {
    vi.advanceTimersByTime(350);
  });
  expect(h.tooltip).toHaveBeenCalledWith({ label: 'Agents', detail: '0 working · 0 idle', panel: 'agents', y: 0 });
  fireEvent.mouseLeave(agents);
  fireEvent.mouseEnter(btn(/^Scheduler:/));
  expect(h.tooltip).toHaveBeenLastCalledWith(expect.objectContaining({ label: 'Scheduler' }));
  fireEvent.mouseLeave(btn(/^Scheduler:/));
  act(() => {
    vi.advanceTimersByTime(90);
  });
  expect(h.tooltip).toHaveBeenLastCalledWith(null);
});

it('leaving before the delay cancels the tooltip without sending null', async () => {
  await mount();
  const agents = btn(/^Agents:/);
  fireEvent.mouseEnter(agents);
  fireEvent.mouseLeave(agents);
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(h.tooltip).not.toHaveBeenCalled();
});

it('suppresses tooltips while a panel is open and hides a showing one when it opens', async () => {
  await mount();
  const agents = btn(/^Agents:/);
  fireEvent.mouseEnter(agents);
  act(() => {
    vi.advanceTimersByTime(350);
  });
  h.tooltip.mockClear();
  act(() => pushPanel({ kind: 'status', railSide: 'right', anchorY: 0 }));
  expect(h.tooltip).toHaveBeenCalledWith(null);
  h.tooltip.mockClear();
  fireEvent.mouseEnter(btn(/^Scheduler:/));
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(h.tooltip).not.toHaveBeenCalled();
});

it('unmounting hides a showing tooltip', async () => {
  const { unmount } = await mount();
  fireEvent.mouseEnter(btn(/^Agents:/));
  act(() => {
    vi.advanceTimersByTime(350);
  });
  h.tooltip.mockClear();
  unmount();
  expect(h.tooltip).toHaveBeenCalledWith(null);
});

it('drags past the threshold: dragStart/dragEnd, click suppressed, no tooltip', async () => {
  await mount();
  const nav = screen.getByRole('navigation');
  const agents = btn(/^Agents:/);
  fireEvent.pointerDown(nav, { button: 0, screenX: 10, screenY: 10, pointerId: 1 });
  fireEvent.pointerMove(nav, { screenX: 12, screenY: 11, pointerId: 1 });
  expect(h.dragStart).not.toHaveBeenCalled();
  fireEvent.pointerMove(nav, { screenX: 30, screenY: 10, pointerId: 1 });
  expect(h.dragStart).toHaveBeenCalledOnce();
  fireEvent.pointerMove(nav, { screenX: 50, screenY: 10, pointerId: 1 });
  expect(h.dragStart).toHaveBeenCalledOnce();
  fireEvent.mouseEnter(agents);
  act(() => {
    vi.advanceTimersByTime(500);
  });
  expect(h.tooltip).not.toHaveBeenCalled();
  fireEvent.pointerUp(nav, { pointerId: 1 });
  expect(h.dragEnd).toHaveBeenCalledOnce();
  fireEvent.click(agents);
  fireEvent.click(btn(/Open the full window/));
  expect(h.openPanel).not.toHaveBeenCalled();
  expect(h.exit).not.toHaveBeenCalled();
  act(() => {
    vi.advanceTimersByTime(1);
  });
  fireEvent.click(agents);
  expect(h.openPanel).toHaveBeenCalledWith('agents', undefined);
});

it('a plain press-release is not a drag; non-primary buttons and stray moves are ignored', async () => {
  await mount();
  const nav = screen.getByRole('navigation');
  fireEvent.pointerMove(nav, { screenX: 100, screenY: 100 });
  fireEvent.pointerDown(nav, { button: 2, screenX: 0, screenY: 0 });
  fireEvent.pointerMove(nav, { screenX: 50, screenY: 50 });
  fireEvent.pointerDown(nav, { button: 0, screenX: 0, screenY: 0 });
  fireEvent.pointerUp(nav);
  fireEvent.pointerCancel(nav);
  expect(h.dragStart).not.toHaveBeenCalled();
  expect(h.dragEnd).not.toHaveBeenCalled();
});

it('renders agent attention/working/done dots and the edge class', async () => {
  const c = EMPTY_SNAPSHOT.counts;
  const { container, rerender } = await mount(snap({ edge: 'left', counts: { ...c, blocked: 1 } }));
  expect(container.querySelector('.cc-rail-stage.cc-edge-left')).toBeTruthy();
  expect(container.querySelector('.cc-dot-attention')).toBeTruthy();
  act(() => pushSnap(snap({ counts: { ...c, working: 1, runningSchedules: 1 } })));
  expect(container.querySelectorAll('.cc-dot-working').length).toBe(3); // agents, scheduler, status
  act(() => pushSnap(snap({ counts: { ...c, recentlyCompleted: 1 } })));
  expect(container.querySelector('.cc-dot-done')).toBeTruthy();
  rerender(<CompanionRail />);
});

it('reports rejected panel and exit actions and retries without optimistic panel state', async () => {
  await mount();
  h.openPanel.mockRejectedValueOnce(new Error('IPC closed'));
  await act(async () => fireEvent.click(btn(/^Agents:/)));
  expect(screen.getByRole('alert').textContent).toContain('Could not open the panel');
  expect(btn(/^Agents:/).getAttribute('aria-pressed')).toBe('false');
  await act(async () => fireEvent.click(btn(/^Agents:/)));
  expect(screen.queryByRole('alert')).toBeNull();
  h.exit.mockRejectedValueOnce(new Error('IPC closed'));
  await act(async () => fireEvent.click(btn(/Open the full window/)));
  expect(screen.getByRole('alert').textContent).toContain('Could not open Zana');
});

it('recovers local dragging state after drag start rejects', async () => {
  const { container } = await mount();
  h.dragStart.mockRejectedValueOnce(new Error('IPC closed'));
  const rail = container.querySelector('.cc-rail')!;
  fireEvent.pointerDown(rail, { button: 0, screenX: 20, screenY: 20, pointerId: 1 });
  await act(async () => fireEvent.pointerMove(rail, { screenX: 30, screenY: 30, pointerId: 1 }));
  expect(screen.getByRole('alert').textContent).toContain('Could not move the rail');
  fireEvent.click(btn(/^Agents:/));
  expect(h.openPanel).toHaveBeenCalledOnce();
});

it('owns rejected show and hide tooltip commands', async () => {
  await mount();
  h.tooltip.mockRejectedValueOnce(new Error('IPC closed'));
  fireEvent.mouseEnter(btn(/^Agents:/));
  await act(async () => vi.advanceTimersByTime(350));
  fireEvent.mouseEnter(btn(/^Scheduler:/));
  act(() => vi.advanceTimersByTime(350));
  h.tooltip.mockRejectedValueOnce(new Error('IPC closed'));
  fireEvent.mouseLeave(btn(/^Scheduler:/));
  await act(async () => vi.advanceTimersByTime(90));
  expect(h.tooltip).toHaveBeenLastCalledWith(null);
});
