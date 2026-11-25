// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentSessionHeader } from './AgentSessionHeader.js';
import { MOBILE_THREAD_CONTROLS_ID, MOBILE_THREAD_TITLE_ID } from './useMobileThreadTitleTarget.js';

const layout = vi.hoisted(() => ({ compact: true }));
vi.mock('../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => layout.compact }));
afterEach(() => { cleanup(); layout.compact = true; });
const sessionTitle = 'Review mobile terminal';
function Fixture({ enabled = true, title = sessionTitle }: {
  enabled?: boolean; title?: string;
}) {
  return <>
    <div id={MOBILE_THREAD_TITLE_ID} data-testid="shell" />
    <div id={MOBILE_THREAD_CONTROLS_ID} data-testid="controls" />
    <AgentSessionHeader title={title} useShellTitle={enabled}>
      <button>Agent actions</button>
    </AgentSessionHeader>
  </>;
}

it('moves title and actions into the shell and updates a renamed title', () => {
  const { rerender, unmount } = render(<Fixture />);
  const shell = screen.getByTestId('shell');
  expect(within(shell).getByRole('heading').textContent).toBe(sessionTitle);
  const header = document.querySelector('header')!;
  const controls = screen.getByTestId('controls');
  expect(within(controls).getByRole('button', { name: 'Agent actions' })).toBeTruthy();
  expect(within(header).queryByRole('button')).toBeNull();
  expect(header.getAttribute('data-controls-in-shell')).toBe('true');
  expect(header.getAttribute('data-title-in-shell')).toBe('true');
  expect(within(header).queryByRole('heading')).toBeNull();
  expect(within(controls).queryByRole('img')).toBeNull();
  rerender(<Fixture title="Renamed terminal" />);
  expect(within(shell).getByRole('heading').textContent).toBe('Renamed terminal');
  unmount();
  expect(shell.childElementCount).toBe(0);
  expect(controls.childElementCount).toBe(0);
});

it('keeps embedded or inactive agent titles local and responds to viewport changes', () => {
  const { rerender } = render(<Fixture enabled={false} />);
  expect(screen.getByTestId('shell').childElementCount).toBe(0);
  expect(screen.getByTestId('controls').childElementCount).toBe(0);
  expect(screen.getByRole('button').closest('header')).toBeTruthy();
  expect(screen.getByRole('heading').closest('header')).toBeTruthy();
  rerender(<Fixture />);
  expect(screen.getByTestId('controls').childElementCount).toBe(1);
  layout.compact = false;
  rerender(<Fixture />);
  expect(screen.getByTestId('shell').childElementCount).toBe(0);
  expect(screen.getByTestId('controls').childElementCount).toBe(0);
  expect(screen.getByRole('button').closest('header')).toBeTruthy();
  expect(screen.getByRole('heading').closest('header')).toBeTruthy();
});
