/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SquadLaunchPrefill } from '@zana-ai/zcc-domain/squad-proposal';

const state = vi.hoisted(() => ({
  stored: 'thread' as 'thread' | 'agent' | 'team',
  setStored: vi.fn(),
  teamProps: [] as Array<Record<string, unknown>>,
  data: {
    restoreTerminal: vi.fn(), loadProjects: vi.fn(), projects: [] as unknown[],
    harnessCursorEnabled: false, harnessCodexEnabled: false, harnessPiEnabled: false, harnessGrokEnabled: false,
    harnessMastracodeEnabled: false, harnessAfcodeEnabled: false,
    composerShowCliAgent: true, composerShowModern: true, composerShowAutonomousTeam: true, teamJobLaunchEnabled: true
  }
}));

vi.mock('../../lib/product-client.js', () => ({ product: { projects: { ensureQuickAgent: vi.fn() } } }));
vi.mock('../../store.js', () => ({
  useData: Object.assign((sel: (s: unknown) => unknown) => sel(state.data), { getState: () => state.data }),
  useTeams: (sel: (s: unknown) => unknown) => sel({ teams: [{ id: 't1', name: 'Team' }] })
}));
vi.mock('../../lib/use-launch-mode-preference.js', () => ({ useLaunchModePreference: () => [state.stored, state.setStored] }));
vi.mock('../../hooks/useDialogFocusTrap.js', () => ({ useDialogFocusTrap: () => undefined }));
vi.mock('../composer/ComposerDraft.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../composer/ComposerDraft.js')>(),
  ComposerDraftProvider: ({ children }: { children: unknown }) => <>{children as never}</>
}));
vi.mock('../AgentConversationHistory.js', () => ({ AgentConversationHistory: () => null }));
vi.mock('../ThreadCommandComposer.js', () => ({ ThreadCommandComposer: () => <div data-testid="thread-composer" /> }));
vi.mock('../LegacyAgentHomeComposer.js', () => ({ LegacyAgentHomeComposer: () => <div data-testid="agent-composer" /> }));
vi.mock('../TeamComposer.js', () => ({
  TeamComposer: (props: Record<string, unknown>) => { state.teamProps.push(props); return <div data-testid="team-composer" />; }
}));
vi.mock('../LaunchModeSegmented.js', () => ({
  LaunchModeSegmented: ({ onChange }: { onChange: (mode: string) => void }) => (
    <button type="button" onClick={() => onChange('thread')}>switch to Modern</button>
  )
}));

import { AgentLauncher } from '../AgentLauncher.js';

const prefill: SquadLaunchPrefill = {
  proposalId: 'prop-1', projectId: 'p1', teamId: 't1', coordinationMode: 'structured', goal: 'Do it', sources: []
};
const project = { id: 'p1', name: 'Project', path: '/p' } as never;

afterEach(() => { cleanup(); state.teamProps = []; state.stored = 'thread'; state.setStored.mockReset(); });

describe('AgentLauncher Squad pre-fill', () => {
  it('opens on the Squad composer with the pre-fill, ignoring the stored mode', () => {
    render(<AgentLauncher project={project} onClose={vi.fn()} initialMode="team" squadPrefill={prefill} />);
    expect(screen.getByTestId('team-composer')).toBeTruthy();
    expect(screen.queryByTestId('thread-composer')).toBeNull();
    expect(state.teamProps.at(-1)).toMatchObject({ prefill, composerProjectId: 'p1' });
    // Forcing Squad mode for a reviewed proposal never rewrites the stored preference.
    expect(state.setStored).not.toHaveBeenCalled();
  });

  it('uses the pre-fill project when no project is pinned', () => {
    render(<AgentLauncher onClose={vi.fn()} initialMode="team" squadPrefill={prefill} />);
    expect(state.teamProps.at(-1)).toMatchObject({ composerProjectId: 'p1' });
  });

  it('opens a proposal on its own draft, so a retained launcher draft cannot override its project', () => {
    render(<AgentLauncher onClose={vi.fn()} initialMode="team" />);
    act(() => { (state.teamProps.at(-1)!.onComposerProjectIdChange as (id: string) => void)('other'); });
    expect(state.teamProps.at(-1)).toMatchObject({ composerProjectId: 'other' });
    cleanup();
    render(<AgentLauncher onClose={vi.fn()} initialMode="team" squadPrefill={prefill} />);
    expect(state.teamProps.at(-1)).toMatchObject({ composerProjectId: 'p1' });
  });

  it('keeps the stored mode without initialMode, and a manual mode pick leaves the forced Squad mode', () => {
    render(<AgentLauncher project={project} onClose={vi.fn()} />);
    expect(screen.getByTestId('thread-composer')).toBeTruthy();
    cleanup();
    render(<AgentLauncher project={project} onClose={vi.fn()} initialMode="team" squadPrefill={prefill} />);
    fireEvent.click(screen.getByText('switch to Modern'));
    expect(state.setStored).toHaveBeenCalledWith('thread');
    expect(screen.getByTestId('thread-composer')).toBeTruthy();
  });
});
