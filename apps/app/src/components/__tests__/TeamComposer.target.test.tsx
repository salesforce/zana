/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const startJob = vi.fn();
const listWorktrees = vi.fn();
const pushToast = vi.fn();
const loadProjects = vi.fn(async () => undefined);

vi.mock('../../lib/product-client.js', () => ({
  product: {
    executionSources: { pick: vi.fn() },
    projects: { ensureQuickAgent: vi.fn(async () => ({ ok: false as const, code: 'no-op' })) },
    teams: { startJob: (...args: unknown[]) => startJob(...args) },
    git: { listWorktrees: (...args: unknown[]) => listWorktrees(...args) },
    fs: { uploadToRemote: vi.fn(), uploadProjectAttachmentToRemote: vi.fn() }
  }
}));

const projectsFixture = [
  { id: 'p1', name: 'Project One', path: '/repos/one' },
  { id: 'p2', name: 'Project Two', path: '/repos/two' },
  { id: 'pr', name: 'Remote', path: '/srv/remote', remote: { host: 'box' } }
];
const teamsFixture = [{ id: 't1', name: 'Team One' }];
const dataState = { projects: projectsFixture, loadProjects };

vi.mock('../../store.js', () => ({
  useData: Object.assign(
    (selector: (s: typeof dataState) => unknown) => selector(dataState),
    { getState: () => dataState }
  ),
  useTeams: (selector: (s: { teams: typeof teamsFixture }) => unknown) => selector({ teams: teamsFixture }),
  useUi: (selector: (s: { pushToast: typeof pushToast; openProjectSettings: () => void }) => unknown) =>
    selector({ pushToast, openProjectSettings: vi.fn() })
}));

vi.mock('../composer/use-composer-prompt-field.js', () => ({
  useComposerPromptField: () => ({
    text: 'do the thing', images: [], editor: null, dropOver: false, dropHandlers: {}, canAttach: false,
    attachPickedFiles: vi.fn(), menuOpen: false, suggestions: [], highlighted: 0, triggerKind: null,
    applySuggestion: vi.fn(), handleChromeKeyDown: vi.fn(), typeaheadOpen: false,
    serialize: () => ({ text: 'do the thing', mentions: [] }),
    clear: vi.fn(), captureRevision: () => 0, clearIfRevision: vi.fn(),
    insertText: vi.fn(), setText: vi.fn(), focus: vi.fn()
  })
}));

vi.mock('../thread/voice/useVoiceInput.js', () => ({
  useVoiceInput: () => ({
    state: 'idle', stream: null, stop: vi.fn(), cancel: vi.fn(), start: vi.fn(),
    isSupported: false, available: false, canStart: false
  })
}));

vi.mock('../ComposerProjectPicker.js', () => ({
  ComposerProjectPicker: ({ projects, onChange }: { projects: ReadonlyArray<{ id: string; name: string }>; onChange: (id: string) => void }) => (
    <div>
      {projects.map((p) => (
        <button key={p.id} type="button" data-testid={`pick-project-${p.id}`} onClick={() => onChange(p.id)}>{p.name}</button>
      ))}
    </div>
  )
}));

vi.mock('../composer/ComposerPromptField.js', () => ({ ComposerPromptField: () => <div /> }));

