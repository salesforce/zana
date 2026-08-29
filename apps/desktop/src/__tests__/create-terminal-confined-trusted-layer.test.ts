import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Project, AppConfig, ProjectSettings, Persona } from '@zana-ai/zcc-domain/product';

/**
 * A6 trusted-layer integrity. The denylist applies ONLY to the UNTRUSTED
 * `req.extraArgs`. pty.ts legitimately synthesizes --permission-mode /
 * --allowedTools / --append-system-prompt from TRUSTED store data (persona /
 * project settings / globals) — those layers must NOT be sanitized. This test
 * runs `createTerminalConfined` against the REAL pty assembly (node-pty mocked
 * to record argv) with a persona that sets `permissionMode` AND a denied flag in
 * `req.extraArgs`, and asserts the persona's --permission-mode is present in the
 * FINAL argv while the denied extraArgs flag is gone.
 */

interface FakeProc {
  pid: number;
  args: string[];
  write: () => void;
  onData: () => void;
  onExit: () => void;
  resize: () => void;
  kill: () => void;
}

const spawned: FakeProc[] = [];

vi.mock('node-pty', () => ({
  spawn: (_command: string, args: string[]) => {
    const proc: FakeProc = {
      pid: 3000 + spawned.length,
      args,
      write() {},
      onData() {},
      onExit() {},
      resize() {},
      kill() {}
    };
    spawned.push(proc);
    return proc;
  }
}));

const PROJECT: Project = { id: 'p1', name: 'Proj', path: '/tmp' } as Project;

const CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

const PERSONA: Persona = {
  id: 'persona1',
  name: 'Test Persona',
  permissionMode: 'acceptEdits'
} as Persona;

vi.mock('../store.js', () => ({
  store: {
    listProjects: () => [PROJECT],
    getConfig: () => CONFIG,
    getProjectSettings: () => ({}) as ProjectSettings,
    createScratchSubfolder: () => '/tmp/scratch'
  },
  scratchWorkspaceRoot: () => '/tmp/scratch-root',
  worktreeRoot: () => '/tmp/zcc-worktrees',
  worktreeTargetDir: (_p: unknown, slug: string) => `/tmp/zcc-worktrees/${slug}`
}));

// Seed one persona via PersonaStore.list(); keep the REAL resolvePersonaLaunch so
// the persona→pty wiring is exercised end to end.
vi.mock('../persona-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zana-ai/zcc-server/services/agents/persona-store')>();
  return {
    ...actual,
    PersonaStore: class {
      list() {
        return [PERSONA];
      }
    }
  };
});

vi.mock('../updater.js', () => ({ createUpdater: () => ({}) }));

vi.mock('-ai/zcc-host-daemon/mcp-config', () => ({
  ensureMcpConfigForProject: () => '/tmp/p1/.mcp.json',
  ensureMcpConfigForProjectSync: () => '/tmp/p1/.mcp.json'
}));

