/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LaunchOptions } from '@zana-ai/zcc-domain/launch-options';

const preview = vi.hoisted(() => vi.fn());
const listProjects = vi.hoisted(() => vi.fn());
const listWorktrees = vi.hoisted(() => vi.fn());
vi.mock('../lib/product-client.js', () => ({ product: {
  teams: { preview: (...args: unknown[]) => preview(...args) }, projects: { list: () => listProjects() }, git: { listWorktrees: (...args: unknown[]) => listWorktrees(...args) }
} }));
import { SquadLaunchPolicyFields, SquadLaunchSettings, SquadResolvedLaunchDetails } from './SquadLaunchSettings.js';

const resolved = { worktree: { value: false, source: 'launch' }, onComplete: { value: 'merge', source: 'plan' }, push: { value: true, source: 'squad' }, checks: { value: ['lint'], source: 'default' }, failurePolicyDefault: { value: 'fail-run', source: 'default' } } as const;
const project = { id: 'p1', name: 'Project', path: '/project', createdAt: 0, lastActiveAt: 0 };
const response = (overrides = {}) => ({ ok: true as const, value: { launchOptions: {}, resolvedLaunch: resolved, location: { kind: 'project-root' as const, projectId: 'p1' }, path: '/project', fingerprint: 'f', previewToken: 'secret', ...overrides } });
function Harness({ initial = {}, valid = vi.fn() }: { initial?: LaunchOptions; valid?: (valid: boolean) => void }) {
  const [value, setValue] = useState<LaunchOptions>(initial);
  return <SquadLaunchSettings teamId="team" projectId="p1" goal="goal" coordinationMode="structured" value={value} onChange={setValue} disabled={false} onValidityChange={valid} />;
}
function setup() { listProjects.mockResolvedValue([project]); listWorktrees.mockResolvedValue([]); }
afterEach(() => { cleanup(); vi.useRealTimers(); preview.mockReset(); listProjects.mockReset(); listWorktrees.mockReset(); });

