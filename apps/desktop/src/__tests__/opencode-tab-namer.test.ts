import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Project, AppConfig, ProjectSettings } from '@zana-ai/zcc-domain/product';

/**
 * OpenCode has no hook surface to deliver the `builtin:tab-namer` first-prompt
 * callback (see CLAUDE.md's harness-provider notes), so `createTerminalConfined`
 * fires the SAME `fireTabNamer` helper directly from the spawn-time prompt text
 * for OpenCode profiles. This covers: the OpenCode spawn-time trigger fires the
 * micro-call with the right entry/text, a bare (promptless) OpenCode launch does
 * NOT fire, a Claude spawn does not take this spawn-time path (it still relies
 * solely on the HTTP hook route), and the one-shot guard blocks a double-fire
 * for the same session id.
 *
 * Mirrors the mocking approach in create-terminal-confined.test.ts: `pty.js` is
 * mocked to capture `create()` calls and back `getSession()`, `store.js` seeds
 * one project + config, `@zana-ai/zcc-llm` is mocked so
 * the test never spawns a real `claude --print` process, and `electron` is
 * mocked so importing index.ts is side-effect-free.
 */

const PROJECT: Project = {
  id: 'p1',
  name: 'Proj',
  path: '/tmp/proj'
} as Project;

const CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

const PROJECT_SETTINGS: ProjectSettings = {} as ProjectSettings;

const createCalls: Array<{ id: string; extraArgs?: string[]; profile: string }> = [];
const liveSessions = new Map<string, { id: string; profile: string; status: string }>();
let sessionCounter = 0;

vi.mock('../pty.js', () => {
  class PtyManager {
    setMcpBaseUrl() {}
    setProjectRoots() {}
    setRulesResolver() {}
    create(opts: { extraArgs?: string[]; profile: string; preallocatedSessionId?: string }) {
      const id = opts.preallocatedSessionId ?? `s${++sessionCounter}`;
      const session = { id, profile: opts.profile, status: 'running' };
      liveSessions.set(id, session);
      createCalls.push({ id, extraArgs: opts.extraArgs, profile: opts.profile });
      return session;
    }
    getSession(id: string) {
      return liveSessions.get(id) ?? null;
    }
  }
  return {
    PtyManager,
    isClaudeProfile: (p: string) => p === 'claude'
  };
});

vi.mock('../store.js', () => ({
  store: {
    listProjects: () => [PROJECT],
    getConfig: () => CONFIG,
    getProjectSettings: () => PROJECT_SETTINGS,
    createScratchSubfolder: () => '/tmp/proj/scratch'
  },
  scratchWorkspaceRoot: () => '/tmp/scratch-root',
  worktreeRoot: () => '/tmp/zcc-worktrees',
  worktreeTargetDir: (_p: unknown, slug: string) => `/tmp/zcc-worktrees/${slug}`
}));

const llmRunCalls: Array<{ entryId: string; prompt: string; dedupeKey?: string }> = [];

vi.mock('@zana-ai/zcc-llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zana-ai/zcc-llm')>();
  class LlmService {
    setProvider() {}
    run(entry: { id: string }, vars: { prompt: string }, dedupeKey?: string) {
      llmRunCalls.push({ entryId: entry.id, prompt: vars.prompt, dedupeKey });
      return Promise.resolve({ ok: true, text: 'Mock Title', provider: 'claude-cli' });
    }
  }
  class PromptRegistry {
    start() {}
    on() {}
    list() {
      return [];
    }
    get(id: string) {
      return id === 'builtin:tab-namer'
        ? { id, label: 'Tab namer', provider: 'claude-cli', model: 'haiku', systemPrompt: 's', userTemplate: 't' }
        : null;
    }
  }
  return { ...actual, LlmService, PromptRegistry };
});

vi.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false },
  app: {
    on: () => {},
    whenReady: () => new Promise(() => {}),
    getPath: () => '/tmp',
    setName: () => {},
    requestSingleInstanceLock: () => true,
    quit: () => {}
  },
  BrowserWindow: class {
    static getAllWindows() {
      return [];
    }
    static getFocusedWindow() {
      return null;
    }
  },
  ipcMain: { handle: () => {}, on: () => {} },
  dialog: {},
  shell: {},
  screen: {},
  Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) },
  nativeImage: { createFromPath: () => ({}) },
  powerMonitor: { on: () => {} }
}));

vi.mock('../updater.js', () => ({
  createUpdater: () => ({})
}));

vi.mock('-ai/zcc-host-daemon/mcp-config', () => ({
  ensureMcpConfigForProject: () => '/tmp/p1/.mcp.json',
  ensureMcpConfigForProjectSync: () => '/tmp/p1/.mcp.json'
}));

