import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../TerminalSurface.js', () => ({
  THREAD_PANEL_TERMINAL_ANCHOR_ID: 'cc-terminal-anchor-thread-panel'
}));
vi.mock('../../../store.js', () => ({
  useUi: Object.assign(
    (selector: (s: { selectThreadPanelTerminal: () => void; clearThreadPanelTerminal: () => void }) => unknown) => selector({
      selectThreadPanelTerminal: () => undefined,
      clearThreadPanelTerminal: () => undefined
    }),
    { getState: () => ({ threadPanelTerminal: null }) }
  )
}));

import { ThreadTerminalTab } from './ThreadTerminalTab.js';

describe('ThreadTerminalTab', () => {
  it('renders the thread-panel terminal anchor', () => {
    const html = renderToStaticMarkup(
      <ThreadTerminalTab sessionId="s1" projectId="p1" />
    );
    expect(html).toContain('data-testid="thread-terminal-tab"');
    expect(html).toContain('cc-terminal-anchor-thread-panel');
  });
});