describe('SquadLaunchSettings', () => {
  it('shows trusted path and every readable resolved setting; preview token stays private', async () => {
    setup(); preview.mockResolvedValue(response()); const valid = vi.fn(); render(<Harness valid={valid} />);
    await vi.waitFor(() => expect(valid).toHaveBeenLastCalledWith(true));
    const launchPreview = screen.getByRole('status');
    expect(launchPreview.textContent).toContain('Location: Project root (HEAD) at /project');
    expect(launchPreview.textContent).toContain('Use checkout (This launch)');
    expect(launchPreview.textContent).toContain('Merge then remove (Plan)');
    expect(launchPreview.textContent).toContain('Allowed (Squad)');
    expect(launchPreview.textContent).toContain('lint (Default)');
    expect(launchPreview.textContent).toContain('Fail run (Default)');
    expect(screen.queryByText('secret')).toBeNull();
  });

  it('invalidates approval immediately and debounces an expensive preview', async () => {
    vi.useFakeTimers();
    setup(); preview.mockResolvedValue(response());
    const valid = vi.fn();
    render(<Harness valid={valid} />);
    expect(valid).toHaveBeenCalledWith(false);
    expect(preview).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(preview).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(valid).toHaveBeenLastCalledWith(true));
    fireEvent.click(screen.getByRole('button', { name: 'Customize launch' }));
    fireEvent.change(screen.getByLabelText('Push'), { target: { value: 'true' } });
    expect(valid).toHaveBeenLastCalledWith(false);
    expect(preview).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('makes named checks editable from empty mode and preserves typing', () => {
    const onChange = vi.fn(); const { rerender } = render(<SquadLaunchPolicyFields value={{}} onChange={onChange} disabled={false} />);
    fireEvent.change(screen.getByLabelText('Named checks mode'), { target: { value: 'named' } });
    expect(onChange).toHaveBeenLastCalledWith({ checks: [''] });
    rerender(<SquadLaunchPolicyFields value={{ checks: [''] }} onChange={onChange} disabled={false} />);
    const input = screen.getByLabelText('Named checks input');
    fireEvent.change(input, { target: { value: 'lint, test' } });
    expect(onChange).toHaveBeenLastCalledWith({ checks: ['lint', 'test'] });
    expect((input as HTMLInputElement).value).toBe('lint, test');
    fireEvent.change(screen.getByLabelText('Named checks mode'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it('uses policy field isolation only when checkout is excluded', () => {
    const { rerender } = render(<SquadLaunchPolicyFields value={{}} onChange={vi.fn()} disabled={false} />);
    expect(screen.getByLabelText('Worktree isolation')).toBeTruthy();
    expect(screen.getAllByRole('option', { name: 'Use default' })).toHaveLength(4);
    expect(screen.getByText(/Use default follows the plan, then Squad settings, then defaults/)).toBeTruthy();
    expect(screen.queryByText(/Inherit resolved/)).toBeNull();
    rerender(<SquadLaunchPolicyFields value={{}} onChange={vi.fn()} disabled={false} includeCheckout />);
    expect(screen.queryByLabelText('Worktree isolation')).toBeNull();
    expect(screen.getAllByRole('option', { name: 'Use default' })).toHaveLength(3);
  });

  it('updates every policy selector and supports no checks', () => {
    const onChange = vi.fn();
    const { rerender } = render(<SquadLaunchPolicyFields value={{}} onChange={onChange} disabled={false} />);
    fireEvent.change(screen.getByLabelText('Worktree isolation'), { target: { value: 'true' } });
    expect(onChange).toHaveBeenLastCalledWith({ worktree: true });
    rerender(<SquadLaunchPolicyFields value={{ worktree: true }} onChange={onChange} disabled={false} />);
    fireEvent.change(screen.getByLabelText('On complete'), { target: { value: 'delete' } });
    expect(onChange).toHaveBeenLastCalledWith({ worktree: true, onComplete: 'delete' });
    rerender(<SquadLaunchPolicyFields value={{ worktree: true, onComplete: 'delete' }} onChange={onChange} disabled={false} />);
    fireEvent.change(screen.getByLabelText('Push'), { target: { value: 'false' } });
    expect(onChange).toHaveBeenLastCalledWith({ worktree: true, onComplete: 'delete', push: false });
    fireEvent.change(screen.getByLabelText('Named checks mode'), { target: { value: 'none' } });
    expect(onChange).toHaveBeenLastCalledWith({ worktree: true, onComplete: 'delete', checks: [] });
  });

  it('respects disabled fields and reset clears every override', async () => {
    setup(); preview.mockResolvedValue(response());
    const changes = vi.fn();
    render(<SquadLaunchSettings teamId="team" projectId="p1" goal="goal" coordinationMode="structured" value={{ worktree: true, push: true, failurePolicyDefault: 'fail-run' }} onChange={changes} disabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Customize launch' }));
    expect(screen.getByLabelText('Checkout')).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Reset launch settings' })).toHaveProperty('disabled', true);
    cleanup();
    render(<SquadLaunchSettings teamId="team" projectId="p1" goal="goal" coordinationMode="structured" value={{ worktree: true, push: true, failurePolicyDefault: 'fail-run' }} onChange={changes} disabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Customize launch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset launch settings' }));
    expect(changes).toHaveBeenLastCalledWith({});
  });

  it('maps checkout tri-state and preserves missing branch choice', async () => {
    setup(); preview.mockResolvedValue(response()); render(<Harness initial={{ target: { kind: 'worktree', branch: 'gone' }, worktree: false, failurePolicyDefault: 'fail-run' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Customize launch' }));
    await vi.waitFor(() => expect(screen.getByRole('option', { name: 'gone (missing worktree)' })).toBeTruthy());
    const checkout = screen.getByLabelText('Checkout');
    expect((checkout as HTMLSelectElement).value).toBe('worktree:gone');
    fireEvent.change(checkout, { target: { value: '' } });
    await vi.waitFor(() => expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ failurePolicyDefault: 'fail-run' })));
    fireEvent.change(checkout, { target: { value: 'selected-checkout' } });
    await vi.waitFor(() => expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ worktree: false, failurePolicyDefault: 'fail-run' })));
    fireEvent.change(checkout, { target: { value: 'new-worktree' } });
    await vi.waitFor(() => expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ worktree: true })));
  });

  it('maps project-root and registered worktree checkout choices', async () => {
    listProjects.mockResolvedValue([project]); listWorktrees.mockResolvedValue([{ path: '/trees/topic', branch: 'topic', head: 'abc', detached: false, bare: false, isMain: false }]); preview.mockResolvedValue(response());
    render(<Harness />); fireEvent.click(screen.getByRole('button', { name: 'Customize launch' }));
    const checkout = screen.getByLabelText('Checkout');
    await vi.waitFor(() => expect(screen.getByRole('option', { name: 'topic (existing worktree)' })).toBeTruthy());
    fireEvent.change(checkout, { target: { value: 'project-root' } });
    await vi.waitFor(() => expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ target: { kind: 'project-root' }, worktree: false })));
    fireEvent.change(checkout, { target: { value: 'worktree:topic' } });
    await vi.waitFor(() => expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ target: { kind: 'worktree', branch: 'topic' }, worktree: false })));
  });

  it('rejects failed preview and ignores stale success after input changes', async () => {
    vi.useFakeTimers();
    setup(); let first!: (value: ReturnType<typeof response>) => void;
    preview.mockImplementationOnce(() => new Promise((resolve) => { first = resolve; })).mockRejectedValueOnce(new Error('New preview failed'));
    const valid = vi.fn(); render(<Harness valid={valid} />);
    await vi.advanceTimersByTimeAsync(250);
    fireEvent.click(screen.getByRole('button', { name: 'Customize launch' }));
    fireEvent.change(screen.getByLabelText('Push'), { target: { value: 'true' } });
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toBe('New preview failed'));
    first(response());
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toBe('New preview failed'));
    expect(valid).not.toHaveBeenCalledWith(true);
  });

  it('invalidates pending preview after unmount', async () => {
    vi.useFakeTimers();
    setup(); let resolve!: (value: ReturnType<typeof response>) => void;
    preview.mockImplementation(() => new Promise((done) => { resolve = done; })); const valid = vi.fn(); const view = render(<Harness valid={valid} />);
    await vi.advanceTimersByTimeAsync(250);
    view.unmount(); resolve(response()); await Promise.resolve(); expect(valid).not.toHaveBeenCalledWith(true);
  });

  it('shows one neutral missing-selection message and tolerates project/worktree discovery failures', async () => {
    listProjects.mockRejectedValue(new Error('offline')); listWorktrees.mockRejectedValue(new Error('not a repo'));
    const valid = vi.fn();
    const { rerender } = render(<SquadLaunchSettings teamId="" projectId="p1" goal="goal" coordinationMode="freeform" value={{}} onChange={vi.fn()} disabled={false} onValidityChange={valid} />);
    await vi.waitFor(() => expect(screen.getByRole('status').textContent).toContain('Choose a Squad and Project in the fields above to preview this launch.'));
    expect(screen.queryByRole('alert')).toBeNull();
    rerender(<SquadLaunchSettings teamId="" projectId="p1" goal="goal" coordinationMode="freeform" value={{}} onChange={vi.fn()} disabled={false} onValidityChange={valid} />);
    expect(screen.getAllByText('Choose a Squad and Project in the fields above to preview this launch.')).toHaveLength(1);
    expect(preview).not.toHaveBeenCalled();
    expect(valid).toHaveBeenCalledWith(false);
  });

  it('does not request worktrees for a remote Project', async () => {
    listProjects.mockResolvedValue([{ ...project, remote: { host: 'ssh.example', user: 'me' } }]); preview.mockResolvedValue(response());
    render(<Harness />);
    await vi.waitFor(() => expect(preview).toHaveBeenCalled());
    expect(listWorktrees).not.toHaveBeenCalled();
  });

  it('shows generated and user-owned trusted locations', async () => {
    setup();
    preview.mockResolvedValueOnce(response({ location: { kind: 'new-worktree', projectId: 'p1', baseBranch: 'main', isolationSource: 'default' } }));
    const generated = render(<Harness />);
    await vi.waitFor(() => expect(screen.getByText(/path assigned at launch/)).toBeTruthy());
    generated.unmount();
    preview.mockResolvedValueOnce(response({ location: { kind: 'worktree', projectId: 'p1', branch: 'topic', ownership: 'user' }, branch: 'topic', path: '/trees/topic' }));
    render(<Harness />);
    await vi.waitFor(() => expect(screen.getByText('Location: topic at /trees/topic (user-owned)')).toBeTruthy());
  });

  it('falls back to HEAD when a project-root preview omits its branch', async () => {
    setup(); preview.mockResolvedValue(response({ branch: undefined }));
    render(<Harness />);
    await vi.waitFor(() => expect(screen.getByText('Location: Project root (HEAD) at /project')).toBeTruthy());
  });

  it('renders readable resolved labels for schedule reuse', () => {
    render(<SquadResolvedLaunchDetails resolved={resolved} />);
    expect(screen.getByText('Failure policy')).toBeTruthy();
    expect(screen.getByText(/Fail run/)).toBeTruthy();
    expect(screen.queryByText('failurePolicyDefault')).toBeNull();
  });

  it('keeps resolved values in launch preview and clears named editing lock on blur', async () => {
    setup(); preview.mockResolvedValue(response()); render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Customize launch' }));
    fireEvent.change(screen.getByLabelText('Named checks mode'), { target: { value: 'named' } });
    fireEvent.change(screen.getByLabelText('Named checks input'), { target: { value: 'lint' } });
    fireEvent.blur(screen.getByLabelText('Named checks input'));
    expect(screen.queryByRole('button', { name: 'Review resolved settings' })).toBeNull();
    await vi.waitFor(() => expect(screen.getByRole('status').textContent).toContain('Failure policy'));
  });
});
