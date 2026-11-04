// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentCard } from './AgentBoard.js';
import { CloseIdleAgentsDialog } from './CloseIdleAgentsDialog.js';
import { useData } from '../store.js';

const LINE = /Each agent first wraps up: it saves what it learnt and tidies up\. Agents that ask you something stay open\./;
const agents = [{ projectId: 'p', projectName: 'P', session: { id: 's1', title: 'Task' } }] as unknown as AgentCard[];

afterEach(() => {
  cleanup();
  useData.setState({ closeWrapUpEnabled: false });
});

describe('CloseIdleAgentsDialog wrap-up line', () => {
  it('is absent while the experiment is off', () => {
    useData.setState({ closeWrapUpEnabled: false });
    render(<CloseIdleAgentsDialog agents={agents} projectName="P" onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByText(LINE)).toBeNull();
  });

  it('shows under the checked summarise option and hides when unchecked', () => {
    useData.setState({ closeWrapUpEnabled: true });
    render(<CloseIdleAgentsDialog agents={agents} projectName="P" onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText(LINE)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.queryByText(LINE)).toBeNull();
  });

  it('is not shown for the read-only summarize action', () => {
    useData.setState({ closeWrapUpEnabled: true });
    render(<CloseIdleAgentsDialog agents={agents} projectName="P" action="summarize" onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByText(LINE)).toBeNull();
  });
});