// safeSend() calls testTap.record(channel, args) unconditionally (before the
// windows loop), so this is the cheapest tap on the onTitle IPC send without
// needing a real BrowserWindow.
const tapRecordCalls: Array<{ channel: string; args: unknown[] }> = [];
vi.mock('../test-tap.js', () => ({
  record: (channel: string, args: unknown[]) => tapRecordCalls.push({ channel, args }),
  recordLog: () => {},
  isEnabled: () => false,
  enable: () => {},
  drain: () => ({ entries: [], cursor: 0 }),
  snapshot: () => ({ entries: [] }),
  reset: () => {}
}));

const { createTerminalConfined } = await import('../host.js');

describe('OpenCode spawn-time tab-namer trigger', () => {
  beforeEach(() => {
    createCalls.length = 0;
    llmRunCalls.length = 0;
    liveSessions.clear();
    tapRecordCalls.length = 0;
  });

  it('fires fireTabNamer with builtin:tab-namer and the prompt text, then delivers the title over the onTitle channel', async () => {
    const res = createTerminalConfined({
      projectId: 'p1',
      profile: 'opencode',
      cols: 80,
      rows: 24,
      prompt: 'list all files in src'
    });
    expect(res.ok).toBe(true);
    expect(llmRunCalls).toHaveLength(1);
    expect(llmRunCalls[0].entryId).toBe('builtin:tab-namer');
    expect(llmRunCalls[0].prompt).toBe('list all files in src');
    // fireTabNamer's completion runs in a microtask after llmService.run()
    // resolves — flush it, then assert the SAME onTitle channel the OSC path
    // uses actually received the 'llm'-sourced title (not just that the LLM
    // call was initiated).
    await vi.waitFor(() => {
      expect(tapRecordCalls.some((c) => c.channel === 'terminals:onTitle')).toBe(true);
    });
    const titleCall = tapRecordCalls.find((c) => c.channel === 'terminals:onTitle');
    expect(titleCall?.args).toEqual([res.ok ? res.value.id : undefined, 'Mock Title', 'llm']);
  });

  it('does not fire for a bare OpenCode launch with no prompt body', () => {
    const res = createTerminalConfined({
      projectId: 'p1',
      profile: 'opencode',
      cols: 80,
      rows: 24
    });
    expect(res.ok).toBe(true);
    expect(llmRunCalls).toHaveLength(0);
  });

  it('does not take the spawn-time trigger for a Claude profile (still hook-route only)', () => {
    const res = createTerminalConfined({
      projectId: 'p1',
      profile: 'claude',
      cols: 80,
      rows: 24,
      prompt: 'do work'
    });
    expect(res.ok).toBe(true);
    expect(llmRunCalls).toHaveLength(0);
  });

  it('fires when a seeded default resolves from Claude to OpenCode', () => {
    const prior = CONFIG.defaultHarness;
    const priorEnabled = CONFIG.harnessOpenCodeEnabled;
    CONFIG.defaultHarness = 'opencode';
    CONFIG.harnessOpenCodeEnabled = true;
    try {
      const res = createTerminalConfined({
        projectId: 'p1',
        profile: 'claude',
        profileSource: 'seeded-default',
        cols: 80,
        rows: 24,
        prompt: 'use the configured harness'
      });
      expect(res.ok).toBe(true);
      expect(createCalls[0]?.profile).toBe('opencode');
      expect(llmRunCalls).toHaveLength(1);
      expect(llmRunCalls[0]?.prompt).toBe('use the configured harness');
    } finally {
      CONFIG.defaultHarness = prior;
      CONFIG.harnessOpenCodeEnabled = priorEnabled;
    }
  });

  it('does not fire on an OpenCode resume relaunch that also carries a prompt', () => {
    const res = createTerminalConfined({
      projectId: 'p1',
      profile: 'opencode',
      cols: 80,
      rows: 24,
      prompt: 'continue with a new instruction',
      resumeSessionId: 'prior-session-id'
    } as Parameters<typeof createTerminalConfined>[0]);
    expect(res.ok).toBe(true);
    expect(llmRunCalls).toHaveLength(0);
  });

  it('one-shot guard: a second spawn reusing the same session id does not fire twice', () => {
    createTerminalConfined(
      { projectId: 'p1', profile: 'opencode', cols: 80, rows: 24, prompt: 'first' },
      { preallocatedSessionId: 'sess-guard' }
    );
    createTerminalConfined(
      { projectId: 'p1', profile: 'opencode', cols: 80, rows: 24, prompt: 'second' },
      { preallocatedSessionId: 'sess-guard' }
    );
    expect(llmRunCalls).toHaveLength(1);
    expect(llmRunCalls[0].prompt).toBe('first');
  });
});
