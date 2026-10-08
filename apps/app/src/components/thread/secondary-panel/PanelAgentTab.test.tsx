// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const composerProps = vi.hoisted(() => ({ last: null as null | Record<string, unknown> }));

vi.mock('../../ThreadCommandComposer.js', () => ({
  ThreadCommandComposer: (props: { onCreated?: (threadId: string) => void }) => {
    composerProps.last = props;
    return <button type="button" onClick={() => props.onCreated?.('t-new')}>Send</button>;
  }
}));
vi.mock('../../../views/threads/ThreadDetailView.js', () => ({
  ThreadDetail: ({ threadId, embedded }: { threadId: string; embedded?: boolean }) => (
    <div data-testid="thread-detail">{`${threadId}:${embedded ? 'embedded' : 'full'}`}</div>
  )
}));

import { PanelAgentTab } from './PanelAgentTab.js';

afterEach(() => {
  cleanup();
  composerProps.last = null;
});

describe('PanelAgentTab', () => {
  it('starts a thread from a composer that never navigates away', () => {
    const onCreated = vi.fn();
    render(<PanelAgentTab pluginPanel={{ pluginId: 'p1', panel: 'main' }} onCreated={onCreated} />);
    expect(screen.getByTestId('panel-agent-tab-composer')).toBeTruthy();
    expect(composerProps.last).toMatchObject({
      navigateOnCreate: false,
      autoFocus: true,
      pluginPanel: { pluginId: 'p1', panel: 'main' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onCreated).toHaveBeenCalledWith('t-new');
  });

  it('shows the started thread as an embedded chat', async () => {
    render(<PanelAgentTab threadId="t1" onCreated={vi.fn()} />);
    expect((await screen.findByTestId('thread-detail')).textContent).toBe('t1:embedded');
    expect(screen.queryByTestId('panel-agent-tab-composer')).toBeNull();
  });
});
