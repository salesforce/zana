import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { useSecondaryPanel, useThreadSecondaryPanel } from './useThreadSecondaryPanel.js';

function Probe({ threadId }: { threadId?: string }) {
  const panel = useThreadSecondaryPanel(threadId);
  return (
    <div>
      {panel.state.isOpen ? 'open' : 'closed'}
      {panel.state.activeId}
    </div>
  );
}

function AgentProbe({ ownerId }: { ownerId: string }) {
  const panel = useSecondaryPanel(ownerId, { defaultOpen: true });
  return <div>{panel.state.isOpen ? 'open' : 'closed'}</div>;
}

describe('useThreadSecondaryPanel', () => {
  it('hydrates closed Info state for a new thread id', () => {
    const html = renderToStaticMarkup(<Probe threadId="thread-x" />);
    expect(html).toContain('closed');
    expect(html).toContain('info');
  });

  it('hydrates pending state when the thread id is missing', () => {
    const html = renderToStaticMarkup(<Probe />);
    expect(html).toContain('closed');
    expect(html).toContain('info');
  });

  it('defaults agent owners open', () => {
    const html = renderToStaticMarkup(<AgentProbe ownerId="session-x" />);
    expect(html).toContain('open');
  });

  it('memoizes panel commands so selectPin stays stable across state', () => {
    const source = readFileSync(new URL('./useThreadSecondaryPanel.ts', import.meta.url), 'utf8');
    expect(source).toContain('useMemo(() => createSecondaryPanelCommands(update), [update])');
    expect(source).toContain('secondaryPanelStatesEqual');
    expect(source).not.toContain('...createSecondaryPanelCommands(update)');
  });
});
