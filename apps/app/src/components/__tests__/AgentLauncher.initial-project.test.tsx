/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  teamProps: [] as Array<Record<string, unknown>>,
  data: {
    restoreTerminal: vi.fn(), loadProjects: vi.fn(), projects: [] as unknown[],
    harnessCursorEnabled: false, harnessCodexEnabled: false, harnessPiEnabled: false, harnessGrokEnabled: false,
    harnessMastracodeEnabled: false, harnessAfcodeEnabled: false,
    composerShowCliAgent: true, composerShowModern: true, composerShowAutonomousTeam: true, teamJobLaunchEnabled: true
  }
}));

vi.mock('../../lib/product-client.js', () => ({
  product: { projects: { ensureQuickAgent: vi.fn(async () => ({ ok: false, message: 'none' })) } }
}));
vi.mock('../../store.js', () => ({
  useData: Object.assign((sel: (s: unknown) => unknown) => sel(state.data), { getState: () => state.data }),
  useTeams: (sel: (s: unknown) => unknown) => sel({ teams: [{ id: 't1', name: 'Team' }] })
}));
vi.mock('../../lib/use-launch-mode-preference.js', () => ({ useLaunchModePreference: () => ['team', vi.fn()] }));
vi.mock('../../hooks/useDialogFocusTrap.js', () => ({ useDialogFocusTrap: () => undefined }));
vi.mock('../composer/ComposerDraft.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../composer/ComposerDraft.js')>(),
  ComposerDraftProvider: ({ children }: { children: unknown }) => <>{children as never}</>
}));
vi.mock('../AgentConversationHistory.js', () => ({ AgentConversationHistory: () => null }));
vi.mock('../ThreadCommandComposer.js', () => ({ ThreadCommandComposer: () => null }));
vi.mock('../LegacyAgentHomeComposer.js', () => ({ LegacyAgentHomeComposer: () => null }));
vi.mock('../TeamComposer.js', () => ({
  TeamComposer: (props: Record<string, unknown>) => { state.teamProps.push(props); return <div data-testid="team-composer" />; }
}));
vi.mock('../LaunchModeSegmented.js', () => ({ LaunchModeSegmented: () => null }));

import { AgentLauncher } from '../AgentLauncher.js';

afterEach(() => { cleanup(); state.teamProps = []; });

describe('AgentLauncher initialProjectId', () => {
  it('preselects the project a row "+" opened it for, without pinning the composer', () => {
    render(<AgentLauncher onClose={vi.fn()} initialProjectId="remote-1" />);
    expect(state.teamProps.at(-1)).toMatchObject({ project: undefined, composerProjectId: 'remote-1' });
  });

  it('overrides a retained launcher draft pick', () => {
    render(<AgentLauncher onClose={vi.fn()} />);
    act(() => { (state.teamProps.at(-1)!.onComposerProjectIdChange as (id: string) => void)('local-1'); });
    expect(state.teamProps.at(-1)).toMatchObject({ composerProjectId: 'local-1' });
    cleanup();
    render(<AgentLauncher onClose={vi.fn()} initialProjectId="remote-1" />);
    expect(state.teamProps.at(-1)).toMatchObject({ composerProjectId: 'remote-1' });
  });

  it('keeps a row "+" pick out of the generic launcher draft', () => {
    render(<AgentLauncher onClose={vi.fn()} />);
    act(() => { (state.teamProps.at(-1)!.onComposerProjectIdChange as (id: string) => void)('local-1'); });
    cleanup();
    render(<AgentLauncher onClose={vi.fn()} initialProjectId="remote-1" />);
    expect(state.teamProps.at(-1)).toMatchObject({ composerProjectId: 'remote-1' });
    cleanup();
    render(<AgentLauncher onClose={vi.fn()} />);
    expect(state.teamProps.at(-1)).toMatchObject({ composerProjectId: 'local-1' });
  });

  it('lets a pinned project win over initialProjectId', () => {
    const project = { id: 'pinned', name: 'Pinned', path: '/p' } as never;
    render(<AgentLauncher project={project} onClose={vi.fn()} initialProjectId="remote-1" />);
    expect(state.teamProps.at(-1)).toMatchObject({ composerProjectId: 'pinned' });
  });
});
