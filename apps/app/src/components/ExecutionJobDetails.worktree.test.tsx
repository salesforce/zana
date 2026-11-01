/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionBoardSnapshot } from '@zana-ai/zcc-domain/product';
import { ExecutionJobDetails } from './ExecutionJobDetails.js';
import { useUi } from '../store';
import { usePersonas, useTeams } from '../stores/live.js';

/**
 * MT-3 steps 2, 5, 6, 7 at the renderer seam: retained-worktree controls on a
 * terminal Squad run, the destructive confirmation copy, and rejection toasts
 * for stale / active-follow-up refusals produced by main.
 */
const WORKTREE = { path: '/project/.worktrees/squad-1', branch: 'zcc/squad-1' };

function snapshot(patch: Partial<ExecutionBoardSnapshot['execution']> = {}): ExecutionBoardSnapshot {
  return {
    execution: {
      executionId: 'execution-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Ship', state: 'COMPLETED', attempt: 1,
      stateVersion: 7, createdAt: 1, updatedAt: 2, sources: [], blockers: [], recoveryAttention: false,
      work: { total: 0, completed: 0, counts: { PENDING: 0, READY: 0, CLAIMED: 0, BLOCKED: 0, COMPLETED: 0, FAILED: 0, SKIPPED: 0 }, assignments: [], rosterSlotIds: [] },
      retainedWorktree: WORKTREE,
      ...patch
    },
    events: [], nextAfter: 0, truncated: false, artifacts: [], artifactsTruncated: false
  } as ExecutionBoardSnapshot;
}

let worktreeAction: ReturnType<typeof vi.fn>;
let confirmSpy: ReturnType<typeof vi.fn>;

function mount(snap: ExecutionBoardSnapshot = snapshot()) {
  worktreeAction = vi.fn(async () => ({ ok: true as const }));
  Object.defineProperty(window, 'cc', {
    configurable: true,
    value: { executionBoard: { snapshot: vi.fn(async () => structuredClone(snap)), worktreeAction }, clipboard: { writeText: vi.fn() } }
  });
  return render(<ExecutionJobDetails projectId="project-1" executionId="execution-1" onClose={() => {}} />);
}

beforeEach(() => {
  confirmSpy = vi.fn(() => true);
  Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: confirmSpy });
});
afterEach(() => {
  cleanup();
  useUi.setState({ toasts: [] });
  useTeams.setState({ teams: [] });
  usePersonas.setState({ personas: [] });
});

