import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * GOLDEN-ARGV REGRESSION NET for the harness-seam extraction.
 *
 * This suite captures the EXACT command, argv, session-scoped env, and the
 * remote command string that the launch layer emits today, across the matrix
 * of {profile} × {persona/projectSettings} × {interactive/scheduled}. The
 * snapshots are recorded against the PRE-refactor `pty.ts`; the LaunchProvider
 * extraction must keep every one of them byte-identical (§Phase 3 of
 * `.zcc/library/designs/harness-and-llm-extraction-master-plan.md`).
 *
 * Minted UUIDs (the per-tab `--session-id` and the identity baked into the
 * ZCC_*_URL env) are normalized to `<UUID>` so the snapshot is stable across
 * runs while still asserting the URL SHAPE and every flag around them.
 */

interface SpawnCall {
  command: string;
  args: string[];
  env: Record<string, string>;
}

const spawns: SpawnCall[] = [];

vi.mock('node-pty', () => ({
  spawn: (command: string, args: string[], opts: { env?: Record<string, string> }) => {
    spawns.push({ command, args, env: opts?.env ?? {} });
    return {
      pid: 4000 + spawns.length,
      write() {},
      onData() {},
      onExit() {},
      resize() {},
      kill() {}
    };
  }
}));

// Deterministic MCP config path so the snapshot doesn't depend on ~/.zcc.
vi.mock('../mcp-config.js', () => ({
  ensureMcpConfigForProjectSync: (id: string, extra?: string[]) =>
    `/tmp/${id}/.mcp.json${extra?.length ? `?extra=${extra.join(',')}` : ''}`
}));

// tmux never wraps in tests (keep the bare argv), regardless of the host.
vi.mock('../tmux.js', () => ({
  isTmuxAvailable: () => false,
  buildLocalTmuxCommand: (_id: string, command: string, args: string[]) => ({ command, args }),
  wrapRemoteTmux: (_id: string, quoted: string) => quoted
}));

// Model-alias resolution reads the developer's real ~/.claude/settings.json
// `model` field (see model-resolve.ts), which would make these golden argv
// snapshots machine-dependent (`--model opus` → whatever concrete id that
// machine pins). This suite asserts the argv SHAPE — that a bare family alias
// is emitted unchanged — so we pin the resolver to identity here; its own
// substitution behaviour is covered by model-resolve.test.ts.
vi.mock('../model-resolve.js', () => ({
  resolveModelAlias: (model: string) => model
}));

import { PtyManager, applyHeapCeiling } from '../pty.js';
import type {
  AppConfig,
  Persona,
  ProjectSettings,
  ProjectRemote,
  LaunchProfileId
} from '../../shared/types.js';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const SESSION_CREDENTIAL_RE = /\b[0-9a-f]{64}\b/gi;
const MCP_BASE = 'http://127.0.0.1:39999';
// The remote reverse-tunnel loopback port is derived from the (random) session
// id (`remotePortForSession`), so it varies per run. Mask it in both places it
// appears — the `ssh -R <port>:127.0.0.1:<mcp>` forward and the `ZCC_*_URL`
// hook endpoints — so the golden snapshots stay stable. The fixed local MCP
// port (39999) is left intact so a drift there still trips the snapshot.
const REVERSE_FORWARD_RE = /\b\d{4,5}(:127\.0\.0\.1:39999)/g;
const HOOK_PORT_RE = /(127\.0\.0\.1:)\d{4,5}(\/hook)/g;

/** Replace every UUID + the derived remote port with stable tokens so snapshots don't churn per run. */
function normalize<T>(value: T): T {
  const masked = JSON.stringify(value)
    .replace(UUID_RE, '<UUID>')
    .replace(SESSION_CREDENTIAL_RE, '<SESSION_CREDENTIAL>')
    .replace(REVERSE_FORWARD_RE, '<PORT>$1')
    .replace(HOOK_PORT_RE, '$1<PORT>$2');
  return JSON.parse(masked);
}

