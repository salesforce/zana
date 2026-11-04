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
const fieldOpts = vi.fn();
const voiceState = vi.hoisted(() => ({ state: 'idle' as 'idle' | 'recording' | 'transcribing' }));

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
const teamsFixture: Array<{ id: string; name: string; defaultPlanning?: 'infer' | 'provided' }> = [
  { id: 't1', name: 'Team One' },
  { id: 't2', name: 'Team Two', defaultPlanning: 'provided' }
];
// Tests that change the Squad list swap in a NEW array, as the real store does.
const teamsHolder: { current: typeof teamsFixture } = { current: teamsFixture };
const dataState = { projects: projectsFixture, loadProjects, teamDefaultCoordinationMode: 'freeform' };
const openProjectSettings = vi.fn();

vi.mock('../../store.js', () => ({
  useData: Object.assign(
    (selector: (s: typeof dataState) => unknown) => selector(dataState),
    { getState: () => dataState }
  ),
  useTeams: (selector: (s: { teams: typeof teamsFixture }) => unknown) => selector({ teams: teamsHolder.current }),
  useUi: (selector: (s: { pushToast: typeof pushToast; openProjectSettings: typeof openProjectSettings }) => unknown) => selector({ pushToast, openProjectSettings })
}));

vi.mock('../composer/use-composer-prompt-field.js', () => ({
  useComposerPromptField: (opts: unknown) => (fieldOpts(opts), {
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
    captureRevision: () => 0,
    clearIfRevision: vi.fn(),
    insertText: vi.fn(),
    setText: vi.fn(),
    focus: vi.fn()
  })
}));

