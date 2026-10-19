/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const startJob = vi.fn();
const pushToast = vi.fn();
const openProjectSettings = vi.fn();
const focus = vi.fn();
const clear = vi.fn();

vi.mock('../../lib/product-client.js', () => ({
  product: {
    executionSources: { pick: vi.fn() },
    projects: { ensureQuickAgent: async () => ({ ok: false as const, code: 'no-op', message: undefined }) },
    teams: { startJob: (...args: unknown[]) => startJob(...args) },
    fs: { uploadToRemote: vi.fn(), uploadProjectAttachmentToRemote: vi.fn() }
  }
}));

const dataState = { projects: [{ id: 'p1', name: 'Project One' }], loadProjects: vi.fn(async () => undefined) };
const teamsFixture = [{ id: 't1', name: 'Team One' }];

vi.mock('../../store.js', () => ({
  useData: Object.assign(
    (selector: (s: typeof dataState) => unknown) => selector(dataState),
    { getState: () => dataState }
  ),
  useTeams: (selector: (s: { teams: typeof teamsFixture }) => unknown) => selector({ teams: teamsFixture }),
  useUi: (selector: (s: { pushToast: typeof pushToast; openProjectSettings: typeof openProjectSettings }) => unknown) => selector({ pushToast, openProjectSettings })
}));

vi.mock('../composer/use-composer-prompt-field.js', () => ({
  useComposerPromptField: () => ({
    captureRevision: () => 0, clearIfRevision: vi.fn(),
    text: 'do the thing', images: [], editor: null, dropOver: false, dropHandlers: {}, canAttach: false,
    attachPickedFiles: vi.fn(), menuOpen: false, suggestions: [], highlighted: 0, triggerKind: null,
    applySuggestion: vi.fn(), handleChromeKeyDown: vi.fn(), typeaheadOpen: false,
    serialize: () => ({ text: 'do the thing', mentions: [] }), clear, insertText: vi.fn(), setText: vi.fn(), focus
  })
}));

vi.mock('../thread/voice/useVoiceInput.js', () => ({
  useVoiceInput: () => ({ state: 'idle', stream: null, stop: vi.fn(), cancel: vi.fn(), start: vi.fn(), isSupported: false, available: false, canStart: false })
}));