/** Only the session-scoped ZCC_* env keys the launcher sets (identity-bearing). */
const SESSION_ENV_KEYS = [
  'ZCC_MCP_URL',
  'ZCC_HOOK_URL',
  'ZCC_NOTIFY_URL',
  'ZCC_FIRSTPROMPT_URL',
  'ZCC_SUBAGENT_URL',
  'ZCC_OVERSEER_URL',
  'ZCC_CONTENTSCREEN_URL',
  'ZCC_SESSION_ID',
  'CLAUDE_CODE_ENABLE_AUTO_MODE'
  // NODE_OPTIONS deliberately excluded: it inherits the parent (vitest's own
  // --max-old-space-size), so it's machine-dependent. Covered separately via
  // the pure applyHeapCeiling assertions above.
] as const;

function pickSessionEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of SESSION_ENV_KEYS) {
    if (env[k] !== undefined) out[k] = env[k];
  }
  return out;
}

// HERMETIC ENV: the launcher spreads `...process.env` into every spawn, so any
// ambient ZCC_* session var (present when this suite runs INSIDE a live Zana
// session) leaks into the snapshot. A profile that sets its OWN value (claude's
// fixed-port ZCC_MCP_URL) masks the leak, but a profile that does NOT set one
// (shell has no mcpConfigPath → no ZCC_MCP_URL) inherits the parent session's
// URL verbatim — a random ephemeral port that churns the snapshot every run.
// Strip these once at load so the snapshots assert exactly what the launcher
// sets, independent of who ran it. (SESSION_ENV_KEYS excludes NODE_OPTIONS by
// design — it's asserted separately via the pure applyHeapCeiling tests.)
for (const k of SESSION_ENV_KEYS) {
  delete (process.env as Record<string, string | undefined>)[k];
}

const BASE_CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

const PERSONA: Persona = {
  id: 'persona-1',
  name: 'Reviewer',
  appendSystemPrompt: 'You are a careful reviewer.',
  addDirs: ['/extra/context'],
  allowedTools: ['Read', 'Grep'],
  deniedTools: ['Bash'],
  model: 'opus',
  permissionMode: 'acceptEdits'
};

const PROJECT_SETTINGS: ProjectSettings = {
  appendSystemPrompt: 'Project house rules.',
  addDirs: ['/project/docs'],
  allowedTools: ['Write'],
  deniedTools: ['WebFetch'],
  model: 'sonnet',
  permissionMode: 'plan',
  extraArgs: ['--verbose']
};

const PROFILES: LaunchProfileId[] = ['claude', 'claude-resume', 'claude-yolo', 'shell'];
type LayerName = 'plain' | 'persona' | 'projectSettings' | 'persona+projectSettings';
const LAYERS: LayerName[] = ['plain', 'persona', 'projectSettings', 'persona+projectSettings'];

function layerOpts(layer: LayerName): { persona?: Persona; projectSettings?: ProjectSettings } {
  switch (layer) {
    case 'plain':
      return {};
    case 'persona':
      return { persona: PERSONA };
    case 'projectSettings':
      return { projectSettings: PROJECT_SETTINGS };
    case 'persona+projectSettings':
      return { persona: PERSONA, projectSettings: PROJECT_SETTINGS };
  }
}

describe('golden argv — local create() matrix', () => {
  beforeEach(() => {
    spawns.length = 0;
  });

  for (const profile of PROFILES) {
    for (const layer of LAYERS) {
      for (const scheduled of [false, true]) {
        const label = `${profile} · ${layer} · ${scheduled ? 'scheduled' : 'interactive'}`;
        it(label, () => {
          const mgr = new PtyManager();
          mgr.setMcpBaseUrl(MCP_BASE);
          mgr.create({
            projectId: 'proj1',
            profile,
            cwd: '/tmp/work',
            cols: 80,
            rows: 24,
            config: BASE_CONFIG,
            scheduled,
            ...layerOpts(layer)
          });
          expect(spawns.length).toBe(1);
          const call = spawns[0];
          expect(
            normalize({
              command: call.command,
              args: call.args,
              sessionEnv: pickSessionEnv(call.env)
            })
          ).toMatchSnapshot();
        });
      }
    }
  }
});

