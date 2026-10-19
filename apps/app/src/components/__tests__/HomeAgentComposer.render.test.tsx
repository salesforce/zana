// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Project } from '../../types.js';

const state = vi.hoisted(() => ({
  ui: { walkthroughHomeMode: null as null | 'thread' | 'agent' },
  data: {
    composerShowCliAgent: true,
    composerShowModern: true,
    composerShowAutonomousTeam: false,
    teamJobLaunchEnabled: false
  },
  teams: [] as unknown[]
}));

vi.mock('../../store.js', () => ({
  useUi: (selector: (s: typeof state.ui) => unknown) => selector(state.ui),
  useData: (selector: (s: typeof state.data) => unknown) => selector(state.data),
  useTeams: (selector: (s: { teams: unknown[] }) => unknown) => selector({ teams: state.teams })
}));

type ComposerStub = { composerProjectId?: string; onComposerProjectIdChange?: (id: string) => void };
function stub(name: string) {
  return (props: ComposerStub) => (
    <div data-testid={name} data-project={props.composerProjectId ?? ''}>
      <button type="button" onClick={() => props.onComposerProjectIdChange?.('picked')}>{`pick-${name}`}</button>
    </div>
  );
}
vi.mock('../ThreadCommandComposer.js', () => ({ ThreadCommandComposer: stub('thread') }));
vi.mock('../LegacyAgentHomeComposer.js', () => ({ LegacyAgentHomeComposer: stub('legacy') }));
vi.mock('../TeamComposer.js', () => ({ TeamComposer: stub('team') }));

import { HomeAgentComposer } from '../HomeAgentComposer.js';
import { resetComposerSessions } from '../composer/composer-session.js';
import { readLaunchModePreference } from '../../lib/launch-mode-preference.js';

const project = (id: string) => ({ id, name: id, path: `/p/${id}` }) as unknown as Project;

beforeEach(() => {
  localStorage.clear();
  resetComposerSessions();
  state.ui.walkthroughHomeMode = null;
  Object.assign(state.data, { composerShowCliAgent: true, composerShowModern: true, composerShowAutonomousTeam: false, teamJobLaunchEnabled: false });
  state.teams = [];
});
afterEach(cleanup);

describe('HomeAgentComposer rendering', () => {
  it('renders only the Modern composer, with no switcher, unless the legacy agent is allowed', () => {
    render(<HomeAgentComposer project={project('a')} />);
    expect(screen.getByTestId('thread').getAttribute('data-project')).toBe('a');
    expect(screen.queryByRole('group', { name: 'Launch mode' })).toBeNull();
  });

  it('switches launch mode, mounts the matching composer and persists the choice', () => {
    state.teams = [{ id: 't1' }];
    state.data.composerShowAutonomousTeam = true;
    localStorage.clear();
    render(<HomeAgentComposer allowLegacyAgent project={project('a')} />);
    expect(screen.getByRole('group', { name: 'Launch mode' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'CLI Agent' }));
    expect(screen.getByTestId('legacy')).toBeTruthy();
    expect(screen.queryByTestId('thread')).toBeNull();
    expect(readLaunchModePreference()).toBe('agent');

    fireEvent.click(screen.getByRole('button', { name: /Squad/ }));
    expect(screen.getByTestId('team')).toBeTruthy();
    expect(screen.queryByTestId('legacy')).toBeNull();
    expect(readLaunchModePreference()).toBe('team');

    fireEvent.click(screen.getByRole('button', { name: /Modern/ }));
    expect(screen.getByTestId('thread')).toBeTruthy();
  });

  it('remembers the launch mode per draft scope even if the global preference changes', () => {
    const first = render(<HomeAgentComposer allowLegacyAgent project={project('a')} />);
    fireEvent.click(screen.getByRole('button', { name: 'CLI Agent' }));
    first.unmount();
    localStorage.clear();
    const again = render(<HomeAgentComposer allowLegacyAgent project={project('a')} />);
    expect(screen.getByTestId('legacy')).toBeTruthy();
    again.unmount();
    render(<HomeAgentComposer allowLegacyAgent draftScope="new-thread" project={project('a')} />);
    expect(screen.getByTestId('thread')).toBeTruthy();
  });

  it('hides the switcher when only one launch mode is offered', () => {
    state.data.composerShowCliAgent = false;
    render(<HomeAgentComposer allowLegacyAgent project={project('a')} />);
    expect(screen.queryByRole('group', { name: 'Launch mode' })).toBeNull();
    expect(screen.getByTestId('thread')).toBeTruthy();
  });

  it('forces the walkthrough mode and shows the switcher while the walkthrough is active', () => {
    state.data.composerShowCliAgent = false;
    state.data.composerShowModern = false;
    state.ui.walkthroughHomeMode = 'agent';
    const { container } = render(<HomeAgentComposer allowLegacyAgent project={project('a')} />);
    expect(container.querySelector('.home-agent-composer.is-walkthrough-spotlight')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Launch mode' })).toBeTruthy();
    expect(screen.getByTestId('legacy')).toBeTruthy();
  });

  it('keeps the chosen project per draft scope and follows a changed project prop', () => {
    const view = render(<HomeAgentComposer />);
    expect(screen.getByTestId('thread').getAttribute('data-project')).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'pick-thread' }));
    expect(screen.getByTestId('thread').getAttribute('data-project')).toBe('picked');

    // Same scope: the choice survives a remount; another scope starts clean.
    view.unmount();
    const same = render(<HomeAgentComposer />);
    expect(screen.getByTestId('thread').getAttribute('data-project')).toBe('picked');
    same.unmount();
    const other = render(<HomeAgentComposer draftScope="new-thread" />);
    expect(screen.getByTestId('thread').getAttribute('data-project')).toBe('');
    other.rerender(<HomeAgentComposer draftScope="new-thread" project={project('b')} />);
    expect(screen.getByTestId('thread').getAttribute('data-project')).toBe('b');
  });

  it('shares the project choice with the legacy agent composer', () => {
    render(<HomeAgentComposer allowLegacyAgent project={project('a')} />);
    fireEvent.click(screen.getByRole('button', { name: 'CLI Agent' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick-legacy' }));
    expect(screen.getByTestId('legacy').getAttribute('data-project')).toBe('picked');
  });
});