vi.mock('../ui/PopoverPicklist.js', () => ({
  PopoverPicklist: ({ id, ariaLabel, value, options, onChange }: {
    id: string; ariaLabel: string; value: string;
    options: ReadonlyArray<{ value: string; label: string }>; onChange: (v: string) => void;
  }) => (
    <div data-testid={`picklist-${id}`} aria-label={ariaLabel} data-value={value}>
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}));

vi.mock('../../plugins/PluginComposerChrome.js', () => ({
  PluginComposerChrome: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

import { TeamComposer } from '../TeamComposer.js';

const worktree = (branch: string, extra: Record<string, unknown> = {}) => ({
  path: `/wt/${branch}`, branch, isMain: false, bare: false, detached: false, ...extra
});
const mainWt = worktree('main', { path: '/repos/one', isMain: true });

async function launchAndGetPayload() {
  fireEvent.click(screen.getByTestId('team-command-send'));
  await waitFor(() => expect(startJob).toHaveBeenCalledOnce());
  return startJob.mock.calls[0]![0] as Record<string, unknown>;
}

describe('TeamComposer Squad target picker', () => {
  beforeEach(() => {
    startJob.mockResolvedValue({ ok: true, value: { executionId: 'e1', state: 'RUNNING' } });
    listWorktrees.mockResolvedValue([mainWt, worktree('feat/a'), worktree('feat/b')]);
  });
  afterEach(() => {
    cleanup();
    startJob.mockReset();
    listWorktrees.mockReset();
    pushToast.mockClear();
  });

  it('is hidden when only Default is available', async () => {
    listWorktrees.mockResolvedValue([mainWt, worktree('x', { detached: true }), worktree('y', { bare: true })]);
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    await waitFor(() => expect(listWorktrees).toHaveBeenCalledWith('/repos/one'));
    await Promise.resolve();
    expect(screen.queryByLabelText('Squad target')).toBeNull();
  });

  it('is hidden when listWorktrees rejects', async () => {
    listWorktrees.mockRejectedValue(new Error('boom'));
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    await waitFor(() => expect(listWorktrees).toHaveBeenCalled());
    expect(screen.queryByLabelText('Squad target')).toBeNull();
  });

  it('shows Default, Project root and linked worktrees for a local Project', async () => {
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    const picker = await screen.findByLabelText('Squad target');
    const labels = Array.from(picker.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toEqual(['Default', 'Project root', 'Worktree: feat/a', 'Worktree: feat/b']);
  });

  it('sends a project-root target', async () => {
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    const picker = await screen.findByLabelText('Squad target');
    fireEvent.click(screen.getByRole('button', { name: 'Project root' }));
    await waitFor(() => expect(picker.getAttribute('data-value')).toBe('project-root'));
    expect(await launchAndGetPayload()).toMatchObject({ projectId: 'p1', target: { kind: 'project-root' } });
  });

  it('sends a worktree target by branch', async () => {
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    await screen.findByLabelText('Squad target');
    fireEvent.click(screen.getByRole('button', { name: 'Worktree: feat/b' }));
    expect(await launchAndGetPayload()).toMatchObject({ target: { kind: 'worktree', branch: 'feat/b' } });
  });

  it('sends no target for Default', async () => {
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    await screen.findByLabelText('Squad target');
    fireEvent.click(screen.getByRole('button', { name: 'Project root' }));
    fireEvent.click(screen.getByRole('button', { name: 'Default' }));
    const payload = await launchAndGetPayload();
    expect(payload).not.toHaveProperty('target');
  });

  it('resets the choice when the Project changes', async () => {
    listWorktrees.mockImplementation(async (path: string) =>
      path === '/repos/one' ? [mainWt, worktree('feat/a')] : [worktree('main', { isMain: true, path: '/repos/two' }), worktree('other')]
    );
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    await screen.findByLabelText('Squad target');
    fireEvent.click(screen.getByRole('button', { name: 'Worktree: feat/a' }));
    expect(screen.getByLabelText('Squad target').getAttribute('data-value')).toBe('worktree:feat/a');

    fireEvent.click(screen.getByTestId('pick-project-p2'));
    await waitFor(() => expect(listWorktrees).toHaveBeenCalledWith('/repos/two'));
    await screen.findByRole('button', { name: 'Worktree: other' });
    expect(screen.getByLabelText('Squad target').getAttribute('data-value')).toBe('');
    expect(screen.queryByRole('button', { name: 'Worktree: feat/a' })).toBeNull();
    expect(await launchAndGetPayload()).not.toHaveProperty('target');
  });

  it('does not list worktrees or show the picker for a remote Project', async () => {
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-pr'));
    await Promise.resolve();
    expect(listWorktrees).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Squad target')).toBeNull();
  });
});