describe('preallocated launch identity', () => {
  it('uses one coordinator-owned session id in record, env, hooks, and tmux identity', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl(MCP_BASE);
    const session = mgr.create({
      projectId: 'proj1', profile: 'claude', cwd: '/tmp/work', cols: 80, rows: 24,
      config: BASE_CONFIG, preallocatedSessionId: '11111111-1111-4111-8111-111111111111'
    });
    const call = spawns[spawns.length - 1];
    expect(session.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(call.env.ZCC_SESSION_ID).toBe(session.id);
    expect(call.env.ZCC_MCP_URL).toContain(session.id);
    expect(call.env.ZCC_NOTIFY_URL).toContain(session.id);
  });
});

describe('restored harness identity', () => {
  it('retains an OpenCode resume id on the replacement PTY session', () => {
    const mgr = new PtyManager();
    const session = mgr.create({
      projectId: 'proj1',
      profile: 'opencode-resume',
      cwd: '/tmp/work',
      cols: 80,
      rows: 24,
      config: BASE_CONFIG,
      resumeSessionId: 'ses_abc123'
    });

    expect(session.openCodeSessionId).toBe('ses_abc123');
  });
});

describe('golden argv — auto-mode + overseer variants', () => {
  beforeEach(() => {
    spawns.length = 0;
  });

  it('auto-mode default ON for interactive claude (no explicit permission mode)', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl(MCP_BASE);
    mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp/work',
      cols: 80,
      rows: 24,
      config: BASE_CONFIG
    });
    const call = spawns[0];
    expect(
      normalize({ command: call.command, args: call.args, sessionEnv: pickSessionEnv(call.env) })
    ).toMatchSnapshot();
  });

  it('auto-mode disabled by config.autoModeEnabled=false', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl(MCP_BASE);
    mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp/work',
      cols: 80,
      rows: 24,
      config: { ...BASE_CONFIG, autoModeEnabled: false }
    });
    const call = spawns[0];
    expect(normalize({ args: call.args, sessionEnv: pickSessionEnv(call.env) })).toMatchSnapshot();
  });

  it('auto-mode classifier trust block via config lists', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl(MCP_BASE);
    mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp/work',
      cols: 80,
      rows: 24,
      config: {
        ...BASE_CONFIG,
        autoModeAllow: ['Read(*)'],
        autoModeHardDeny: ['Bash(rm*)'],
        autoModeClassifyAllShell: true
      }
    });
    const call = spawns[0];
    expect(normalize({ args: call.args })).toMatchSnapshot();
  });

  it('overseer hook installed when overseerMode=on and auto-mode off', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl(MCP_BASE);
    mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp/work',
      cols: 80,
      rows: 24,
      config: { ...BASE_CONFIG, autoModeEnabled: false, overseerMode: 'on' }
    });
    const call = spawns[0];
    expect(
      normalize({ args: call.args, sessionEnv: pickSessionEnv(call.env) })
    ).toMatchSnapshot();
  });

  it('content-screen hook installed when contentScreenMode=on', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl(MCP_BASE);
    mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp/work',
      cols: 80,
      rows: 24,
      config: { ...BASE_CONFIG, contentScreenMode: 'on' }
    });
    const call = spawns[0];
    expect(
      normalize({ args: call.args, sessionEnv: pickSessionEnv(call.env) })
    ).toMatchSnapshot();
  });

  it('content-screen hook installed regardless of scheduled/headless/yolo (unlike overseer)', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl(MCP_BASE);
    mgr.create({
      projectId: 'proj1',
      profile: 'claude-yolo',
      cwd: '/tmp/work',
      cols: 80,
      rows: 24,
      scheduled: true,
      headless: true,
      config: { ...BASE_CONFIG, contentScreenMode: 'on', overseerMode: 'on' }
    });
    const call = spawns[0];
    expect(
      normalize({ args: call.args, sessionEnv: pickSessionEnv(call.env) })
    ).toMatchSnapshot();
  });

  it('heap ceiling injected into a clean NODE_OPTIONS for claude', () => {
    // Exercise the pure builder against a CLEAN env: the integration path
    // inherits the parent process's NODE_OPTIONS (vitest sets its own
    // --max-old-space-size), and applyHeapCeiling deliberately respects an
    // existing explicit choice — so a live create() spawn is environment-
    // dependent. The pure function is the deterministic contract.
    const env: Record<string, string> = {};
    applyHeapCeiling(env, true, { ...BASE_CONFIG, claudeMaxOldSpaceMB: 3072 });
    expect(env.NODE_OPTIONS).toBe('--max-old-space-size=3072');
  });

  it('heap ceiling is NOT injected for a non-claude profile', () => {
    const env: Record<string, string> = {};
    applyHeapCeiling(env, false, { ...BASE_CONFIG, claudeMaxOldSpaceMB: 3072 });
    expect(env.NODE_OPTIONS).toBeUndefined();
  });

  it('heap ceiling respects an already-set --max-old-space-size', () => {
    const env: Record<string, string> = { NODE_OPTIONS: '--max-old-space-size=8192' };
    applyHeapCeiling(env, true, { ...BASE_CONFIG, claudeMaxOldSpaceMB: 3072 });
    expect(env.NODE_OPTIONS).toBe('--max-old-space-size=8192');
  });

  it('no MCP / hooks when mcpBaseUrl is unset', () => {
    const mgr = new PtyManager();
    // deliberately no setMcpBaseUrl
    mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp/work',
      cols: 80,
      rows: 24,
      config: BASE_CONFIG
    });
    const call = spawns[0];
    expect(
      normalize({ command: call.command, args: call.args, sessionEnv: pickSessionEnv(call.env) })
    ).toMatchSnapshot();
  });
});