vi.mock('../ComposerProjectPicker.js', () => ({
  ComposerProjectPicker: ({ onChange, projects }: { onChange: (id: string) => void; projects: ReadonlyArray<{ id: string; name: string }> }) => (
    <div>{projects.map((p) => <button key={p.id} type="button" data-testid={`pick-project-${p.id}`} onClick={() => onChange(p.id)}>{p.name}</button>)}</div>
  )
}));
vi.mock('../composer/ComposerPromptField.js', () => ({ ComposerPromptField: () => <div /> }));
vi.mock('../ui/PopoverPicklist.js', () => ({ PopoverPicklist: () => <div /> }));
vi.mock('../../plugins/PluginComposerChrome.js', () => ({
  PluginComposerChrome: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

import { TeamComposer } from '../TeamComposer.js';

const failure = {
  ok: false,
  code: 'REQUIREMENT_UNAVAILABLE',
  message: 'Unit "write-note" can\'t run here. Missing for this project: no-such-skill.',
  requirementFailure: {
    workUnits: [
      { id: 'write-note', title: 'Write a note', missingSkills: ['no-such-skill'], missingMcpServers: [] },
      { id: 'deploy', title: 'Deploy', missingSkills: [], missingMcpServers: ['no-such-server'] }
    ]
  }
};

const launch = () => {
  fireEvent.click(screen.getByTestId('pick-project-p1'));
  fireEvent.click(screen.getByTestId('team-command-send'));
};

describe('TeamComposer requirement guidance panel', () => {
  beforeEach(() => { startJob.mockReset(); });
  afterEach(() => {
    cleanup();
    pushToast.mockClear();
    openProjectSettings.mockClear();
    focus.mockClear();
    clear.mockClear();
  });

  it('shows the pre-worker guidance panel listing only missing capabilities per unit', async () => {
    startJob.mockResolvedValueOnce(failure);
    render(<TeamComposer />);
    launch();

    const panel = await screen.findByRole('alert');
    expect(within(panel).getByRole('heading', { name: 'Squad requirements need attention' })).toBeTruthy();
    expect(panel.textContent).toContain('No workers started. Resolve requirements, then launch again.');
    const units = panel.querySelectorAll('.team-requirement-failure-unit');
    expect(units).toHaveLength(2);
    // Unit 1 lists only the skill, unit 2 only the MCP server (no empty headings).
    expect(within(units[0] as HTMLElement).getByText('no-such-skill')).toBeTruthy();
    expect(within(units[0] as HTMLElement).queryByText('Missing MCP servers')).toBeNull();
    expect(within(units[1] as HTMLElement).getByText('no-such-server')).toBeTruthy();
    expect(within(units[1] as HTMLElement).queryByText('Missing Skills')).toBeNull();
    // Resolution paths: configure the project, edit the plan, or switch project / use a normal agent.
    expect(panel.textContent).toContain('Configure this project or edit this plan to meet requirements.');
    expect(panel.textContent).toContain('Choose another project');
    expect(panel.textContent).toContain('Complete this work without these Skills or MCP servers.');
  });

  it('does not raise the generic "Squad launch failed" error or toast for a requirement rejection', async () => {
    startJob.mockResolvedValueOnce(failure);
    render(<TeamComposer />);
    launch();
    await screen.findByRole('alert');

    expect(screen.queryByTestId('team-command-error')).toBeNull();
    expect(pushToast).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(startJob).toHaveBeenCalledOnce();
  });

  it('keeps diagnostics under Details, naming the error code and every affected unit id', async () => {
    startJob.mockResolvedValueOnce(failure);
    render(<TeamComposer />);
    launch();
    const panel = await screen.findByRole('alert');
    const details = panel.querySelector('details') as HTMLElement;

    expect(within(details).getByText('Details')).toBeTruthy();
    expect(within(details).getByText('REQUIREMENT_UNAVAILABLE')).toBeTruthy();
    expect(within(details).getByText('write-note')).toBeTruthy();
    expect(within(details).getByText('deploy')).toBeTruthy();
    // Panel stays usable after toggling Details.
    fireEvent.click(within(details).getByText('Details'));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('Edit plan dismisses the panel and refocuses the goal without relaunching', async () => {
    startJob.mockResolvedValueOnce(failure);
    render(<TeamComposer />);
    launch();
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: 'Edit plan' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(focus).toHaveBeenCalled();
    expect(startJob).toHaveBeenCalledOnce();
  });

  it('Cancel closes the composer, starts nothing further, and shows no fallback launch', async () => {
    startJob.mockResolvedValueOnce(failure);
    const onClose = vi.fn();
    render(<TeamComposer onClose={onClose} />);
    launch();
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(startJob).toHaveBeenCalledOnce();
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('Configure project opens the launching project settings', async () => {
    startJob.mockResolvedValueOnce(failure);
    render(<TeamComposer />);
    launch();
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Configure project' }));
    expect(openProjectSettings).toHaveBeenCalledWith('p1');
  });

  it('prefixes any other launch rejection with "Squad launch failed: " and does not show the panel', async () => {
    startJob.mockResolvedValueOnce({ ok: false, code: 'INVALID', message: 'dependency cycle' });
    render(<TeamComposer />);
    launch();

    expect((await screen.findByTestId('team-command-error')).textContent).toBe('Squad launch failed: dependency cycle');
    expect(pushToast).toHaveBeenCalledWith('Squad launch failed: dependency cycle', 'error');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('falls back to the error code when a rejection has no message', async () => {
    startJob.mockResolvedValueOnce({ ok: false, code: 'UNKNOWN_PROJECT' });
    render(<TeamComposer />);
    launch();
    expect((await screen.findByTestId('team-command-error')).textContent).toBe('Squad launch failed: UNKNOWN_PROJECT');
  });

  it('shows a thrown launch error with the same prefix', async () => {
    startJob.mockRejectedValueOnce(new Error('ipc down'));
    render(<TeamComposer />);
    launch();
    expect((await screen.findByTestId('team-command-error')).textContent).toBe('Squad launch failed: ipc down');
  });
});

describe('TeamComposer availability-unknown panel', () => {
  beforeEach(() => { startJob.mockReset(); });
  afterEach(() => { cleanup(); });

  it('Cancel dismisses the availability-unknown panel when there is no onClose', async () => {
    startJob.mockResolvedValueOnce({
      ok: false,
      code: 'CAPABILITY_AVAILABILITY_UNKNOWN',
      message: 'unverified',
      availabilityUnknown: { failedSources: ['skills', 'mcp'] }
    });
    render(<TeamComposer />);
    launch();
    const panel = await screen.findByRole('alert');
    expect(panel.textContent).toContain('Project capabilities could not be verified');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(startJob).toHaveBeenCalledOnce();
  });
});
