// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ThreadDetailActions, ThreadDetailHeading } from './thread/timeline/ThreadBanners.js';
import { MOBILE_THREAD_ACTIONS_ID, MOBILE_THREAD_CONTROLS_ID, MOBILE_THREAD_TITLE_ID, useMobileThreadActionsTarget, useMobileThreadControlsTarget, useMobileThreadTitleTarget } from './useMobileThreadTitleTarget.js';

const layout = vi.hoisted(() => ({ compact: true }));
vi.mock('../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => layout.compact }));
afterEach(() => { cleanup(); layout.compact = true; });

function Heading({ enabled, title }: { enabled: boolean; title: string }) {
  const target = useMobileThreadTitleTarget(enabled);
  const actions = useMobileThreadActionsTarget(enabled);
  const controls = useMobileThreadControlsTarget(enabled);
  return <div data-testid="thread-header">
    <ThreadDetailHeading title={title} titleTarget={target} overflowTarget={actions} overflow={<button>Agent actions</button>} />
    <ThreadDetailActions target={controls}><button>Search agent</button></ThreadDetailActions>
  </div>;
}

function Fixture({ enabled = true, title = 'Review a long mobile agent title', slot = true }) {
  return <>
    {layout.compact && slot && <div id={MOBILE_THREAD_TITLE_ID} data-testid="shell-title" />}
    {layout.compact && slot && <div id={MOBILE_THREAD_ACTIONS_ID} data-testid="shell-actions" />}
    {layout.compact && slot && <div id={MOBILE_THREAD_CONTROLS_ID} data-testid="shell-controls" />}
    <Heading enabled={enabled} title={title} />
  </>;
}

it('moves the live heading and actions into the shell without keeping duplicates in the thread', () => {
  const { rerender, unmount } = render(<Fixture />);
  const shell = screen.getByTestId('shell-title');
  expect(within(shell).getByRole('heading', { level: 1 }).textContent).toBe('Review a long mobile agent title');
  expect(within(screen.getByTestId('thread-header')).queryByRole('heading')).toBeNull();
  expect(within(screen.getByTestId('thread-header')).queryByRole('button')).toBeNull();
  const controls = screen.getByTestId('shell-controls');
  expect(within(controls).getByRole('button', { name: 'Search agent' })).toBeTruthy();
  const actions = screen.getByTestId('shell-actions');
  expect(within(actions).getByRole('button', { name: 'Agent actions' })).toBeTruthy();
  rerender(<Fixture title="Renamed agent" />);
  expect(within(shell).getByRole('heading').title).toBe('Renamed agent');
  expect(screen.getAllByRole('heading')).toHaveLength(1);
  unmount();
  expect(shell.childElementCount).toBe(0);
  expect(actions.childElementCount).toBe(0);
  expect(controls.childElementCount).toBe(0);
});

it('releases the shell title when navigation or focus leaves the thread page', () => {
  const { rerender } = render(<Fixture />);
  rerender(<Fixture enabled={false} />);
  expect(screen.getByTestId('shell-title').childElementCount).toBe(0);
  expect(screen.getByTestId('shell-actions').childElementCount).toBe(0);
  expect(screen.getByTestId('shell-controls').childElementCount).toBe(0);
  expect(within(screen.getByTestId('thread-header')).getByRole('button', { name: 'Search agent' })).toBeTruthy();
  expect(within(screen.getByTestId('thread-header')).getByRole('button', { name: 'Agent actions' })).toBeTruthy();
  expect(within(screen.getByTestId('thread-header')).getByRole('heading')).toBeTruthy();
  rerender(<Fixture />);
  expect(within(screen.getByTestId('shell-title')).getByRole('heading')).toBeTruthy();
});

it('returns to the desktop heading and reconnects when the mobile slot remounts', () => {
  const { rerender } = render(<Fixture />);
  layout.compact = false;
  rerender(<Fixture />);
  expect(screen.queryByTestId('shell-title')).toBeNull();
  expect(screen.queryByTestId('shell-actions')).toBeNull();
  expect(within(screen.getByTestId('thread-header')).getByRole('button', { name: 'Agent actions' })).toBeTruthy();
  expect(within(screen.getByTestId('thread-header')).getByRole('heading')).toBeTruthy();
  layout.compact = true;
  rerender(<Fixture />);
  expect(within(screen.getByTestId('shell-title')).getByRole('heading')).toBeTruthy();
});

it('keeps the ordinary heading when no shell slot is available', () => {
  render(<Fixture slot={false} />);
  expect(within(screen.getByTestId('thread-header')).getByRole('heading')).toBeTruthy();
  expect(within(screen.getByTestId('thread-header')).getByRole('button', { name: 'Agent actions' })).toBeTruthy();
});

it('retains the action handler when it renders in the shell', () => {
  const open = vi.fn();
  const target = document.createElement('div');
  document.body.append(target);
  const { unmount } = render(<ThreadDetailHeading title="Agent" overflowTarget={target} overflow={<button onClick={open}>Options</button>} />);
  fireEvent.click(within(target).getByRole('button', { name: 'Options' }));
  expect(open).toHaveBeenCalledOnce();
  unmount();
  expect(target.childElementCount).toBe(0);
  target.remove();
});

it('keeps only the plain title when the phone shell hosts it', () => {
  const target = document.createElement('div');
  const view = render(<ThreadDetailHeading title="Phone" titleTarget={target}
    agent={{ providerId: 'claude-code', model: null, projectName: 'zcc', branchName: null, status: 'idle' }} />);
  expect(target.querySelector('h1')?.textContent).toBe('Phone');
  expect(target.querySelector('[data-testid="thread-detail-meta"]')).toBeNull();
  expect(view.container.querySelector('[data-testid="thread-detail-avatar"]')).toBeNull();
});