describe('golden argv — caller-pinned session id', () => {
  beforeEach(() => {
    spawns.length = 0;
  });

  it('does not mint --session-id when extraArgs already carry --resume <uuid>', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl(MCP_BASE);
    const pinned = 'a8ca9b2c-eaaa-4b62-b865-841a9344151e';
    mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp/work',
      cols: 80,
      rows: 24,
      config: BASE_CONFIG,
      extraArgs: ['--resume', pinned]
    });
    const args = spawns[0].args;
    // exactly one --session-id? none — the caller pinned via --resume
    expect(args.filter((a) => a === '--session-id').length).toBe(0);
    expect(args).toContain('--resume');
  });
});

describe.skip('golden command — remote buildRemoteCmd matrix', () => {
  beforeEach(() => {
    spawns.length = 0;
  });

  const remote: ProjectRemote = { host: 'devbox', user: 'sfwork', remotePath: '/home/sfwork/core' };

  for (const profile of PROFILES) {
    for (const layer of LAYERS) {
      const label = `remote ${profile} · ${layer}`;
      it(label, () => {
        const mgr = new PtyManager();
        mgr.setMcpBaseUrl(MCP_BASE);
        mgr.create({
          projectId: 'proj1',
          profile,
          cwd: '/tmp/work',
          cols: 80,
          rows: 24,
          config: BASE_CONFIG,
          remote,
          ...layerOpts(layer)
        });
        expect(spawns.length).toBe(1);
        const call = spawns[0];
        // ssh command: ['ssh', '-t', target, remoteCmd]
        expect(call.command).toBe('ssh');
        expect(normalize({ args: call.args })).toMatchSnapshot();
      });
    }
  }
});
