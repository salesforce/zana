// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TimelineViewWorkflowWorkRow } from '@zana-ai/zcc-thread-view';
import { BackgroundCommandsCard } from './ComposerStackCards.js';

vi.mock('../../../lib/product-client.js', () => ({ product: { threads: {} } }));
vi.mock('../../../lib/in-app-browser-link-preference.js', () => ({ handleHttpLinkClick: vi.fn() }));
vi.mock('../secondary-panel/threadSecondaryPanelLogic.js', () => ({ loadWorkspaceMeta: vi.fn() }));

const NOW = 1_800_000_000_000;
const LONG_COMMAND = 'p=/opt/workspace/core-public; git -C $p status --porcelain=v1 -b -uall -- . >/dev/null 2>&1; rg "region_leave" /tmp/core-trace.txt | sort -k1 -rn | head -12';

function row(overrides: Partial<TimelineViewWorkflowWorkRow>): TimelineViewWorkflowWorkRow {
  return {
    id: 'row', threadId: 't', turnId: 'turn', sourceSeqStart: 1, sourceSeqEnd: 1,
    startedAt: NOW, createdAt: NOW, kind: 'work', workKind: 'workflow', status: 'pending',
    itemId: 'row', taskType: 'local_bash', workflowName: null, description: null, model: null,
    taskStatus: 'running', workflow: null, usage: null, summary: null, error: null, completedAt: null,
    ...overrides
  } as TimelineViewWorkflowWorkRow;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('renders nothing without rows', () => {
  const { container } = render(<BackgroundCommandsCard commands={null} workflows={undefined} />);
  expect(container.innerHTML).toBe('');
});

it('renders a command as a one-line expandable row with its full text', () => {
  const { container } = render(
    <BackgroundCommandsCard commands={[row({ id: 'bash', description: LONG_COMMAND })]} />
  );
  expect(screen.getByText('Background command', { selector: '.thread-stack-card-title' })).toBeTruthy();
  expect(container.querySelector('.thread-background-activity-count')).toBeNull();
  const item = container.querySelector('[data-kind="command"]')!;
  expect(item.querySelector('summary .thread-background-activity-text.is-command')?.textContent).toBe(LONG_COMMAND);
  expect(screen.getByTestId('thread-background-command-full').textContent).toBe(LONG_COMMAND);
  expect(item.querySelector('.sr-only')?.textContent).toBe('Background command: ');
  // Elapsed stays hidden for the first second.
  expect(item.querySelector('.thread-background-activity-elapsed')).toBeNull();
});

it('lists mixed activity with a count, agent model badge, and a shared ticking clock', () => {
  const { container } = render(
    <BackgroundCommandsCard
      workflows={[row({ id: 'wf', taskType: 'local_workflow', workflowName: 'Build plugin', description: 'Ship', startedAt: NOW - 5_000 })]}
      commands={[
        row({ id: 'bash', description: 'zcc plugin dev', startedAt: NOW - 65_000 }),
        row({ id: 'agent', taskType: 'local_agent', description: 'Map workspace status polling', model: 'haiku', startedAt: NOW - 12_000 })
      ]}
    />
  );
  expect(screen.getByText('Background activity')).toBeTruthy();
  expect(screen.getByText('3 running')).toBeTruthy();

  const workflow = container.querySelector('[data-kind="workflow"]')!;
  expect(workflow.textContent).toContain('Build plugin');
  expect(workflow.querySelector('details')).toBeNull();
  expect(workflow.querySelector('.thread-background-activity-elapsed')?.textContent).toBe('5s');

  const agent = container.querySelector('[data-kind="agent"]')!;
  expect(agent.querySelector('.thread-background-activity-badge')?.textContent).toBe('haiku');
  expect(agent.querySelector('details')).toBeNull();

  const command = container.querySelector('[data-kind="command"]')!;
  expect(command.querySelector('.thread-background-activity-badge')).toBeNull();
  expect(command.querySelector('.thread-background-activity-elapsed')?.textContent).toBe('1m 05s');

  act(() => {
    vi.advanceTimersByTime(3_000);
  });
  expect(workflow.querySelector('.thread-background-activity-elapsed')?.textContent).toBe('8s');
  expect(agent.querySelector('.thread-background-activity-elapsed')?.textContent).toBe('15s');
});

it('falls back to Running when a row has no name or description', () => {
  render(<BackgroundCommandsCard commands={[row({ id: 'agent', taskType: 'local_agent' })]} />);
  expect(screen.getByText('Background agent', { selector: '.thread-stack-card-title' })).toBeTruthy();
  expect(screen.getByText('Running')).toBeTruthy();
});
