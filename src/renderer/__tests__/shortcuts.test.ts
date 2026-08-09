// Purpose: unit tests for the capture-phase keyboard handler (shortcuts.ts),
//   covering the ⌘. agent-modal-close chord. First test of this system; uses
//   the shared keyboard-harness so future chord tests are a few lines each.
// External calls: None (store + util imports are mocked).
// Updated: 2026-07-03 15:20Z

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installKeyboardHarness, type KeyboardHarness } from './helpers/keyboard-harness';

// shortcuts.ts reads state via useUi/useData `.getState()` and imports two
// util helpers at module load. Mock all of it so the handler loads in the node
// env and each test drives a hand-built UI state. `vi.hoisted` so the spies
// exist before the hoisted `vi.mock` factories run.
const { uiState, dataState } = vi.hoisted(() => ({
  uiState: { agentModal: null as unknown, closeAgentModal: vi.fn() },
  dataState: { projects: [], terminals: {} as Record<string, unknown[]> }
}));

vi.mock('../store', () => ({
  useUi: { getState: () => uiState },
  useData: { getState: () => dataState },
  usePersonas: { getState: () => ({ personas: [] }) },
  sortProjectsForDisplay: (p: unknown[]) => p
}));
vi.mock('../util/findRegistry', () => ({ getTerminal: () => undefined }));
vi.mock('../util/launchProfile', () => ({
  projectDefaultLaunch: () => ({ profile: 'claude' })
}));

import { installShortcuts } from '../shortcuts';

describe('shortcuts: ⌘. closes the agent detail modal', () => {
  let kb: KeyboardHarness;
  let uninstall: () => void;

  beforeEach(() => {
    kb = installKeyboardHarness();
    uninstall = installShortcuts();
    uiState.agentModal = null;
    uiState.closeAgentModal.mockClear();
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

  it('is a no-op when no modal is open (does not swallow the keystroke)', () => {
    const { preventDefault } = kb.press('.', { meta: true });
    expect(uiState.closeAgentModal).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('ignores a bare "." with no mod key', () => {
    uiState.agentModal = { sessionId: 's1', projectId: 'p1' };
    kb.press('.');
    expect(uiState.closeAgentModal).not.toHaveBeenCalled();
  });
});
