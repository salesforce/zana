// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ hosts: [] as any[], list: vi.fn(), branches: vi.fn() }));
vi.mock('../hooks/useHosts.js', () => ({ useHosts: () => h.hosts }));
vi.mock('../lib/product-client.js', () => ({ product: { environments: { list: h.list } } }));
vi.mock('../lib/fetch-with-app-surface.js', () => ({ apiJson: h.branches }));
// Exercise choices and data lifetimes without coupling this component to popover geometry.
vi.mock('./ui/PopoverPicklist.js', () => ({ PopoverPicklist: (props: any) => <select aria-label={props.ariaLabel} value={props.value} disabled={props.disabled} onChange={event => props.onChange(event.target.value)}>{props.options.map((row: any) => <option key={row.value} value={row.value} disabled={row.disabled}>{row.label}</option>)}</select> }));
import { EnvironmentPicker } from './EnvironmentPicker.js';
const ready = { id: 'ready', hostId: 'remote', status: 'ready', workspaceProvisionType: 'managed-worktree', branchName: 'feature' };
beforeEach(() => {
  vi.resetAllMocks();
  h.hosts = [{ id: 'local', isPrimary: true, name: 'Personal Mac' }, { id: 'remote', name: 'work-mac.internal.example.com' }];
  h.list.mockResolvedValue([ready]); h.branches.mockResolvedValue({ branches: ['main', 'develop'] });
});
afterEach(cleanup);
function view(extra: Record<string, any> = {}) {
  const props = { projectId: 'project', hostId: 'remote', value: { kind: 'unmanaged' as const }, onChange: vi.fn(), ...extra };
  return { ...render(<EnvironmentPicker {...props} />), props };
}
it('names the actual execution computer and never substitutes the client for a missing bound host', async () => {
  const { props, rerender } = view();
  await screen.findByRole('option', { name: 'Run on work-mac' });
  expect(screen.queryByText('Work locally')).toBeNull();
  rerender(<EnvironmentPicker {...props} hostId="unavailable" />);
  expect(screen.getByRole('option', { name: 'Run in project folder' })).toBeTruthy();
  expect(screen.queryByRole('option', { name: 'Run on Personal Mac' })).toBeNull();
  rerender(<EnvironmentPicker {...props} hostId={undefined} />);
  expect(screen.getByRole('option', { name: 'Run on Personal Mac' })).toBeTruthy();
  await act(async () => {});
});
it('loads branches and filters managed worktrees to the bound host before making choices', async () => {
  h.list.mockResolvedValue([ready, { ...ready, id: 'wrong-host', hostId: 'local' }, { ...ready, id: 'pending', status: 'creating' }, { ...ready, id: 'unmanaged', workspaceProvisionType: 'unmanaged' }]);
  const { props, rerender } = view();
  await act(async () => {});
  await waitFor(() => expect((screen.getByRole('option', { name: 'Existing worktree' }) as HTMLOptionElement).disabled).toBe(false));
  expect(h.branches).toHaveBeenCalledWith('/projects/project/branches?hostId=remote');
  fireEvent.change(screen.getByLabelText('Workspace'), { target: { value: 'reuse' } });
  expect(props.onChange).toHaveBeenLastCalledWith({ kind: 'reuse', environmentId: 'ready' });
  rerender(<EnvironmentPicker {...props} value={{ kind: 'reuse', environmentId: 'ready' }} />);
  expect(screen.getAllByRole('option', { name: 'feature' })).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Existing worktree'), { target: { value: 'ready' } });
  expect(props.onChange).toHaveBeenLastCalledWith({ kind: 'reuse', environmentId: 'ready' });
  rerender(<EnvironmentPicker {...props} value={{ kind: 'worktree', baseBranch: 'main', branchSlug: 'task' }} />);
  fireEvent.change(screen.getByLabelText('Base branch'), { target: { value: 'develop' } });
  expect(props.onChange).toHaveBeenLastCalledWith({ kind: 'worktree', baseBranch: 'develop', branchSlug: 'task' });
  fireEvent.change(screen.getByLabelText('Workspace'), { target: { value: 'unmanaged' } });
  expect(props.onChange).toHaveBeenLastCalledWith({ kind: 'unmanaged' });
});
it('maps new worktrees and personal scratch while honoring disabled controls', async () => {
  const { props, rerender } = view({ allowPersonal: true });
  await waitFor(() => expect((screen.getByRole('option', { name: 'New worktree' }) as HTMLOptionElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('Workspace'), { target: { value: 'worktree' } });
  expect(props.onChange).toHaveBeenLastCalledWith({ kind: 'worktree', baseBranch: undefined });
  fireEvent.change(screen.getByLabelText('Workspace'), { target: { value: 'personal' } });
  expect(props.onChange).toHaveBeenLastCalledWith({ kind: 'personal' });
  rerender(<EnvironmentPicker {...props} value={{ kind: 'personal' }} disabled />);
  expect((screen.getByLabelText('Workspace') as HTMLSelectElement).disabled).toBe(true);
});
it('handles unavailable data and snaps an invalid worktree choice without changing host authority', async () => {
  h.list.mockRejectedValue(new Error('Offline')); h.branches.mockRejectedValue(new Error('Offline'));
  const { props } = view({ value: { kind: 'worktree' } });
  await waitFor(() => expect(props.onChange).toHaveBeenCalledWith({ kind: 'unmanaged' }));
  expect((screen.getByRole('option', { name: 'New worktree' }) as HTMLOptionElement).disabled).toBe(true);
  expect((screen.getByRole('option', { name: 'Existing worktree' }) as HTMLOptionElement).disabled).toBe(true);
  expect(screen.getByRole('option', { name: 'Run on work-mac' })).toBeTruthy();
});
it('does not fetch for a missing project and ignores old data after a project change or unmount', async () => {
  let environments!: (rows: any[]) => void, branches!: (rows: any) => void;
  h.list.mockImplementationOnce(() => new Promise(resolve => { environments = resolve; }));
  h.branches.mockImplementationOnce(() => new Promise(resolve => { branches = resolve; }));
  const { props, rerender, unmount } = view();
  rerender(<EnvironmentPicker {...props} projectId="" />);
  await act(async () => { environments([ready]); branches({ branches: ['main'] }); });
  expect(h.list).toHaveBeenCalledOnce(); expect(h.branches).toHaveBeenCalledOnce();
  expect((screen.getByRole('option', { name: 'New worktree' }) as HTMLOptionElement).disabled).toBe(true);
  rerender(<EnvironmentPicker {...props} projectId="other" hostId={undefined} />);
  await act(async () => {});
  expect(h.branches).toHaveBeenLastCalledWith('/projects/other/branches');
  unmount();
});
