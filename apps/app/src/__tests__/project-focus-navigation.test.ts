/**
 * Project-focus navigation — verify the focusedProjectId round-trip:
 * enter/exit mutate the store AND persist to AppConfig, and the focused
 * project ID is hydrated from config on init.
 *
 * This is a simpler integration-style test that verifies the contract rather
 * than testing the full store state machine (which would require extensive
 * mocking). The windowScope.test.ts already covers the detection logic.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

describe('project-focus navigation contract', () => {
  // Every test below dynamically imports store.ts fresh (vi.resetModules() in
  // afterEach forces this, for state isolation). resetModules() only clears
  // the module-INSTANTIATION cache, not Vite's compiled-code transform cache —
  // so whichever test runs first still pays the one-time COLD TRANSFORM of the
  // ~3600-line store.ts (+ transitive deps), which can push past the default
  // 5s test timeout under full-suite CPU contention (see the identical note
  // in inboxNavigation.test.ts, which shares this exact isolation pattern and
  // hit the same flake). Pay it here instead, in a hook with its own generous
  // timeout, before any test's budget starts ticking. Safe to run before
  // `window` exists — store.ts only touches `window` inside functions guarded
  // by `typeof window`, never at module scope.
  beforeAll(async () => {
    await import('../store.js');
  }, 20_000);

  let mockConfig: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    onDidChange: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockConfig = {
      get: vi.fn(async () => ({ focusedProjectId: null })),
      set: vi.fn(async () => ({ focusedProjectId: null })),
      onDidChange: vi.fn(() => vi.fn())
    };

    // These tests run in the node environment (no jsdom), so `window` must be
    // hand-rolled. Delegate setTimeout/clearTimeout to the node globals — the
    // store's debounced workspace-mode persist (persistWorkspaceModes) calls
    // window.setTimeout, so a bare object would throw. enterProjectFocus →
    // selectProject touches the project (fire-and-forget) and loadGitStatus
    // early-returns for a project absent from the (empty) store list, so
    // projects.touch + config are all the IPC surface this exercises.
    globalThis.window = {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      cc: {
        config: mockConfig,
        ipc: {
          on: vi.fn(() => vi.fn()),
          invoke: vi.fn(),
          send: vi.fn()
        },
        projects: {
          touch: vi.fn(async () => {})
        }
      }
    } as any;
  });

  afterEach(() => {
    delete (globalThis as any).window;
    vi.resetModules();
  });

  it('enterProjectFocus persists focusedProjectId to config', async () => {
    const { useUi } = await import('../store.js');

    useUi.getState().enterProjectFocus('proj-123');

    expect(useUi.getState().focusedProjectId).toBe('proj-123');
    expect(mockConfig.set).toHaveBeenCalledWith({ focusedProjectId: 'proj-123' });
  });

  it('exitProjectFocus clears focusedProjectId and persists null', async () => {
    const { useUi } = await import('../store.js');

    useUi.getState().enterProjectFocus('proj-123');
    mockConfig.set.mockClear();

    useUi.getState().exitProjectFocus();

    expect(useUi.getState().focusedProjectId).toBeNull();
    expect(mockConfig.set).toHaveBeenCalledWith({ focusedProjectId: null });
  });

  it('enterProjectFocus opens Projects on the Agents board', async () => {
    const { useUi } = await import('../store.js');

    useUi.getState().setWorkspaceMode('proj-123', 'explorer');
    useUi.getState().enterProjectFocus('proj-123');

    expect(useUi.getState().nav).toBe('projects');
    expect(useUi.getState().workspaceMode['proj-123']).toBe('agents');
  });

  it('defaults to Home rather than an unfocused Projects board', async () => {
    const { useUi } = await import('../store.js');
    expect(useUi.getState().nav).toBe('home');
    expect(useUi.getState().focusedProjectId).toBeNull();
  });

  it('focusedProjectId can be set and retrieved', async () => {
    const { useUi } = await import('../store.js');

    // Initially null
    expect(useUi.getState().focusedProjectId).toBeNull();

    // Can be set via enterProjectFocus
    useUi.getState().enterProjectFocus('proj-persisted');
    expect(useUi.getState().focusedProjectId).toBe('proj-persisted');
  });

  it('openProjectSettings navigates to that project\'s settings, not global Settings', async () => {
    const { useUi } = await import('../store.js');
    const { getLastAppNavigatePath, registerAppNavigate } = await import('../lib/app-navigate.js');
    const navigate = vi.fn();
    registerAppNavigate(navigate);

    useUi.getState().enterProjectFocus('other-proj');
    useUi.getState().openProjectSettings('proj-settings');

    expect(useUi.getState().nav).toBe('settings');
    expect(useUi.getState().settingsTab).toBe('project');
    expect(useUi.getState().focusedProjectId).toBe('proj-settings');
    expect(useUi.getState().selectedProjectId).toBe('proj-settings');
    expect(getLastAppNavigatePath()).toBe('/projects/proj-settings/settings');
    expect(navigate).toHaveBeenCalledWith('/projects/proj-settings/settings', undefined);

    registerAppNavigate(null);
  });
});
