// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ api: vi.fn(), hosts: [] as any[] }));
vi.mock('../../lib/fetch-with-app-surface.js', () => ({ apiJson: fixture.api }));
vi.mock('../../hooks/useHosts.js', () => ({ useHosts: () => fixture.hosts, primaryHost: (hosts: any[]) => hosts.find(host => host.isPrimary) }));
import { MachineEnvironmentForm, MachineEnvironmentSettings } from './MachineEnvironmentSettings.js';
const result = (hostId = 'local', variables: any[] = []) => ({ hostId, revision: 'r1', variables });
const pending = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => { fixture.api.mockReset().mockResolvedValue(result()); fixture.hosts = [{ id: 'local', name: 'This Mac', status: 'connected', isPrimary: true }, { id: 'remote', name: 'Dev server', status: 'connected' }]; });
afterEach(cleanup);
const fill = (name = 'EXAMPLE_API_KEY', value = 'fake-sensitive-key') => {
  fireEvent.change(screen.getByLabelText('Environment variable name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Environment variable value'), { target: { value } });
};
const ready = () => waitFor(() => expect((screen.getByLabelText('Environment variable name') as HTMLInputElement).disabled).toBe(false));
it('saves only to the selected machine, masks input, clears successful drafts and never reads saved values', async () => {
  render(<MachineEnvironmentSettings />); await ready(); fill();
  const input = screen.getByLabelText('Environment variable value') as HTMLInputElement;
  expect(input.type).toBe('password'); fireEvent.click(screen.getByText('Show value')); expect(input.type).toBe('text');
  fireEvent.click(screen.getByText('Hide value')); expect(input.type).toBe('password');
  fixture.api.mockResolvedValueOnce(result('local', [{ name: 'EXAMPLE_API_KEY', overriddenByEnvironment: false }]));
  fireEvent.click(screen.getByText('Save variable'));
  await screen.findByText(/Variable saved/); expect(input.value).toBe(''); expect(input.type).toBe('password');
  expect(fixture.api).toHaveBeenLastCalledWith('/system/machines/local/environment', { method: 'PUT', body: JSON.stringify({ name: 'EXAMPLE_API_KEY', value: 'fake-sensitive-key', expectedRevision: 'r1' }) });
  expect(screen.getByLabelText('Value hidden')).toBeTruthy(); expect(screen.getByText('Saved on this machine')).toBeTruthy();
  fixture.api.mockResolvedValueOnce(result('remote'));
  fireEvent.change(screen.getByLabelText('Environment machine'), { target: { value: 'remote' } });
  await waitFor(() => expect(fixture.api).toHaveBeenLastCalledWith('/system/machines/remote/environment', expect.objectContaining({ signal: expect.any(AbortSignal) })));
  expect((screen.getByLabelText('Environment variable name') as HTMLInputElement).value).toBe('');
});
it('shows environment precedence, replaces without revealing a saved key and confirms removal', async () => {
  fixture.api.mockResolvedValue(result('local', [{ name: 'KEY', overriddenByEnvironment: true }]));
  render(<MachineEnvironmentSettings />); await ready(); expect(screen.getByText('Machine environment takes priority')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Replace KEY' })); expect((screen.getByLabelText('Environment variable name') as HTMLInputElement).value).toBe('KEY');
  expect(document.activeElement).toBe(screen.getByLabelText('Environment variable value'));
  fill('KEY', 'replacement'); fireEvent.click(screen.getByText('Replace variable')); await screen.findByText(/Variable saved/);
  fireEvent.click(screen.getByRole('button', { name: 'Remove KEY' })); fireEvent.click(screen.getByText('Cancel')); expect(screen.queryByText('Remove saved value?')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Remove KEY' })); fixture.api.mockResolvedValueOnce(result());
  fireEvent.click(within(screen.getByRole('group', { name: 'Remove KEY' })).getByText('Remove variable'));
  await screen.findByText(/Saved variable removed/); expect(fixture.api.mock.calls.at(-1)?.[1].body).toContain('"value":null');
});
it('rejects reserved names and requires a reload after uncertain writes without retrying the secret', async () => {
  render(<MachineEnvironmentSettings />); await ready(); fill('PATH'); fireEvent.click(screen.getByText('Save variable'));
  expect((await screen.findByRole('alert')).textContent).toContain('reserved'); expect(fixture.api).toHaveBeenCalledOnce();
  fill(); fixture.api.mockRejectedValueOnce(new Error('private raw error'));
  fireEvent.click(screen.getByText('Save variable')); await screen.findByText(/Could not confirm the change/);
  expect(document.body.textContent).not.toContain('private raw error'); expect(fixture.api).toHaveBeenCalledTimes(2);
  expect((screen.getByText('Save variable') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('Reload variables')); await ready(); expect(fixture.api).toHaveBeenCalledTimes(3);
});
it('disables disconnected machines and aborts stale reads when changing machine', async () => {
  const stale = pending<any>(); fixture.api.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(result('remote'));
  const view = render(<MachineEnvironmentSettings />); const oldSignal = fixture.api.mock.calls[0]?.[1].signal;
  fireEvent.change(screen.getByLabelText('Environment machine'), { target: { value: 'remote' } }); await ready(); expect(oldSignal.aborted).toBe(true);
  stale.resolve(result('local', [{ name: 'OLD_KEY', overriddenByEnvironment: false }])); await Promise.resolve(); expect(screen.queryByText('OLD_KEY')).toBeNull();
  fixture.hosts[1].status = 'disconnected'; view.rerender(<MachineEnvironmentSettings />); await screen.findByText(/Connect this machine/);
  expect((screen.getByText('Reload variables') as HTMLButtonElement).disabled).toBe(true);
  fixture.hosts = []; view.rerender(<MachineEnvironmentSettings />); expect(screen.getByText('Machine unavailable')).toBeTruthy();
});
it('handles missing machines, failed/malformed/wrong-scope reads and late write completion', async () => {
  fixture.hosts = []; const view = render(<MachineEnvironmentSettings />); expect(screen.getByText('Select a machine')).toBeTruthy(); view.unmount();
  for (const response of [Promise.reject(new Error('read failed')), Promise.resolve(result('wrong')), Promise.resolve({ hostId: 'local', revision: '' })]) {
    fixture.api.mockReturnValueOnce(response); const one = render(<MachineEnvironmentForm hostId="local" connected />);
    await screen.findByText(/Could not load environment/); one.unmount();
  }
  const late = pending<any>(); fixture.api.mockResolvedValueOnce(result()).mockReturnValueOnce(late.promise);
  const one = render(<MachineEnvironmentForm hostId="local" connected />); await ready(); fill(); fireEvent.click(screen.getByText('Save variable')); one.unmount();
  late.resolve(result()); await Promise.resolve();
});
it('redacts malformed or wrong-scope writes and ignores read failures after unmount', async () => {
  for (const next of [result('wrong'), { hostId: 'local', revision: '' }]) {
    fixture.api.mockResolvedValueOnce(result()).mockResolvedValueOnce(next);
    const one = render(<MachineEnvironmentForm hostId="local" connected />); await ready(); fill(); fireEvent.click(screen.getByText('Save variable'));
    await screen.findByText(/Could not confirm/); one.unmount();
  }
});
