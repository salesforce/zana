// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Project } from '@zana-ai/zcc-domain/product';

const mocks = vi.hoisted(() => {
  const data = {
    projects: [] as unknown[],
    restoreTerminal: vi.fn(),
    loadProjects: vi.fn(),
    composerShowCliAgent: true,
    composerShowModern: true,
    composerShowAutonomousTeam: false,
    teamJobLaunchEnabled: false
  };
  return { data, teams: [] as unknown[], ensureQuickAgent: vi.fn() };
});

vi.mock('../../store.js', () => {
  const useData = Object.assign(
    (selector: (s: typeof mocks.data) => unknown) => selector(mocks.data),
    { getState: () => mocks.data }
  );
  return { useData, useTeams: (selector: (s: { teams: unknown[] }) => unknown) => selector({ teams: mocks.teams }) };
});
vi.mock('../../lib/product-client.js', () => ({ product: { projects: { ensureQuickAgent: mocks.ensureQuickAgent } } }));
vi.mock('../../hooks/useDialogFocusTrap.js', () => ({ useDialogFocusTrap: () => {} }));
vi.mock('../AgentConversationHistory.js', () => ({ AgentConversationHistory: () => <div data-testid="history" /> }));

type Stub = { composerProjectId?: string; onComposerProjectIdChange?: (id: string) => void; initialText?: string };
function stub(name: string) {
  return (props: Stub) => (
    <div data-testid={name} data-project={props.composerProjectId ?? ''} data-text={props.initialText ?? ''}>
      <button type="button" onClick={() => props.onComposerProjectIdChange?.('picked')}>{`pick-${name}`}</button>
    </div>
  );
}
vi.mock('../ThreadCommandComposer.js', () => ({ ThreadCommandComposer: stub('thread') }));
vi.mock('../LegacyAgentHomeComposer.js', () => ({ LegacyAgentHomeComposer: stub('legacy') }));
vi.mock('../TeamComposer.js', () => ({ TeamComposer: stub('team') }));

import { AgentLauncher } from '../AgentLauncher.js';
import { resetComposerSessions } from '../composer/composer-session.js';
import { readLaunchModePreference } from '../../lib/launch-mode-preference.js';

const project = (id: string) => ({ id, name: `Project ${id}`, path: `/p/${id}` }) as unknown as Project;

beforeEach(() => {
  localStorage.clear();
  resetComposerSessions();
  Object.assign(mocks.data, { projects: [], composerShowCliAgent: true, composerShowModern: true, composerShowAutonomousTeam: false, teamJobLaunchEnabled: false });
  mocks.teams = [];
  mocks.ensureQuickAgent.mockReset().mockResolvedValue({ ok: true, value: { id: 'scratch', name: 'Scratch' } });
  mocks.data.loadProjects.mockReset();
});
afterEach(cleanup);

describe('AgentLauncher launch mode and draft session', () => {
  it('switches launch mode, mounts the matching composer and remembers the mode', () => {
    mocks.teams = [{ id: 't' }];
    mocks.data.composerShowAutonomousTeam = true;
    render(<AgentLauncher onClose={() => {}} project={project('a')} initialPrompt="seed" />);
    expect(screen.getByTestId('thread').getAttribute('data-text')).toBe('seed');

    fireEvent.click(screen.getByRole('button', { name: 'CLI Agent' }));
    expect(screen.getByTestId('legacy')).toBeTruthy();
    expect(screen.queryByTestId('thread')).toBeNull();
    expect(readLaunchModePreference()).toBe('agent');

    fireEvent.click(screen.getByRole('button', { name: /Squad/ }));
    expect(screen.getByTestId('team')).toBeTruthy();
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('New squad');
    expect(readLaunchModePreference()).toBe('team');
  });

  it('keeps the session mode for the same project after reopening, and scopes it per project', () => {
    const first = render(<AgentLauncher onClose={() => {}} project={project('a')} />);
    fireEvent.click(screen.getByRole('button', { name: 'CLI Agent' }));
    first.unmount();
    // Another preference written elsewhere must not override this launcher's own choice.
    localStorage.clear();
    const again = render(<AgentLauncher onClose={() => {}} project={project('a')} />);
    expect(screen.getByTestId('legacy')).toBeTruthy();
    again.unmount();
    render(<AgentLauncher onClose={() => {}} project={project('b')} />);
    expect(screen.getByTestId('thread')).toBeTruthy();
  });

  it('retains the picked composer project across reopen and follows the pinned project', () => {
    const first = render(<AgentLauncher onClose={() => {}} />);
    expect(screen.getByTestId('thread').getAttribute('data-project')).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'pick-thread' }));
    expect(screen.getByTestId('thread').getAttribute('data-project')).toBe('picked');
    first.unmount();
    const again = render(<AgentLauncher onClose={() => {}} />);
    expect(screen.getByTestId('thread').getAttribute('data-project')).toBe('picked');
    again.unmount();
    render(<AgentLauncher onClose={() => {}} project={project('pinned')} />);
    expect(screen.getByTestId('thread').getAttribute('data-project')).toBe('pinned');
  });

  it('shows project-only history, and in scratch mode prepares the scratch workspace', async () => {
    const pinned = render(<AgentLauncher onClose={() => {}} project={project('a')} />);
    expect(screen.getByTestId('history')).toBeTruthy();
    expect(mocks.ensureQuickAgent).not.toHaveBeenCalled();
    pinned.unmount();
    mocks.data.loadProjects.mockClear();
    render(<AgentLauncher onClose={() => {}} />);
    expect(screen.queryByTestId('history')).toBeNull();
    await waitFor(() => expect(mocks.ensureQuickAgent).toHaveBeenCalled());
    // The freshly created scratch project is not in the store yet, so the list reloads.
    await waitFor(() => expect(mocks.data.loadProjects).toHaveBeenCalledTimes(2));
  });

  it('reports a scratch-workspace failure in the CLI Agent mode', async () => {
    mocks.ensureQuickAgent.mockResolvedValue({ ok: false, message: 'disk full' });
    render(<AgentLauncher onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'CLI Agent' }));
    expect((await screen.findByRole('alert')).textContent).toContain('disk full');
  });
});
