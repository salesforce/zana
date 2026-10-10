// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TimelineViewWorkflowWorkRow } from '@zana-ai/zcc-thread-view';
import { BACKGROUND_STOP_RETRY_MS, BackgroundCommandsCard } from './ComposerStackCards.js';

const { stopBackground } = vi.hoisted(() => ({ stopBackground: vi.fn() }));
vi.mock('../../../lib/product-client.js', () => ({ product: { threads: { stopBackground } } }));
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
  stopBackground.mockReset();
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

it('shows no stop controls without a thread id', () => {
  render(<BackgroundCommandsCard commands={[row({ id: 'a', itemId: 'a' }), row({ id: 'b', itemId: 'b' })]} />);
  expect(screen.queryByTestId('thread-background-stop')).toBeNull();
  expect(screen.queryByTestId('thread-background-stop-all')).toBeNull();
});

it('stops one row and marks it stopping, outside the expandable summary', async () => {
  stopBackground.mockResolvedValue({ ok: true, stopped: ['a'], requested: [] });
  const { container } = render(
    <BackgroundCommandsCard threadId="t" commands={[row({ id: 'a', itemId: 'a', description: 'npm run dev' })]} />
  );
  expect(screen.queryByTestId('thread-background-stop-all')).toBeNull();
  const button = screen.getByRole('button', { name: 'Stop npm run dev' });
  expect(button.closest('summary')).toBeNull();
  await act(async () => {
    fireEvent.click(button);
  });
  expect(stopBackground).toHaveBeenCalledWith('t', ['a']);
  const item = container.querySelector('[data-kind="command"]')!;
  expect(item.getAttribute('data-stop-state')).toBe('stopping');
  expect(item.textContent).toContain('Stopping…');
  expect((button as HTMLButtonElement).disabled).toBe(true);
});

it('stops all rows and shows which ones the agent was asked to stop', async () => {
  stopBackground.mockResolvedValue({ ok: true, stopped: ['a'], requested: ['b'] });
  const { container } = render(
    <BackgroundCommandsCard
      threadId="t"
      commands={[row({ id: 'a', itemId: 'a', description: 'vite' }), row({ id: 'b', itemId: 'b', description: 'tsc -w' })]}
    />
  );
  const stopAll = screen.getByTestId('thread-background-stop-all') as HTMLButtonElement;
  await act(async () => {
    fireEvent.click(stopAll);
  });
  expect(stopBackground).toHaveBeenCalledWith('t', ['a', 'b']);
  const states = [...container.querySelectorAll('.thread-background-activity-item')].map((el) => el.getAttribute('data-stop-state'));
  expect(states).toEqual(['stopping', 'asked']);
  expect(container.textContent).toContain('Asked agent to stop');
  // The asked row can be stopped again; Stop all only targets it now.
  const [stopA, stopB] = screen.getAllByTestId('thread-background-stop') as HTMLButtonElement[];
  expect(stopA!.disabled).toBe(true);
  expect(stopB!.disabled).toBe(false);
  stopBackground.mockResolvedValue({ ok: true, stopped: [], requested: ['b'] });
  await act(async () => {
    fireEvent.click(stopAll);
  });
  expect(stopBackground).toHaveBeenLastCalledWith('t', ['b']);
});

it('lets a stopped row be retried when its task never reports completion', async () => {
  stopBackground.mockResolvedValue({ ok: true, stopped: ['a'], requested: [] });
  const { container } = render(
    <BackgroundCommandsCard threadId="t" commands={[row({ id: 'a', itemId: 'a', description: 'vite' })]} />
  );
  await act(async () => {
    fireEvent.click(screen.getByTestId('thread-background-stop'));
  });
  expect(container.querySelector('[data-stop-state="stopping"]')).not.toBeNull();
  act(() => {
    vi.advanceTimersByTime(BACKGROUND_STOP_RETRY_MS);
  });
  expect(container.querySelector('[data-stop-state]')).toBeNull();
  expect((screen.getByTestId('thread-background-stop') as HTMLButtonElement).disabled).toBe(false);
});

it('releases rows the server neither stopped nor handed on, and shows a fallback error', async () => {
  stopBackground.mockResolvedValue({ ok: true, stopped: ['a'], requested: [], fallbackError: 'thread is archived' });
  const { container } = render(
    <BackgroundCommandsCard
      threadId="t"
      commands={[row({ id: 'a', itemId: 'a', description: 'vite' }), row({ id: 'b', itemId: 'b', description: 'tsc' })]}
    />
  );
  await act(async () => {
    fireEvent.click(screen.getByTestId('thread-background-stop-all'));
  });
  expect(screen.getByRole('alert').textContent).toBe('thread is archived');
  const states = [...container.querySelectorAll('.thread-background-activity-item')].map((el) => el.getAttribute('data-stop-state'));
  expect(states).toEqual(['stopping', null]);
});

it('forgets the stop state of a row once it is gone', async () => {
  stopBackground.mockResolvedValue({ ok: true, stopped: [], requested: ['a'] });
  const a = row({ id: 'a', itemId: 'a', description: 'vite' });
  const { container, rerender } = render(<BackgroundCommandsCard threadId="t" commands={[a]} />);
  await act(async () => {
    fireEvent.click(screen.getByTestId('thread-background-stop'));
  });
  expect(container.querySelector('[data-stop-state="asked"]')).not.toBeNull();
  rerender(<BackgroundCommandsCard threadId="t" commands={[]} />);
  rerender(<BackgroundCommandsCard threadId="t" commands={[a]} />);
  expect(container.querySelector('[data-stop-state]')).toBeNull();
});

it('shows the error and re-enables the row when stopping fails', async () => {
  stopBackground.mockRejectedValue(new Error('No matching background task is running in this thread'));
  const { container } = render(
    <BackgroundCommandsCard threadId="t" commands={[row({ id: 'a', itemId: 'a', description: 'vite' })]} />
  );
  await act(async () => {
    fireEvent.click(screen.getByTestId('thread-background-stop'));
  });
  expect(screen.getByRole('alert').textContent).toBe('No matching background task is running in this thread');
  expect(container.querySelector('[data-stop-state]')).toBeNull();
  expect((screen.getByTestId('thread-background-stop') as HTMLButtonElement).disabled).toBe(false);
});

it('uses a generic message for non-Error failures', async () => {
  stopBackground.mockRejectedValue('nope');
  render(<BackgroundCommandsCard threadId="t" workflows={[row({ id: 'w', itemId: 'w', taskType: 'local_workflow', workflowName: 'Build' })]} commands={[]} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Stop Build' }));
  });
  expect(screen.getByRole('alert').textContent).toBe('Failed to stop background task');
});
