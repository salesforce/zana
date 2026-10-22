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
    toggleSettings: vi.fn(),
    exitProjectFocus: vi.fn(),
    selectedProjectId: 'p1' as string | undefined,
    selectedTabId: {} as Record<string, string>,
    setResumeOpen: vi.fn(),
    setFindOpen: vi.fn()
  },
  dataState: { projects: [], terminals: {} as Record<string, unknown[]> }
}));

vi.mock('../store', () => ({
  useUi: { getState: () => uiState },
  useData: { getState: () => dataState },
  usePersonas: { getState: () => ({ personas: [] }) },
  sortProjectsForDisplay: (p: unknown[]) => p
}));
const { getTerminalMock, getActiveTerminalIdMock } = vi.hoisted(() => ({
  getTerminalMock: vi.fn((_id?: string): { clear: () => void } | null => null),
  getActiveTerminalIdMock: vi.fn((): string | null => null)
}));
vi.mock('../lib/findRegistry', () => ({
  getTerminal: getTerminalMock,
  getActiveTerminalId: getActiveTerminalIdMock
}));
const { openThreadFindMock } = vi.hoisted(() => ({
  openThreadFindMock: vi.fn((_event: KeyboardEvent) => false)
}));
vi.mock('../lib/thread-find', () => ({ openThreadFind: openThreadFindMock }));
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

  it('⌘, toggles Settings through the store (which picks project or global)', () => {
    uiState.toggleSettings.mockClear();
    const { preventDefault } = kb.press(',', { meta: true });
    expect(uiState.toggleSettings).toHaveBeenCalledTimes(1);
    expect(uiState.setNav).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('⌘N opens New Chat', () => {
    const { preventDefault } = kb.press('n', { meta: true });
    expect(uiState.setNav).toHaveBeenCalledWith('home');
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('⌘R does not open the Claude resume picker', () => {
    uiState.setResumeOpen.mockClear();
    const { preventDefault } = kb.press('r', { meta: true });
    expect(uiState.setResumeOpen).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});

describe('shortcuts: ⌘K clears the active terminal', () => {
  let kb: KeyboardHarness;
  let uninstall: () => void;

  beforeEach(() => {
    kb = installKeyboardHarness();
    uninstall = installShortcuts();
    getTerminalMock.mockReset().mockReturnValue(null);
    getActiveTerminalIdMock.mockReset().mockReturnValue(null);
    uiState.selectedProjectId = undefined;
    uiState.selectedTabId = {};
  });

  afterEach(() => {
    uninstall();
    kb.teardown();
    uiState.selectedProjectId = 'p1';
  });

  it('clears the handle of the active terminal id, with no project/tab selected', () => {
    const clear = vi.fn();
    getActiveTerminalIdMock.mockReturnValue('s1');
    getTerminalMock.mockImplementation((id) => (id === 's1' ? { clear } : null));
    const { preventDefault } = kb.press('k', { meta: true });
    expect(clear).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('ignores selectedTabId and uses only the active terminal id', () => {
    const clear = vi.fn();
    uiState.selectedProjectId = 'p1';
    uiState.selectedTabId = { p1: 'other' };
    getActiveTerminalIdMock.mockReturnValue('s1');
    getTerminalMock.mockImplementation((id) => (id === 's1' ? { clear } : null));
    kb.press('k', { meta: true });
    expect(getTerminalMock).toHaveBeenCalledWith('s1');
    expect(getTerminalMock).not.toHaveBeenCalledWith('other');
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('is a no-op without preventDefault when no terminal is active', () => {
    const { preventDefault } = kb.press('k', { meta: true });
    expect(getTerminalMock).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('does not throw when the active id has no registered handle', () => {
    getActiveTerminalIdMock.mockReturnValue('stale');
    expect(() => kb.press('k', { meta: true })).not.toThrow();
    expect(getTerminalMock).toHaveBeenCalledWith('stale');
  });
});

describe('shortcuts: ⌘F picks thread search before terminal find', () => {
  let kb: KeyboardHarness;
  let uninstall: () => void;

  beforeEach(() => {
    kb = installKeyboardHarness();
    uninstall = installShortcuts();
    openThreadFindMock.mockReset().mockReturnValue(false);
    uiState.setFindOpen.mockClear();
    uiState.selectedProjectId = 'p1';
    uiState.selectedTabId = { p1: 't1' };
    dataState.terminals = { p1: [{ id: 't1' }] };
  });

  afterEach(() => {
    uninstall();
    kb.teardown();
    uiState.selectedTabId = {};
    dataState.terminals = {};
  });

  it('leaves terminal find alone when the thread view takes ⌘F', () => {
    openThreadFindMock.mockReturnValue(true);
    kb.press('f', { meta: true });
    expect(openThreadFindMock).toHaveBeenCalledTimes(1);
    expect(uiState.setFindOpen).not.toHaveBeenCalled();
  });

  it('still opens terminal find when no thread view takes it', () => {
    const { preventDefault } = kb.press('f', { meta: true });
    expect(openThreadFindMock).toHaveBeenCalledTimes(1);
    expect(uiState.setFindOpen).toHaveBeenCalledWith(true);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });
});