vi.mock('../thread/voice/useVoiceInput.js', () => ({
  useVoiceInput: () => ({
    state: voiceState.state,
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
  PopoverPicklist: ({ id, value, options, onChange }: {
    id: string;
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange: (value: string) => void;
  }) => (
    <div data-testid={id} data-value={value}>
      {options.map((option) => (
        <button key={option.value} type="button" data-testid={`${id}:${option.value}`} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  )
}));

vi.mock('../../plugins/PluginComposerChrome.js', () => ({
  PluginComposerChrome: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

import { TeamComposer } from '../TeamComposer.js';
import type { SquadLaunchPrefill } from '@zana-ai/zcc-domain/squad-proposal';

const prefill: SquadLaunchPrefill = {
  proposalId: 'prop-1',
  projectId: 'p2',
  teamId: 't2',
  coordinationMode: 'structured',
  goal: 'Build the thing',
  title: 'Big job',
  summary: 'Why it matters',
  sources: [
    { id: 'c1', name: 'design.md', byteSize: 10, expiresAt: 1 },
    { id: 'c2', name: 'plan.md', byteSize: 20, expiresAt: 1 }
  ],
  proposerTitle: 'Design chat',
  planStepCount: 4
};

describe('TeamComposer prefill', () => {
  afterEach(() => {
    cleanup();
    voiceState.state = 'idle';
    startJob.mockReset();
    fieldOpts.mockClear();
  });

  it('seeds every field and the source chips', async () => {
    render(<TeamComposer prefill={prefill} />);
    expect(fieldOpts).toHaveBeenCalledWith(expect.objectContaining({ initialText: 'Build the thing', projectId: 'p2' }));
    expect(screen.getByTestId('team-picker').getAttribute('data-value')).toBe('t2');
    expect(screen.getByTestId('team-coordination-mode').getAttribute('data-value')).toBe('structured');
    expect((screen.getByLabelText(/Title/) as HTMLInputElement).value).toBe('Big job');
    expect((screen.getByLabelText(/Summary/) as HTMLTextAreaElement).value).toBe('Why it matters');
    expect(screen.getByText('design.md')).toBeTruthy();
    expect(screen.getByText('plan.md')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('project-picker-stub').getAttribute('data-value')).toBe('p2'));
    // Sources survive the project resolving to the prefill's project.
    expect(screen.getByText('design.md')).toBeTruthy();
  });

  it('swaps the toolbar for the voice recording bar while voice input is recording', () => {
    voiceState.state = 'recording';
    render(<TeamComposer prefill={prefill} />);
    expect(screen.getByTestId('thread-voice-bar')).toBeTruthy();
  });

  it('clears pre-filled sources when the project resolves elsewhere', async () => {
    render(<TeamComposer prefill={prefill} />);
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    await waitFor(() => expect(screen.queryByLabelText('Attached sources')).toBeNull());
  });

  it('shows the origin banner with the plan check and report-back note', () => {
    render(<TeamComposer prefill={prefill} />);
    const banner = screen.getByRole('note', { name: 'Prepared by a conversation' });
    expect(banner.textContent).toContain('Prepared by “Design chat”');
    expect(banner.textContent).toContain('Plan checked: 4 steps. ');
    expect(banner.textContent).toContain('Files are captured when you press Launch, so later edits are not included.');
    expect(banner.textContent).toContain('it reports back to that conversation.');
  });

  it('uses the singular for a one-step plan', () => {
    render(<TeamComposer prefill={{ ...prefill, planStepCount: 1 }} />);
    expect(screen.getByRole('note').textContent).toContain('Plan checked: 1 step. ');
  });

  it('falls back to a generic banner title and omits the plan note without steps', () => {
    render(<TeamComposer prefill={{ ...prefill, proposerTitle: undefined, planStepCount: undefined }} />);
    const banner = screen.getByRole('note');
    expect(banner.textContent).toContain('Prepared by “a conversation”');
    expect(banner.textContent).not.toContain('Plan checked');
  });

  it('launches with proposalId, source ids and the coordination mode', async () => {
    startJob.mockResolvedValue({ ok: true, value: { executionId: 'e', state: 'RUNNING' } });
    render(<TeamComposer prefill={prefill} />);
    fireEvent.click(screen.getByTestId('team-command-send'));
    await waitFor(() => expect(startJob).toHaveBeenCalledOnce());
    expect(startJob).toHaveBeenCalledWith({
      teamId: 't2',
      projectId: 'p2',
      goal: 'do the thing',
      coordinationMode: 'structured',
      proposalId: 'prop-1',
      title: 'Big job',
      summary: 'Why it matters',
      sourceCapabilityIds: ['c1', 'c2']
    });
  });

  it('shows the full path of a source outside the project, marked as such', () => {
    render(<TeamComposer prefill={{ ...prefill, sources: [
      { id: 'c1', name: 'design.md', byteSize: 10, expiresAt: Date.now() + 60_000, path: '~/vault/design.md', outsideProject: true },
      { id: 'c2', name: 'plan.md', byteSize: 20, expiresAt: Date.now() + 60_000 }
    ] }} />);
    const chips = screen.getByLabelText('Attached sources');
    expect(chips.textContent).toContain('~/vault/design.mdoutside the Project');
    expect(chips.textContent).toContain('plan.md');
    expect(chips.querySelectorAll('.launch-attachment-outside')).toHaveLength(1);
    expect(chips.querySelector('li[title="~/vault/design.md"]')).not.toBeNull();
  });

  it('removing a chip removes its id from the launch', async () => {
    startJob.mockResolvedValue({ ok: true, value: { executionId: 'e', state: 'RUNNING' } });
    render(<TeamComposer prefill={prefill} />);
    fireEvent.click(screen.getByLabelText('Remove design.md'));
    fireEvent.click(screen.getByTestId('team-command-send'));
    await waitFor(() => expect(startJob).toHaveBeenCalledOnce());
    expect(startJob.mock.calls[0][0].sourceCapabilityIds).toEqual(['c2']);
  });

  it('without a prefill: no banner, no proposalId, today\'s launch input', async () => {
    startJob.mockResolvedValue({ ok: true, value: { executionId: 'e', state: 'RUNNING' } });
    render(<TeamComposer />);
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(screen.getByTestId('pick-project-p1'));
    fireEvent.click(screen.getByTestId('team-command-send'));
    await waitFor(() => expect(startJob).toHaveBeenCalledOnce());
    expect(startJob).toHaveBeenCalledWith({
      teamId: 't1',
      projectId: 'p1',
      goal: 'do the thing',
      coordinationMode: 'freeform'
    });
  });

  it('switches the planning mode to the picked team\'s default', () => {
    render(<TeamComposer />);
    expect(screen.getByTestId('team-coordination-mode').getAttribute('data-value')).toBe('freeform');
    fireEvent.click(screen.getByTestId('team-picker:t2'));
    expect(screen.getByTestId('team-coordination-mode').getAttribute('data-value')).toBe('structured');
    // A team without a default leaves the mode alone.
    fireEvent.click(screen.getByTestId('team-picker:t1'));
    expect(screen.getByTestId('team-coordination-mode').getAttribute('data-value')).toBe('structured');
  });

  it('applies the auto-selected Squad\'s default planning without a prefill', () => {
    teamsHolder.current = [{ id: 't2', name: 'Team Two', isDefault: true, defaultPlanning: 'provided' }, { id: 't1', name: 'Team One' }];
    try {
      render(<TeamComposer />);
      expect(screen.getByTestId('team-picker').getAttribute('data-value')).toBe('t2');
      expect(screen.getByTestId('team-coordination-mode').getAttribute('data-value')).toBe('structured');
    } finally {
      teamsHolder.current = teamsFixture;
    }
  });

  it('sorts displayed Squads and defaults to the first alphabetically', () => {
    teamsHolder.current = [
      { id: 't2', name: 'Zulu', defaultPlanning: 'provided' },
      { id: 't1', name: 'Alpha' }
    ];
    try {
      render(<TeamComposer />);
      expect(screen.getByTestId('team-picker').getAttribute('data-value')).toBe('t1');
      expect([...screen.getByTestId('team-picker').querySelectorAll('button')].map((button) => button.textContent))
        .toEqual(['Alpha', 'Zulu']);
      fireEvent.click(screen.getByTestId('team-picker:t2'));
      expect(screen.getByTestId('team-picker').getAttribute('data-value')).toBe('t2');
    } finally {
      teamsHolder.current = teamsFixture;
    }
  });

  it('defaults to the squad flagged as default over alphabetical order', () => {
    teamsHolder.current = [
      { id: 't1', name: 'Alpha' },
      { id: 't2', name: 'Zulu', isDefault: true, defaultPlanning: 'provided' }
    ];
    try {
      render(<TeamComposer />);
      expect(screen.getByTestId('team-picker').getAttribute('data-value')).toBe('t2');
      expect(screen.getByTestId('team-coordination-mode').getAttribute('data-value')).toBe('structured');
    } finally {
      teamsHolder.current = teamsFixture;
    }
  });

  it('never overrides a planning mode the user already picked', () => {
    teamsHolder.current = [];
    try {
      const view = render(<TeamComposer />);
      fireEvent.click(screen.getByTestId('team-coordination-mode:freeform'));
      teamsHolder.current = [{ id: 't2', name: 'Team Two', defaultPlanning: 'provided' }];
      view.rerender(<TeamComposer />);
      expect(screen.getByTestId('team-picker').getAttribute('data-value')).toBe('t2');
      expect(screen.getByTestId('team-coordination-mode').getAttribute('data-value')).toBe('freeform');
    } finally {
      teamsHolder.current = teamsFixture;
    }
  });

  it('keeps a planning mode the user picked when another Squad is then picked', () => {
    render(<TeamComposer />);
    fireEvent.click(screen.getByTestId('team-coordination-mode:freeform'));
    fireEvent.click(screen.getByTestId('team-picker:t2'));
    expect(screen.getByTestId('team-picker').getAttribute('data-value')).toBe('t2');
    expect(screen.getByTestId('team-coordination-mode').getAttribute('data-value')).toBe('freeform');
  });

  it('keeps a reviewed proposal\'s planning mode when another team is picked', () => {
    render(<TeamComposer prefill={{ ...prefill, teamId: 't1', coordinationMode: 'freeform' }} />);
    fireEvent.click(screen.getByTestId('team-picker:t2'));
    expect(screen.getByTestId('team-coordination-mode').getAttribute('data-value')).toBe('freeform');
  });
});
