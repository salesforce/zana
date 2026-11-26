/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const startJob = vi.fn();
const previewJob = vi.fn();
const listWorktrees = vi.fn();
const pushToast = vi.fn();
const loadProjects = vi.fn(async () => undefined);

vi.mock('../../lib/product-client.js', () => ({
  product: {
    executionSources: { pick: vi.fn() },
    projects: { ensureQuickAgent: vi.fn(async () => ({ ok: false as const, code: 'no-op' })) },
    teams: { startJob: (...args: unknown[]) => startJob(...args), preview: (...args: unknown[]) => previewJob(...args) },
    git: { listWorktrees: (...args: unknown[]) => listWorktrees(...args) },
    fs: { uploadToRemote: vi.fn(), uploadProjectAttachmentToRemote: vi.fn() }
  }
}));

const projectsFixture = [
  { id: 'p1', name: 'Project One', path: '/repos/one' },
  { id: 'p2', name: 'Project Two', path: '/repos/two' },
  { id: 'pr', name: 'Remote', path: '/srv/remote', remote: { host: 'box' } }
];
let teamsFixture: Array<Record<string, unknown>> = [{ id: 't1', name: 'Team One' }];
const dataState = {
  projects: projectsFixture, loadProjects,
  squadDefaultTransport: 'caller', composerDefaultLaunchMode: null, composerLastTransportMode: null,
  composerShowCliAgent: true, composerShowModern: true
};

vi.mock('../../store.js', () => ({
  useData: Object.assign(
    (selector: (s: typeof dataState) => unknown) => selector(dataState),
    { getState: () => dataState }
  ),
  useTeams: (selector: (s: { teams: typeof teamsFixture }) => unknown) => selector({ teams: teamsFixture as never }),
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
  PopoverPicklist: ({ id, ariaLabel, value, options, onChange, disabled }: {
    id: string; ariaLabel: string; value: string;
    options: ReadonlyArray<{ value: string; label: string }>; onChange: (v: string) => void; disabled?: boolean;
  }) => (
    <div data-testid={`picklist-${id}`} aria-label={ariaLabel} data-value={value} data-disabled={String(Boolean(disabled))}>
      {options.map((o) => (
        <button key={o.value} type="button" disabled={disabled} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}));

vi.mock('../../plugins/PluginComposerChrome.js', () => ({
  PluginComposerChrome: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

import { TeamComposer } from '../TeamComposer.js';
import { resolveAllLaunch } from '@zana-ai/zcc-domain/launch-options';

describe('TeamComposer launch mode picker', () => {
  beforeEach(() => {
    window.localStorage.clear();
    teamsFixture = [{ id: 't1', name: 'Team One' }];
    previewJob.mockResolvedValue({ ok: true, value: { resolvedLaunch: resolveAllLaunch({ launch: {} }), location: { kind: 'project-root', projectId: 'p1' }, path: '/repos/one', branch: 'main', fingerprint: 'v1', launchOptions: {} } });
    startJob.mockResolvedValue({ ok: true, value: { executionId: 'e1', state: 'RUNNING' } });
    listWorktrees.mockResolvedValue([]);
  });
  afterEach(() => { cleanup(); startJob.mockReset(); previewJob.mockReset(); listWorktrees.mockReset(); });

  async function launch() {
    await waitFor(() => expect((screen.getByTestId('team-command-send') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('team-command-send'));
    await waitFor(() => expect(startJob).toHaveBeenCalledOnce());
    return startJob.mock.calls[0]![0] as Record<string, unknown>;
  }

  it('sends no pick by default and shows the resolved default', async () => {
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    const picker = await screen.findByLabelText('Squad launch mode');
    expect(picker.getAttribute('data-value')).toBe('default');
    expect(picker.textContent).toContain('Default: ');
    expect(await launch()).not.toHaveProperty('launchModePick');
  });

  it('sends the picked mode and remembers it', async () => {
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    await screen.findByLabelText('Squad launch mode');
    fireEvent.click(screen.getByRole('button', { name: 'CLI Agent' }));
    expect(window.localStorage.getItem('squad.launchModePick')).toBe('CLI');
    expect(await launch()).toMatchObject({ launchModePick: 'CLI' });
  });

  it('restores a remembered pick', async () => {
    window.localStorage.setItem('squad.launchModePick', 'MODERN');
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    const picker = await screen.findByLabelText('Squad launch mode');
    expect(picker.getAttribute('data-value')).toBe('MODERN');
  });

  it('is disabled and sends no pick when the Squad is pinned', async () => {
    window.localStorage.setItem('squad.launchModePick', 'MODERN');
    teamsFixture = [{ id: 't1', name: 'Team One', transport: 'CLI' }];
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    const picker = await screen.findByLabelText('Squad launch mode');
    expect(picker.getAttribute('data-disabled')).toBe('true');
    expect(picker.textContent).toContain('Pinned: CLI Agent');
    expect(await launch()).not.toHaveProperty('launchModePick');
  });

  it('warns when Modern is picked for a remote Project', async () => {
    window.localStorage.setItem('squad.launchModePick', 'MODERN');
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-pr'));
    expect((await screen.findByTestId('team-launch-mode-note')).textContent).toContain('local Project');
  });

  it('chip tooltip names the layer that decided the mode (UX-9)', async () => {
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    expect((await screen.findByTestId('team-launch-mode-chip')).getAttribute('title')).toBe('Default launch mode');
  });

  it('a launch-picker pick shows its source in the tooltip (UX-20)', async () => {
    window.localStorage.setItem('squad.launchModePick', 'CLI');
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    expect((await screen.findByTestId('team-launch-mode-chip')).getAttribute('title')).toBe('Chosen for this launch');
  });

  it('inherited Modern falls back to CLI with a plain notice on a remote Project (UX-10)', async () => {
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-pr'));
    expect((await screen.findByTestId('team-launch-mode-note')).textContent).toBe('Modern Squads need a local Project');
  });

  it('inherited Modern falls back to CLI when the Squad uses on-demand seats (UX-10)', async () => {
    teamsFixture = [{ id: 't1', name: 'Team One', slots: [{ personaId: 'p', startOnDemand: true }] } as never];
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    expect((await screen.findByTestId('team-launch-mode-note')).textContent).toContain('on-demand or fresh-session seats');
    expect(screen.getByLabelText('Squad launch mode').textContent).toContain('Default: CLI Agent');
  });
});
