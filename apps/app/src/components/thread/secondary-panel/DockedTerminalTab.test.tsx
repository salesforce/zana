// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { DockedTerminalTab } from './DockedTerminalTab.js';
import { useTerminalDockTargets } from '../../../lib/terminal-dock-targets.js';
function Targets() {
  const targets = useTerminalDockTargets();
  return <output data-testid="targets">{[...targets.keys()].join(',')}</output>;
}
afterEach(cleanup);
it('registers the live anchor, replaces its session and releases it on unmount', () => {
  const view = render(<><Targets /><DockedTerminalTab sessionId="first" /></>);
  expect(view.getByTestId('targets').textContent).toBe('first');
  expect(view.getByTestId('thread-terminal-tab').dataset.terminalSession).toBe('first');
  view.rerender(<><Targets /><DockedTerminalTab sessionId="second" /></>);
  expect(view.getByTestId('targets').textContent).toBe('second');
  view.rerender(<Targets />);
  expect(view.getByTestId('targets').textContent).toBe('');
});
