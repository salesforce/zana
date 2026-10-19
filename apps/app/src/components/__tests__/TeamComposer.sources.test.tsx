/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Real ExecutionSourceCapabilityView-shaped fixture the mocked pick() resolves.
const pickedSource = { id: 'src1', name: 'notes.txt', byteSize: 12, expiresAt: 0 };

const pick = vi.fn(async () => ({ ok: true as const, value: [pickedSource] }));
const ensureQuickAgent = vi.fn(async () => ({ ok: false as const, code: 'no-op', message: undefined }));
const startJob = vi.fn();
const uploadToRemote = vi.fn();
const pushToast = vi.fn();
const loadProjects = vi.fn(async () => undefined);

vi.mock('../../lib/product-client.js', () => ({
  product: {
    executionSources: { pick: (...args: unknown[]) => pick(...args) },
    projects: { ensureQuickAgent: (...args: unknown[]) => ensureQuickAgent(...args) },
    teams: { startJob: (...args: unknown[]) => startJob(...args) },
    fs: {
      uploadToRemote: (...args: unknown[]) => uploadToRemote(...args),
      uploadProjectAttachmentToRemote: vi.fn()
    }
  }
}));

const projectsFixture = [
  { id: 'p1', name: 'Project One' },
  { id: 'p2', name: 'Project Two' }
];
const teamsFixture = [{ id: 't1', name: 'Team One' }];
const dataState = { projects: projectsFixture, loadProjects };
const openProjectSettings = vi.fn();

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
    text: 'do the thing',
    images: [],
    editor: null,
    dropOver: false,
    dropHandlers: {},
    canAttach: false,
    attachPickedFiles: vi.fn(),
    menuOpen: false,
    suggestions: [],
    highlighted: 0,
    triggerKind: null,
    applySuggestion: vi.fn(),
    handleChromeKeyDown: vi.fn(),
    typeaheadOpen: false,
    serialize: () => ({ text: 'do the thing', mentions: [] }),
    clear: vi.fn(),
    captureRevision: () => 0, clearIfRevision: vi.fn(),
    insertText: vi.fn(),
    setText: vi.fn(),
    focus: vi.fn()
  })
}));

vi.mock('../thread/voice/useVoiceInput.js', () => ({
  useVoiceInput: () => ({
    state: 'idle',
    stream: null,
    stop: vi.fn(),
    cancel: vi.fn(),
    start: vi.fn(),
    isSupported: false,
    available: false,
    canStart: false
  })
}));

vi.mock('../ComposerProjectPicker.js', () => ({
  ComposerProjectPicker: ({
    value,
    onChange,
    projects
  }: {
    value: string;
    onChange: (id: string) => void;
    projects: ReadonlyArray<{ id: string; name: string }>;
  }) => (
    <div data-testid="project-picker-stub" data-value={value}>
      {projects.map((p) => (
        <button key={p.id} type="button" data-testid={`pick-project-${p.id}`} onClick={() => onChange(p.id)}>
          {p.name}
        </button>
      ))}
    </div>
  )
}));

vi.mock('../composer/ComposerPromptField.js', () => ({
  ComposerPromptField: () => <div data-testid="prompt-field-stub" />
}));

vi.mock('../ui/PopoverPicklist.js', () => ({
  PopoverPicklist: () => <div data-testid="popover-picklist-stub" />
}));

vi.mock('../../plugins/PluginComposerChrome.js', () => ({
  PluginComposerChrome: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

import { TeamComposer } from '../TeamComposer.js';

describe('TeamComposer source-capability clearing', () => {
  afterEach(() => {
    cleanup();
    pick.mockClear();
    startJob.mockClear();
    uploadToRemote.mockClear();
    pushToast.mockClear();
    openProjectSettings.mockClear();
  });

  it('clears previously picked source capabilities when the effective project changes', async () => {
    render(<TeamComposer />);

    // Select project one, then attach a source capability to it.
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Attach sources'));
    });
    await waitFor(() => expect(pick).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(screen.getByLabelText('Attached sources')).toBeTruthy());
    expect(screen.getByText('notes.txt')).toBeTruthy();

    // Switching the effective project must drop the stale capability id —
    // it belonged to project one and is meaningless (and unsafe to submit)
    // against project two.
    fireEvent.click(screen.getByTestId('pick-project-p2'));

    await waitFor(() => expect(screen.queryByLabelText('Attached sources')).toBeNull());
    expect(screen.queryByText('notes.txt')).toBeNull();
  });

  it('shows resolved per-unit requirements and cancels without another launch', async () => {
    startJob.mockResolvedValueOnce({
      ok: false,
      code: 'REQUIREMENT_UNAVAILABLE',
      message: 'work unit build requirement unavailable: skills: review',
      requirementFailure: { workUnits: [{ id: 'build', title: 'Build UI', missingSkills: ['review'], missingMcpServers: ['repo'] }] }
    });
    const onClose = vi.fn();
    render(<TeamComposer onClose={onClose} />);

    fireEvent.click(screen.getByTestId('pick-project-p1'));
    fireEvent.click(screen.getByTestId('team-command-send'));
    expect((await screen.findByRole('alert')).textContent).toContain('Build UI');
    expect(screen.getByText('Missing Skills')).toBeTruthy();
    expect(screen.getByText('review')).toBeTruthy();
    expect(screen.getByText('Missing MCP servers')).toBeTruthy();
    expect(screen.getByText('repo')).toBeTruthy();
    expect(screen.getByText(/Choose another project with project selector below/)).toBeTruthy();
    expect(screen.getByText(/Complete this work without these Skills or MCP servers/)).toBeTruthy();
    expect(screen.getByText('REQUIREMENT_UNAVAILABLE')).toBeTruthy();
    expect(screen.getByText('build')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Configure project' }));
    expect(openProjectSettings).toHaveBeenCalledWith('p1');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(startJob).toHaveBeenCalledOnce();
  });

  it('shows retry guidance for transient capability inventory failures without missing names', async () => {
    startJob.mockResolvedValueOnce({
      ok: false,
      code: 'CAPABILITY_AVAILABILITY_UNKNOWN',
      message: 'Project capability availability could not be verified',
      availabilityUnknown: { failedSources: ['skills', 'mcpServers'] }
    }).mockResolvedValueOnce({ ok: true, value: { executionId: 'execution-1', state: 'RUNNING' } });
    const onClose = vi.fn();
    render(<TeamComposer onClose={onClose} />);

    fireEvent.click(screen.getByTestId('pick-project-p1'));
    fireEvent.click(screen.getByTestId('team-command-send'));
    expect((await screen.findByRole('alert')).textContent).toContain('Project capabilities could not be verified');
    expect(screen.getByText(/Retry after connection or capability discovery is available/)).toBeTruthy();
    expect(screen.queryByText('review')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(startJob).toHaveBeenCalledTimes(2));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
