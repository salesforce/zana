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
    fs: { uploadToRemote: (...args: unknown[]) => uploadToRemote(...args) }
  }
}));

const projectsFixture = [
  { id: 'p1', name: 'Project One' },
  { id: 'p2', name: 'Project Two' }
];
const teamsFixture = [{ id: 't1', name: 'Team One' }];
const dataState = { projects: projectsFixture, loadProjects };

vi.mock('../../store.js', () => ({
  useData: Object.assign(
    (selector: (s: typeof dataState) => unknown) => selector(dataState),
    { getState: () => dataState }
  ),
  useTeams: (selector: (s: { teams: typeof teamsFixture }) => unknown) => selector({ teams: teamsFixture }),
  useUi: (selector: (s: { pushToast: typeof pushToast }) => unknown) => selector({ pushToast })
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
});
