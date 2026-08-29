// Purpose: unit tests for the capture-phase keyboard handler (shortcuts.ts),
//   covering the ⌘. agent-modal-close chord. First test of this system; uses
//   the shared keyboard-harness so future chord tests are a few lines each.
// External calls: None (store + util imports are mocked).
// Updated: 2026-07-03 15:20Z

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installKeyboardHarness, type KeyboardHarness } from './helpers/keyboard-harness.js';

// shortcuts.ts reads state via useUi/useData `.getState()` and imports two
// util helpers at module load. Mock all of it so the handler loads in the node
// env and each test drives a hand-built UI state. `vi.hoisted` so the spies
// exist before the hoisted `vi.mock` factories run.
const { uiState, dataState } = vi.hoisted(() => ({
  uiState: {
    nav: 'home' as string,
    agentModal: null as unknown,
    threadModal: null as unknown,
    closeAgentModal: vi.fn(),
    closeThreadModal: vi.fn(),
    setNav: vi.fn(),
    exitProjectFocus: vi.fn()
  },
  dataState: { projects: [], terminals: {} as Record<string, unknown[]> }
}));

vi.mock('../store', () => ({
  useUi: { getState: () => uiState },
  useData: { getState: () => dataState },
  usePersonas: { getState: () => ({ personas: [] }) },
  sortProjectsForDisplay: (p: unknown[]) => p
}));
vi.mock('../lib/findRegistry', () => ({ getTerminal: () => undefined }));
vi.mock('../lib/launchProfile', () => ({
  projectDefaultLaunch: () => ({ profile: 'claude' })
}));

import { installShortcuts } from '../shortcuts.js';

describe('shortcuts: ⌘. closes the agent detail modal', () => {
  let kb: KeyboardHarness;
  let uninstall: () => void;

  beforeEach(() => {
    kb = installKeyboardHarness();
    uninstall = installShortcuts();
    uiState.nav = 'home';
    uiState.agentModal = null;
    uiState.threadModal = null;
    uiState.closeAgentModal.mockClear();
    uiState.closeThreadModal.mockClear();
    uiState.setNav.mockClear();
    uiState.exitProjectFocus.mockClear();
  });

  afterEach(() => {
    uninstall();
    kb.teardown();
  });

  it('closes the modal when one is open', () => {
    uiState.agentModal = { sessionId: 's1', projectId: 'p1' };
    const { preventDefault } = kb.press('.', { meta: true });
    expect(uiState.closeAgentModal).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('closes the thread inspector when that overlay is open', () => {
    uiState.threadModal = { threadId: 't1' };
    const { preventDefault } = kb.press('.', { meta: true });
    expect(uiState.closeThreadModal).toHaveBeenCalledTimes(1);
    expect(uiState.closeAgentModal).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('prefers the agent inspector when both overlays are set', () => {
    uiState.agentModal = { sessionId: 's1', projectId: 'p1' };
    uiState.threadModal = { threadId: 't1' };
    kb.press('.', { meta: true });
    expect(uiState.closeAgentModal).toHaveBeenCalledTimes(1);
    expect(uiState.closeThreadModal).not.toHaveBeenCalled();
  });

  it('is a no-op when no modal is open (does not swallow the keystroke)', () => {
    const { preventDefault } = kb.press('.', { meta: true });
    expect(uiState.closeAgentModal).not.toHaveBeenCalled();
    expect(uiState.closeThreadModal).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('ignores a bare "." with no mod key', () => {
    uiState.agentModal = { sessionId: 's1', projectId: 'p1' };
    kb.press('.');
    expect(uiState.closeAgentModal).not.toHaveBeenCalled();
  });
});

describe('shortcuts: round-trip and dashboard chords', () => {
  let kb: KeyboardHarness;
  let uninstall: () => void;

  beforeEach(() => {
    kb = installKeyboardHarness();
    uninstall = installShortcuts();
    uiState.nav = 'home';
    uiState.agentModal = null;
    uiState.threadModal = null;
    uiState.setNav.mockClear();
    uiState.exitProjectFocus.mockClear();
  });

  afterEach(() => {
    uninstall();
    kb.teardown();
  });

  it('⌘O opens the Agents dashboard and exits project focus', () => {
    kb.press('o', { meta: true });
    expect(uiState.setNav).toHaveBeenCalledWith('agents');
    expect(uiState.exitProjectFocus).toHaveBeenCalled();
  });

  it('⌘I round-trips Inbox back to Home', () => {
    uiState.nav = 'inbox';
    kb.press('i', { meta: true });
    expect(uiState.setNav).toHaveBeenCalledWith('home');
  });

  it('⌘J round-trips Scheduler back to Home', () => {
    uiState.nav = 'scheduler';
    kb.press('j', { meta: true });
    expect(uiState.setNav).toHaveBeenCalledWith('home');
  });
});
