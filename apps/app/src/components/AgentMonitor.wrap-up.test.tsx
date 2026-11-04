// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentCard } from './AgentBoard.js';

vi.mock('../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => false }));
vi.mock('./AgentSessionView.js', () => ({
  AgentSessionView: ({ footer }: { footer: ReactNode }) => <div data-testid="footer">{footer}</div>
}));
vi.mock('../lib/product-client.js', () => ({ product: { config: { set: vi.fn().mockResolvedValue({}) } } }));

import { AgentMonitor } from './AgentMonitor.js';
import { CLOSE_FOLLOWUP_TITLE, CLOSE_FOLLOWUP_WRAP_UP_TITLE } from './agentCardActions.js';
import { agentFleetItem } from './fleet-item.js';
import { useData, useUi } from '../store.js';

const TIP_OFF = CLOSE_FOLLOWUP_TITLE;
const TIP_ON = CLOSE_FOLLOWUP_WRAP_UP_TITLE;

function mount() {
  const card = agentFleetItem({
    projectId: 'p', projectName: 'Project', state: 'idle',
    session: { id: 'cli', projectId: 'p', title: 'Task', cwd: '/tmp', createdAt: 1, profile: 'claude', status: 'running' }
  } as AgentCard);
  useUi.setState({ agentMonitor: { sessionId: 'cli', projectId: 'p' } });
  render(<MemoryRouter><AgentMonitor cards={[card]} /></MemoryRouter>);
  return Array.from(screen.getByTestId('footer').querySelectorAll('button')) as HTMLButtonElement[];
}

beforeEach(() => {
  useData.setState({ projects: [], terminals: {}, agentsListOrganization: 'status', includeScheduledAgentsInAgentView: false });
});
afterEach(() => {
  cleanup();
  useData.setState({ closeWrapUpEnabled: false, closingFollowupIds: new Set() });
});

describe('AgentMonitor Close with follow-up while wrapping up', () => {
  it.each([
    [false, 'Closing…', TIP_OFF],
    [true, 'Wrapping up…', TIP_ON]
  ])('with the experiment %s, a closing session reads %s', (on, label, tip) => {
    useData.setState({ closeWrapUpEnabled: on, closingFollowupIds: new Set(['cli']) });
    const button = mount().find((b) => b.textContent?.includes(label));
    expect(button).toBeTruthy();
    expect(button!.title).toBe(tip);
    expect(button!.disabled).toBe(true);
  });

  it('keeps the idle label and picks the tooltip by setting', () => {
    useData.setState({ closeWrapUpEnabled: true });
    const button = mount().find((b) => b.textContent?.includes('Close with follow-up'));
    expect(button!.title).toBe(TIP_ON);
  });
});