describe('retained Squad worktree controls', () => {
  it('shows branch, path, and all four actions for a terminal run', async () => {
    mount();
    const section = await screen.findByLabelText('Retained Squad worktree');
    expect(section.textContent).toContain(WORKTREE.path);
    expect(section.textContent).toContain(WORKTREE.branch);
    for (const name of ['Instruct an agent', 'Leave worktree', 'Delete worktree', 'Force delete unmerged work']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('Delete asks for confirmation naming the path; Cancel makes no mutation', async () => {
    confirmSpy.mockReturnValue(false);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete worktree' }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const message = String(confirmSpy.mock.calls[0]?.[0]);
    expect(message).toContain('Delete retained worktree?');
    expect(message).toContain(WORKTREE.path);
    expect(message).toContain('This cannot be undone.');
    expect(worktreeAction).not.toHaveBeenCalled();
  });

  it('confirmed Delete sends the exact terminal stateVersion with action delete', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete worktree' }));
    await waitFor(() => expect(worktreeAction).toHaveBeenCalledWith('project-1', 'execution-1', 7, 'delete', undefined, undefined));
  });

  it('Force delete uses distinct confirmation copy and the force-delete action', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Force delete unmerged work' }));
    expect(String(confirmSpy.mock.calls[0]?.[0])).toContain('Force delete unmerged worktree?');
    await waitFor(() => expect(worktreeAction).toHaveBeenCalledWith('project-1', 'execution-1', 7, 'force-delete', undefined, undefined));
  });

  it('Leave needs no confirmation', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Leave worktree' }));
    await waitFor(() => expect(worktreeAction).toHaveBeenCalledWith('project-1', 'execution-1', 7, 'leave', undefined, undefined));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('Instruct is disabled until text is entered, then sends trimmed text and clears the field', async () => {
    mount();
    const instruct = await screen.findByRole('button', { name: 'Instruct an agent' }) as HTMLButtonElement;
    expect(instruct.disabled).toBe(true);
    const box = screen.getByLabelText('Follow-up agent instruction') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '  push this branch to origin  ' } });
    expect(instruct.disabled).toBe(false);
    fireEvent.click(instruct);
    await waitFor(() => expect(worktreeAction).toHaveBeenCalledWith('project-1', 'execution-1', 7, 'instruct', 'push this branch to origin', undefined));
    await waitFor(() => expect(box.value).toBe(''));
  });

  it('offers only roster personas, defaults to the coordinator, and sends the pick', async () => {
    useTeams.setState({ teams: [{ id: 'team-1', orchestratorPersonaId: 'lead', slots: [{ personaId: 'dev' }] }] as never });
    usePersonas.setState({ personas: [{ id: 'lead', name: 'Lead' }, { id: 'dev', name: 'Dev' }, { id: 'outsider', name: 'Outsider' }] as never });
    mount();
    const picker = await screen.findByLabelText('Follow-up persona') as HTMLSelectElement;
    expect(picker.value).toBe('');
    expect(Array.from(picker.options).map((o) => o.value)).toEqual(['', 'lead', 'dev']);
    fireEvent.change(screen.getByLabelText('Follow-up agent instruction'), { target: { value: 'go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Instruct an agent' }));
    await waitFor(() => expect(worktreeAction).toHaveBeenLastCalledWith('project-1', 'execution-1', 7, 'instruct', 'go', undefined));
    fireEvent.change(picker, { target: { value: 'dev' } });
    fireEvent.change(screen.getByLabelText('Follow-up agent instruction'), { target: { value: 'again' } });
    fireEvent.click(screen.getByRole('button', { name: 'Instruct an agent' }));
    await waitFor(() => expect(worktreeAction).toHaveBeenLastCalledWith('project-1', 'execution-1', 7, 'instruct', 'again', 'dev'));
  });

  it('shows the sanitized launch denial from main and omits the picker without a roster', async () => {
    mount();
    await screen.findByLabelText('Retained Squad worktree');
    expect(screen.queryByLabelText('Follow-up persona')).toBeNull();
    const message = 'Follow-up agent was not launched: harness unavailable';
    worktreeAction.mockResolvedValueOnce({ ok: false, message });
    fireEvent.change(screen.getByLabelText('Follow-up agent instruction'), { target: { value: 'go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Instruct an agent' }));
    await waitFor(() => expect(useUi.getState().toasts.some((t) => t.message === `Squad control failed: ${message}`)).toBe(true));
  });

  it.each([
    ['active follow-up', 'Worktree is in use by an active follow-up agent. Wait for it to exit, then try again.'],
    ['stale action', 'This action is unavailable because the Squad run resumed or changed state.']
  ])('surfaces main refusal (%s) as an error toast and keeps controls usable', async (_name, message) => {
    mount();
    worktreeAction.mockResolvedValueOnce({ ok: false, message });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete worktree' }));
    await waitFor(() => expect(useUi.getState().toasts.some((t) => t.message === `Squad control failed: ${message}`)).toBe(true));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Delete worktree' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('treats a thrown IPC failure as unknown status without leaving the UI busy', async () => {
    mount();
    worktreeAction.mockRejectedValueOnce(new Error('ipc down'));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave worktree' }));
    await waitFor(() => expect(useUi.getState().toasts.some((t) => t.message === 'Squad control failed: response status unknown')).toBe(true));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Leave worktree' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('hides every action once the worktree was left, and when there is no retained worktree', async () => {
    mount(snapshot({ retainedWorktree: { ...WORKTREE, disposition: 'left' } }));
    expect(await screen.findByText(/Worktree left by user/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete worktree' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Instruct an agent' })).toBeNull();
    cleanup();
    mount(snapshot({ retainedWorktree: undefined }));
    await screen.findByLabelText('Squad details');
    expect(screen.queryByLabelText('Retained Squad worktree')).toBeNull();
  });
});