vi.mock('electron', () => ({
  // index.ts constructs the harness credential store at module scope, which
  // reads `safeStorage`; isEncryptionAvailable:false routes it to its plaintext
  // fallback so no encrypt/decrypt stub is needed.
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

const { createTerminalConfined, frameworkPersonaFromEntries } = await import('../host.js');

describe('frameworkPersonaFromEntries — manifest preset → synthetic persona', () => {
  const entries = [
    {
      id: 'acme',
      path: '/ext/acme',
      enabled: true,
      loaded: true,
      mainActive: true,
      consented: true,
      needsConsent: null,
      manifest: {
        id: 'acme',
        title: 'Acme',
        icon: 'Box',
        entry: { renderer: 'r.js' },
        engines: { zccApi: '^1.0.0' },
        agentPreset: {
          label: 'Acme FW',
          icon: 'Blocks',
          systemPrompt: 'You are in Acme.',
          initialPrompt: '/acme:status',
          model: 'opus' as const,
          baseProfile: 'claude-yolo' as const
        }
      }
    },
    {
      id: 'beta',
      path: '/ext/beta',
      enabled: true,
      loaded: true,
      mainActive: true,
      consented: true,
      needsConsent: null,
      manifest: {
        id: 'beta',
        title: 'Beta',
        icon: 'Box',
        entry: { renderer: 'r.js' },
        engines: { zccApi: '^1.0.0' },
        agentPreset: {
          label: 'Beta FW',
          icon: 'Wrench',
          systemPrompt: 'You follow Beta rules.',
          initialPrompt: '/beta:go'
        }
      }
    }
  ] as Parameters<typeof frameworkPersonaFromEntries>[0];

  it('builds a host-stamped persona whose primer is the preset systemPrompt', () => {
    const p = frameworkPersonaFromEntries(entries, 'acme', true);
    expect(p?.id).toBe('framework:acme');
    expect(p?.appendSystemPrompt).toBe('You are in Acme.');
    expect(p?.baseProfile).toBe('claude-yolo');
    expect(p?.model).toBe('opus');
    expect(p?.initialPrompt).toBe('/acme:status');
    // Provenance is stamped from the authenticated entry id, not self-declared.
    expect(p?.source).toEqual({ extensionId: 'acme', extensionTitle: 'Acme' });
  });

  it('drops the preset initialPrompt when the user supplied their own task', () => {
    const p = frameworkPersonaFromEntries(entries, 'acme', false);
    expect(p?.appendSystemPrompt).toBe('You are in Acme.'); // primer still injected
    expect(p?.initialPrompt).toBeUndefined(); // kickoff suppressed
  });

  it('returns undefined for an unknown framework id (bare launch fallback)', () => {
    expect(frameworkPersonaFromEntries(entries, 'nope', true)).toBeUndefined();
    expect(frameworkPersonaFromEntries([], 'acme', true)).toBeUndefined();
  });

  it('single-element array is byte-identical to the single-string shape', () => {
    const one = frameworkPersonaFromEntries(entries, 'acme', true);
    const arr = frameworkPersonaFromEntries(entries, ['acme'], true);
    expect(arr).toEqual(one);
  });

  it('merges multiple presets into ONE synthetic persona (primers joined in order)', () => {
    const p = frameworkPersonaFromEntries(entries, ['acme', 'beta'], true);
    expect(p?.id).toBe('framework:acme+beta');
    expect(p?.name).toBe('Acme FW + Beta FW');
    // Both primers present, in selection order, under labelled separators.
    expect(p?.appendSystemPrompt).toContain('## Framework: Acme FW');
    expect(p?.appendSystemPrompt).toContain('You are in Acme.');
    expect(p?.appendSystemPrompt).toContain('## Framework: Beta FW');
    expect(p?.appendSystemPrompt).toContain('You follow Beta rules.');
    expect(p!.appendSystemPrompt!.indexOf('Acme')).toBeLessThan(
      p!.appendSystemPrompt!.indexOf('Beta')
    );
    // Single base command + single model: first present value wins.
    expect(p?.baseProfile).toBe('claude-yolo'); // from acme (beta declares none)
    expect(p?.model).toBe('opus');
    // First framework that declares a kickoff prompt supplies it.
    expect(p?.initialPrompt).toBe('/acme:status');
    // Provenance stamps the first extension.
    expect(p?.source).toEqual({ extensionId: 'acme', extensionTitle: 'Acme' });
  });

  it('drops the merged kickoff prompt when the user supplied their own task', () => {
    const p = frameworkPersonaFromEntries(entries, ['acme', 'beta'], false);
    expect(p?.appendSystemPrompt).toContain('You are in Acme.');
    expect(p?.initialPrompt).toBeUndefined();
  });

  it('silently drops unknown ids from the merge, keeping the resolvable ones', () => {
    const p = frameworkPersonaFromEntries(entries, ['nope', 'beta'], true);
    expect(p?.id).toBe('framework:beta');
    expect(p?.name).toBe('Beta FW');
    expect(p?.appendSystemPrompt).toBe('You follow Beta rules.');
  });
});

describe('createTerminalConfined — trusted persona layer is NOT sanitized', () => {
  beforeEach(() => {
    spawned.length = 0;
  });

  it('keeps the persona --permission-mode while stripping a denied extraArgs flag', () => {
    const res = createTerminalConfined({
      projectId: 'p1',
      profile: 'claude',
      personaId: 'persona1',
      cols: 80,
      rows: 24,
      extraArgs: ['--dangerously-skip-permissions', '--model', 'opus']
    });
    expect(res.ok).toBe(true);
    const argv = spawned[0].args;
    // Trusted layer: persona's permission-mode synthesized by pty.ts survives.
    expect(argv).toContain('--permission-mode');
    expect(argv[argv.indexOf('--permission-mode') + 1]).toBe('acceptEdits');
    // Benign caller flag survives (value may be resolved from a bare alias).
    expect(argv).toContain('--model');
    expect(argv[argv.indexOf('--model') + 1]).toBeTruthy();
    // Denied caller flag stripped before reaching the argv.
    expect(argv).not.toContain('--dangerously-skip-permissions');
  });

  it('applies a canonical project-default persona layer', () => {
    const original = PROJECT.launchDefault;
    PROJECT.launchDefault = {
      schemaVersion: 1,
      kind: 'persona-pin',
      personaId: 'persona1',
      adapterId: 'claude',
      profileId: 'claude',
      source: 'test'
    };
    try {
      const res = createTerminalConfined({
        projectId: 'p1',
        profile: 'claude',
        profileSource: 'seeded-default',
        cols: 80,
        rows: 24
      });
      expect(res.ok).toBe(true);
      const argv = spawned[0].args;
      expect(argv).toContain('--permission-mode');
      expect(argv[argv.indexOf('--permission-mode') + 1]).toBe('acceptEdits');
    } finally {
      PROJECT.launchDefault = original;
    }
  });
});
