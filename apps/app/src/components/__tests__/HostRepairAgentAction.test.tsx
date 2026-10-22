// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HostRepairAgentAction } from '../HostRepairAgentAction.js';

const mocks = vi.hoisted(() => ({
  start: vi.fn(), upsert: vi.fn(), loadProjects: vi.fn(async () => {}), inspect: vi.fn(),
  setHostInstallDrawerOpen: vi.fn(), setLauncherOpen: vi.fn(), enterProjectFocus: vi.fn(), navigate: vi.fn()
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('../../lib/host-repair-agent.js', () => ({ startHostRepairAgent: mocks.start }));
vi.mock('../../lib/product-client.js', () => ({ product: {} }));
vi.mock('../../lib/inspect-session.js', () => ({ inspectThread: mocks.inspect }));
vi.mock('../../thread-store.js', () => ({ useThreads: { getState: () => mocks } }));
vi.mock('../../store.js', () => ({ useUi: { getState: () => mocks }, useData: { getState: () => ({ ...mocks, defaultHarness: 'codex' }) } }));
const state = { target: 'remote', error: 'Could not connect', logs: ['attempt'], stages: [] };
const thread = { id: 'repair', projectId: 'local-default', hostId: 'primary' };
beforeEach(() => { vi.clearAllMocks(); mocks.start.mockReset(); mocks.loadProjects.mockResolvedValue(); });
afterEach(cleanup);

it('starts once, closes connection surfaces and opens the normal local conversation', async () => {
  let resolve!: (value: unknown) => void;
  mocks.start.mockReturnValue(new Promise(r => { resolve = r; }));
  const onStarted = vi.fn();
  render(<HostRepairAgentAction state={state} target={{ hostId: 'remote' }} onStarted={onStarted} />);
  fireEvent.click(screen.getByRole('button', { name: 'Fix with agent' }));
  fireEvent.click(screen.getByRole('button', { name: 'Starting local agent…' }));
  expect(mocks.start).toHaveBeenCalledExactlyOnceWith({}, state, { hostId: 'remote' }, 'codex');
  await act(async () => resolve(thread));
  expect(mocks.upsert).toHaveBeenCalledWith(thread);
  expect(mocks.setHostInstallDrawerOpen).toHaveBeenCalledWith(false);
  expect(mocks.setLauncherOpen).toHaveBeenCalledWith(false);
  expect(onStarted).toHaveBeenCalledOnce();
  expect(mocks.enterProjectFocus).toHaveBeenCalledWith('local-default');
  expect(mocks.inspect).toHaveBeenCalledWith('repair', 'local-default', mocks.navigate);
});
it('keeps diagnostics available on a launch failure and allows retry', async () => {
  mocks.start.mockRejectedValueOnce(new Error('No local provider')).mockResolvedValueOnce(thread);
  render(<HostRepairAgentAction state={state} target={{ projectId: 'remote-project' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Fix with agent' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('No local provider'));
  expect(mocks.setHostInstallDrawerOpen).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Fix with agent' }));
  await waitFor(() => expect(mocks.inspect).toHaveBeenCalledOnce());
});
it('still opens the created thread if refreshing the project list fails', async () => {
  mocks.start.mockResolvedValue(thread);
  mocks.loadProjects.mockRejectedValueOnce(new Error('refresh failed'));
  render(<HostRepairAgentAction state={state} target={{ hostId: 'remote' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Fix with agent' }));
  await waitFor(() => expect(mocks.inspect).toHaveBeenCalledOnce());
  expect(screen.queryByRole('alert')).toBeNull();
});
it('handles an unknown launch error', async () => {
  mocks.start.mockRejectedValueOnce('oops');
  render(<HostRepairAgentAction state={state} target={{ hostId: 'remote' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Fix with agent' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not start'));
});
