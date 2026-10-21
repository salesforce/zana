// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CompanionTooltipView } from '@zana-ai/zcc-domain/product';

const h = vi.hoisted(() => ({
  onTooltip: vi.fn(),
  tooltipState: vi.fn(),
  off: vi.fn(),
  request: vi.fn(),
  onSnapshot: vi.fn(),
  onPanel: vi.fn(),
  onPanelClosed: vi.fn(),
  panelState: vi.fn()
}));
vi.mock('../../lib/product-client.js', () => ({ product: { companion: h } }));
import { Companion } from './Companion.js';
import { CompanionTooltip } from './CompanionTooltip.js';

let push: (t: CompanionTooltipView | null) => void;
const view = (over: Partial<CompanionTooltipView> = {}): CompanionTooltipView => ({
  label: 'Agents',
  detail: '2 working',
  side: 'right',
  theme: 'light',
  ...over
});

beforeEach(() => {
  h.off.mockReset();
  h.tooltipState.mockReset().mockResolvedValue(null);
  h.onTooltip.mockReset().mockImplementation((cb: typeof push) => {
    push = cb;
    return h.off;
  });
  h.request.mockReset().mockResolvedValue(null);
  h.onSnapshot.mockReset().mockReturnValue(() => undefined);
  h.onPanel.mockReset().mockReturnValue(() => undefined);
  h.onPanelClosed.mockReset().mockReturnValue(() => undefined);
  h.panelState.mockReset().mockResolvedValue(null);
});
afterEach(cleanup);

it('renders nothing until a tooltip is pushed, then draws it and clears on null', async () => {
  const { container } = render(<CompanionTooltip />);
  await act(async () => {});
  expect(container.firstChild).toBeNull();
  act(() => push(view()));
  expect(screen.getByRole('tooltip').textContent).toContain('Agents');
  expect(screen.getByText('2 working')).toBeTruthy();
  expect(container.querySelector('.cc-rail-right')).toBeTruthy();
  expect(document.documentElement.dataset.theme).toBe('light');
  act(() => push(view({ detail: undefined, side: 'left', theme: 'dark' })));
  expect(container.querySelector('.cc-tip-detail')).toBeNull();
  expect(document.documentElement.dataset.theme).toBe('dark');
  act(() => push(null));
  expect(container.firstChild).toBeNull();
});

it('pulls the already-showing tooltip on mount without clobbering a pushed one', async () => {
  h.tooltipState.mockResolvedValue(view({ label: 'Pulled' }));
  render(<CompanionTooltip />);
  await act(async () => {});
  expect(screen.getByText('Pulled')).toBeTruthy();
});

it('keeps a pushed tooltip when the pulled state arrives later', async () => {
  let resolve!: (v: CompanionTooltipView) => void;
  h.tooltipState.mockReturnValue(new Promise((r) => (resolve = r)));
  render(<CompanionTooltip />);
  act(() => push(view({ label: 'Pushed' })));
  await act(async () => resolve(view({ label: 'Pulled' })));
  expect(screen.getByText('Pushed')).toBeTruthy();
  expect(screen.queryByText('Pulled')).toBeNull();
});

it('unsubscribes on unmount', () => {
  render(<CompanionTooltip />).unmount();
  expect(h.off).toHaveBeenCalled();
});

it('Companion routes ?part= to the right window', async () => {
  const a = render(<Companion part="tooltip" />);
  await act(async () => {});
  expect(h.onTooltip).toHaveBeenCalled();
  a.unmount();
  const b = render(<Companion part="panel" />);
  await act(async () => {});
  expect(h.panelState).toHaveBeenCalled();
  b.unmount();
  render(<Companion part={null} />);
  expect(screen.getByRole('navigation', { name: 'Command Center' })).toBeTruthy();
});
