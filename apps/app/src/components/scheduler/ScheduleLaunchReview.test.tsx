/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { resolveAllLaunch } from '@zana-ai/zcc-domain/launch-options';
const preview = vi.hoisted(() => vi.fn());
vi.mock('../../lib/product-client.js', () => ({ product: { scheduler: { previewTeamLaunch: preview } } }));
import { ScheduleLaunchReview } from './ScheduleLaunchReview.js';
const task = { id: 's', kind: 'team', teamId: 't', projectId: 'p', name: 'Review', description: 'Fallback', prompt: 'Goal', launchOptions: { push: false, checks: [] } };
afterEach(() => { cleanup(); preview.mockReset(); });
it('requires explicit confirmation after showing trusted resolved settings', async () => {
  preview.mockResolvedValue({ ok: true, value: { previewToken: 'bound-token', resolvedLaunch: resolveAllLaunch({ launch: task.launchOptions, squad: { worktreeIsolation: true } }) } });
  const confirm = vi.fn();
  render(<ScheduleLaunchReview task={task as never} onConfirm={confirm} onCancel={vi.fn()} />);
  expect(confirm).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(screen.getByText('Worktree isolation')).toBeTruthy());
  expect(preview).toHaveBeenCalledWith('s');
  expect(screen.getByText('No checks')).toBeTruthy();
  expect(screen.getByText('Failure policy')).toBeTruthy();
  expect(screen.getByText('Fail run')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Launch schedule' }));
  expect(confirm).toHaveBeenCalledWith('bound-token');
});
it('renders HEAD when a project-root preview has no branch', async () => {
  preview.mockResolvedValue({ ok: true, value: { previewToken: 'bound-token', resolvedLaunch: resolveAllLaunch({}), location: { kind: 'project-root', projectId: 'p' }, path: '/project' } });
  render(<ScheduleLaunchReview task={task as never} onConfirm={vi.fn()} onCancel={vi.fn()} />);
  await vi.waitFor(() => expect(screen.getByText('Location: HEAD - /project')).toBeTruthy());
});
it('uses provided planning and description fallback, and blocks failed previews', async () => {
  preview.mockResolvedValue({ ok: false, message: 'Invalid supplied plan' });
  const confirm = vi.fn(); const cancel = vi.fn();
  render(<ScheduleLaunchReview task={{ ...task, prompt: ' ', planSource: 'provided' } as never} onConfirm={confirm} onCancel={cancel} />);
  await vi.waitFor(() => expect(screen.getByText('Invalid supplied plan')).toBeTruthy());
  expect(preview).toHaveBeenCalledWith('s');
  expect((screen.getByRole('button', { name: 'Launch schedule' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(cancel).toHaveBeenCalledOnce(); expect(confirm).not.toHaveBeenCalled();
});
it('reports rejected preview transport and ignores completion after unmount', async () => {
  preview.mockRejectedValue(new Error('Owner offline'));
  const view = render(<ScheduleLaunchReview task={{ ...task, prompt: '', description: '' } as never} onConfirm={vi.fn()} onCancel={vi.fn()} />);
  await vi.waitFor(() => expect(screen.getByText('Owner offline')).toBeTruthy());
  expect(preview).toHaveBeenCalledWith('s');
  view.unmount();
});

it('falls back safely on non-Error rejection and ignores late replies', async () => {
  preview.mockRejectedValue('offline');
  const view = render(<ScheduleLaunchReview task={{ ...task, teamId: undefined, name: '', description: '', prompt: '' } as never} onConfirm={vi.fn()} onCancel={vi.fn()} />);
  await vi.waitFor(() => expect(screen.getByText('Launch preview unavailable')).toBeTruthy());
  expect(preview).toHaveBeenCalledWith('s');
  view.unmount();
  let finish!: (value: unknown) => void;
  preview.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const late = render(<ScheduleLaunchReview task={task as never} onConfirm={vi.fn()} onCancel={vi.fn()} />);
  late.unmount();
  finish({ ok: true, value: { resolvedLaunch: resolveAllLaunch({}) } });
});
