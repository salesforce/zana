/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Real ExecutionSourceCapabilityView-shaped fixture the mocked pick() resolves.
const sources = [{ id: 'old1', name: 'one.md', byteSize: 1, expiresAt: 0 }, { id: 'old2', name: 'two.md', byteSize: 1, expiresAt: 0 }];

const pick = vi.fn(async () => ({ ok: true as const, value: sources }));
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

const renewal = {
  renewed: [{ previousId: 'old1', source: { id: 'new1', name: 'one.md', byteSize: 1, expiresAt: 9 }, changed: false }],
  dropped: [{ previousId: 'old2', name: 'two.md', reason: 'moved' as const }]
};
const ok = { ok: true as const, value: { executionId: 'e', state: 'RUNNING' } };
const attach = async () => {
  render(<TeamComposer />);
  fireEvent.click(screen.getByTestId('pick-project-p1'));
  await act(async () => { fireEvent.click(screen.getByLabelText('Attach sources')); });
  await waitFor(() => expect(screen.getByText('two.md')).toBeTruthy());
};
const idsOfCall = (n: number) => startJob.mock.calls[n][0].sourceCapabilityIds;

describe('TeamComposer renewed sources after a failed launch', () => {
  afterEach(() => { cleanup(); startJob.mockReset(); pushToast.mockClear(); pick.mockClear(); });

  it('swaps in renewed chips, explains the dropped one and relaunches with the new id', async () => {
    startJob.mockResolvedValueOnce({ ok: false, code: 'BOOM', message: 'nope', sources: renewal }).mockResolvedValueOnce(ok);
    await attach();
    fireEvent.click(screen.getByTestId('team-command-send'));
    await waitFor(() => expect(screen.getByText(/Attach two\.md again; it moved/)).toBeTruthy());
    expect(screen.queryByText('two.md')).toBeNull();
    expect(screen.getByText('one.md')).toBeTruthy();
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('Attach two.md again'), 'error');
    fireEvent.click(screen.getByTestId('team-command-send'));
    await waitFor(() => expect(startJob).toHaveBeenCalledTimes(2));
    expect(idsOfCall(0)).toEqual(['old1', 'old2']);
    expect(idsOfCall(1)).toEqual(['new1']);
  });

  it('renews before the availability-unknown panel so Retry sends the new id', async () => {
    startJob.mockResolvedValueOnce({ ok: false, code: 'CAPABILITY_AVAILABILITY_UNKNOWN', message: 'm', availabilityUnknown: { failedSources: ['skills'] }, sources: renewal }).mockResolvedValueOnce(ok);
    await attach();
    fireEvent.click(screen.getByTestId('team-command-send'));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(startJob).toHaveBeenCalledTimes(2));
    expect(idsOfCall(1)).toEqual(['new1']);
  });

  it('renews before the requirement panel so the next launch sends the new id', async () => {
    startJob.mockResolvedValueOnce({ ok: false, code: 'REQUIREMENT_UNAVAILABLE', message: 'm', requirementFailure: { workUnits: [] }, sources: renewal }).mockResolvedValueOnce(ok);
    await attach();
    fireEvent.click(screen.getByTestId('team-command-send'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit plan' }));
    fireEvent.click(screen.getByTestId('team-command-send'));
    await waitFor(() => expect(startJob).toHaveBeenCalledTimes(2));
    expect(idsOfCall(1)).toEqual(['new1']);
  });

  it('keeps the chips when the failure carries no sources', async () => {
    startJob.mockResolvedValueOnce({ ok: false, code: 'BOOM', message: 'nope' });
    await attach();
    fireEvent.click(screen.getByTestId('team-command-send'));
    await waitFor(() => expect(screen.getByText(/Squad launch failed: nope/)).toBeTruthy());
    expect(screen.getByText('one.md')).toBeTruthy();
    expect(screen.getByText('two.md')).toBeTruthy();
  });

  it('keeps the chips when startJob rejects', async () => {
    startJob.mockRejectedValueOnce(new Error('offline'));
    await attach();
    fireEvent.click(screen.getByTestId('team-command-send'));
    await waitFor(() => expect(screen.getByText(/Squad launch failed: offline/)).toBeTruthy());
    expect(screen.getByText('one.md')).toBeTruthy();
    expect(screen.getByText('two.md')).toBeTruthy();
  });

  it('does not bring back a chip removed while the launch was in flight', async () => {
    let finish!: (value: unknown) => void;
    startJob.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await attach();
    fireEvent.click(screen.getByTestId('team-command-send'));
    await waitFor(() => expect(startJob).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByLabelText('Remove one.md'));
    await act(async () => { finish({ ok: false, code: 'BOOM', message: 'nope', sources: renewal }); });
    await waitFor(() => expect(screen.getByText(/Squad launch failed: nope/)).toBeTruthy());
    expect(screen.queryByText('one.md')).toBeNull();
    expect(screen.queryByText('two.md')).toBeNull();
  });

  it('stays quiet about a dropped chip the user removed during the launch, and separates the sentences', async () => {
    let finish!: (value: unknown) => void;
    startJob.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await attach();
    fireEvent.click(screen.getByTestId('team-command-send'));
    await waitFor(() => expect(startJob).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByLabelText('Remove two.md'));
    await act(async () => { finish({ ok: false, code: 'BOOM', message: 'two.md moved or disappeared', sources: renewal }); });
    await waitFor(() => expect(screen.getByTestId('team-command-error')).toBeTruthy());
    expect(screen.getByTestId('team-command-error').textContent).toBe('Squad launch failed: two.md moved or disappeared');
    expect(pushToast).not.toHaveBeenCalledWith(expect.stringContaining('Attach two.md again'), 'error');
  });

  it('puts a full stop between the failure message and the attach-again notice', async () => {
    startJob.mockResolvedValueOnce({ ok: false, code: 'BOOM', message: 'two.md moved or disappeared', sources: renewal });
    await attach();
    fireEvent.click(screen.getByTestId('team-command-send'));
    await waitFor(() => expect(screen.getByTestId('team-command-error').textContent)
      .toBe("Squad launch failed: two.md moved or disappeared. Attach two.md again; it moved or can't be read."));
  });
});
