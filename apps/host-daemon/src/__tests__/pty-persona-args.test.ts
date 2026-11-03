import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parse } from 'smol-toml';

// PtyManager imports node-pty (real subprocesses). Mock it with a fake IPty
// that RECORDS the argv it was spawned with, so we can assert exactly what
// reaches the command line — in particular, the persona layer's position in
// the precedence stack and that allowedTools is merged+deduped.
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
      pid: 2000 + spawned.length,
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

// Keep claude-profile spawns from writing a real ~/.zcc/mcp file.
vi.mock('../mcp-config.js', () => ({
  ensureMcpConfigForProjectSync: (id: string, extra?: string[]) =>
    `/tmp/${id}/.mcp.json${extra?.length ? `?extra=${extra.join(',')}` : ''}`,
  alwaysOnPluginMcpAllowlist: () => ['mcp__plugin_example_browser']
}));

import { PtyManager, personaArgs_build } from '../pty.js';
import type { AppConfig, Persona, ProjectSettings } from '@zana-ai/zcc-domain/product';

const CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null,
};

describe('personaArgs_build', () => {
  it('emits append-system-prompt before add-dir', () => {
    const p: Persona = {
      id: 'test',
      name: 'Test',
      appendSystemPrompt: 'You are a helpful assistant.',
      addDirs: ['/foo', '/bar']
    };
    const args = personaArgs_build(p, 'claude');
    const promptIdx = args.indexOf('--append-system-prompt');
    const dir1Idx = args.indexOf('--add-dir');
    expect(promptIdx).toBeGreaterThanOrEqual(0);
    expect(dir1Idx).toBeGreaterThanOrEqual(0);
    expect(promptIdx).toBeLessThan(dir1Idx);
  });

  it('emits allowedTools as a single comma-separated flag', () => {
    const p: Persona = {
      id: 'test',
      name: 'Test',
      allowedTools: ['Read', 'Write', 'Bash']
    };
    const args = personaArgs_build(p, 'claude');
    expect(args).toContain('--allowedTools');
    const idx = args.indexOf('--allowedTools');
    expect(args[idx + 1]).toBe('Read,Write,Bash');
  });

  it('emits deniedTools as --disallowedTools', () => {
    const p: Persona = {
      id: 'test',
      name: 'Test',
      deniedTools: ['Agent', 'TaskCreate']
    };
    const args = personaArgs_build(p, 'claude');
    expect(args).toContain('--disallowedTools');
    const idx = args.indexOf('--disallowedTools');
    expect(args[idx + 1]).toBe('Agent,TaskCreate');
  });

  it('emits permissionMode last so it overrides globals', () => {
    const args = personaArgs_build(
      {
        id: '1',
        name: 'test',
        
        model: 'opus',
        permissionMode: 'plan'
      },
      'claude'
    );
    const promptIdx = args.indexOf('Hi');
    const permIdx = args.indexOf('--permission-mode');
    expect(promptIdx).toBeLessThan(permIdx);
    expect(permIdx).toBeGreaterThanOrEqual(0);
  });

  it('omits permissionMode when base profile is claude-yolo', () => {
    const p: Persona = {
      id: 'test',
      name: 'Test',
      permissionMode: 'acceptEdits'
    };
    const args = personaArgs_build(p, 'claude-yolo');
    expect(args).not.toContain('--permission-mode');
  });

  it('returns empty array when no persona flags are set', () => {
    const p: Persona = {
      id: 'test',
      name: 'Test'
    };
    const args = personaArgs_build(p, 'claude');
    expect(args).toEqual([]);
  });
});

describe('PtyManager.create — persona layer integration', () => {
  beforeEach(() => {
    spawned.length = 0;
  });

  it('applies global, project, persona, then agent prompt layers', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl('http://127.0.0.1:3000');
    const persona: Persona = {
      id: 'p1',
      name: 'Test Persona',
      appendSystemPrompt: 'persona prompt'
    };
    const projectSettings: ProjectSettings = {
      appendSystemPrompt: 'project prompt'
    };
    mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: { ...CONFIG, claudeAppendSystemPrompt: 'global prompt' },
      persona,
      projectSettings,
      extraArgs: ['--append-system-prompt', 'agent prompt']
    });
    const argv = spawned[0].args;
    // MCP guidance is infrastructure; user-configured layers follow it in order.
    const indices: number[] = [];
    for (let i = 0; i < argv.length; i += 1) {
      if (argv[i] === '--append-system-prompt') {
        indices.push(i);
      }
    }
    expect(indices.length).toBe(5);
    expect(argv[indices[0] + 1]).toBe('global prompt');
    expect(argv[indices[1] + 1]).toContain('inbox_push'); // infrastructure guidance
    expect(argv[indices[2] + 1]).toBe('project prompt');
    expect(argv[indices[3] + 1]).toBe('persona prompt');
    expect(argv[indices[4] + 1]).toBe('agent prompt');
  });

  it('emits Agent model and execution routing over Persona, Project, and Global settings', () => {
    const mgr = new PtyManager();
    mgr.create({
      projectId: 'proj1',
      profile: 'opencode',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: {
        ...CONFIG,
        harnessRouting: {
          schemaVersion: 1,
          byAdapter: {
            opencode: { modelTargetId: 'fixture-provider/gpt-6-luna', executionState: 'plan' }
          }
        }
      },
      projectSettings: {
        harnessRouting: {
          schemaVersion: 1,
          byAdapter: {
            opencode: { modelTargetId: 'fixture-provider/gpt-5.6-terra-1M', executionState: 'interactive' }
          }
        }
      },
      persona: { id: 'p1', name: 'P', modelLevel: 'high', executionState: 'accept-edits' },
      harnessRouting: {
        schemaVersion: 1,
        byAdapter: {
          opencode: { modelTargetId: 'fixture-provider/gemini-3.5-flash', executionState: 'autonomous' }
        }
      }
    });

    const argv = spawned[0].args;
    expect(argv).toContain('fixture-provider/gemini-3.5-flash');
    expect(argv).toContain('build');
    expect(argv).toContain('--auto');
    expect(argv).not.toContain('fixture-provider/gpt-6-luna');
    expect(argv).not.toContain('fixture-provider/gpt-5.6-terra-1M');
    expect(argv).not.toContain('fixture-provider/gpt-6.1-sol');
    expect(argv).not.toContain('plan');
  });

  it('does not append structured execution flags to unrestricted profiles', () => {
    const mgr = new PtyManager();
    expect(() => mgr.create({
      projectId: 'proj1',
      profile: 'codex-yolo',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: { ...CONFIG, harnessCodexEnabled: true },
      harnessRouting: {
        schemaVersion: 1,
        byAdapter: { codex: { executionState: 'plan' } }
      }
    })).toThrow('Structured execution state conflicts with unrestricted profile.');
    expect(spawned).toHaveLength(0);
  });

  it('emits one Persona-precedence Codex execution tuple over Project portable state', () => {
    const mgr = new PtyManager();
    mgr.create({
      projectId: 'proj1', profile: 'codex', cwd: '/tmp', cols: 80, rows: 24,
      config: { ...CONFIG, harnessCodexEnabled: true },
      projectSettings: { executionState: 'plan' },
      persona: { id: 'p', name: 'P', codexSandbox: 'workspace-write', codexApproval: 'never' }
    });
    const argv = spawned[0].args;
    expect(argv.filter((arg) => arg === '-s')).toHaveLength(1);
    expect(argv.filter((arg) => arg === '-a')).toHaveLength(1);
    expect(argv.slice(argv.indexOf('-s'), argv.indexOf('-s') + 4)).toEqual([
      '-s', 'workspace-write', '-a', 'never'
    ]);
  });

  it('merges persona allowedTools with inbox tools into a single flag', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl('http://127.0.0.1:3000');
    const persona: Persona = {
      id: 'p1',
      name: 'Test Persona',
      allowedTools: ['Read', 'Write']
    };
    mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG,
      persona
    });
    const argv = spawned[0].args;
    // Count --allowedTools flags; should be exactly one (merged)
    const count = argv.filter((a) => a === '--allowedTools').length;
    expect(count).toBe(1);
    const idx = argv.indexOf('--allowedTools');
    const merged = argv[idx + 1].split(',');
    // Should include both inbox pre-approvals and persona tools
    expect(merged).toContain('mcp__zcc-inbox__inbox_push');
    expect(merged).toContain('mcp__zcc-inbox__preview_file');
    // Follow-up tools are pre-approved too (project-locked, provenance-stamped),
    // so parking / resolving a question never prompts.
    expect(merged).toContain('mcp__zcc-inbox__followup_create');
    expect(merged).toContain('mcp__zcc-inbox__followup_list');
    expect(merged).toContain('mcp__zcc-inbox__followup_resolve');
    // Library + goal tools are pre-approved too (same host-confined trust model:
    // projectId/sessionId from the route, agent-data subtree only), so parking a
    // note or a goal mid-run never prompts.
    expect(merged).toContain('mcp__zcc-inbox__library_write');
    expect(merged).toContain('mcp__zcc-inbox__library_read');
    expect(merged).toContain('mcp__zcc-inbox__library_list');
    expect(merged).toContain('mcp__zcc-inbox__goal_create');
    expect(merged).toContain('mcp__zcc-inbox__goal_list');
    // register_project must be pre-approved too — otherwise a Quick Agent
    // scaffold flow stalls and never lands in the sidebar.
    expect(merged).toContain('mcp__zcc-inbox__register_project');
    expect(merged).not.toContain('mcp__zcc-inbox__clone_project');
    // library_remove (a delete) is deliberately NOT pre-approved.
    expect(merged).not.toContain('mcp__zcc-inbox__library_remove');
    expect(merged).toContain('Read');
    expect(merged).toContain('Write');
    // No duplicates
    expect(new Set(merged).size).toBe(merged.length);
  });

  it('combines global, project, and persona denied tools into one flag', () => {
    const mgr = new PtyManager();
    mgr.create({
      projectId: 'proj1', profile: 'claude', cwd: '/tmp', cols: 80, rows: 24,
      config: { ...CONFIG, claudeDeniedTools: ['Bash(rm:*)'] },
      projectSettings: { deniedTools: ['Write'] },
      persona: { id: 'p1', name: 'P', deniedTools: ['Bash(rm:*)', 'Edit'] }
    });
    const argv = spawned[0].args;
    expect(argv.filter((arg) => arg === '--disallowedTools')).toHaveLength(1);
    expect(argv[argv.indexOf('--disallowedTools') + 1]).toBe('Bash(rm:*),Write,Edit');
  });

  it('uses persona.baseProfile to override opts.profile for command resolution', () => {
    const mgr = new PtyManager();
    const persona: Persona = {
      id: 'p1',
      name: 'Yolo Persona',
      baseProfile: 'claude-yolo'
    };
    mgr.create({
      projectId: 'proj1',
      profile: 'claude', // caller asks for plain claude
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG,
      persona // but persona overrides to yolo
    });
    const argv = spawned[0].args;
    // Should see --dangerously-skip-permissions (the yolo marker)
    expect(argv).toContain('--dangerously-skip-permissions');
  });

  it('skips persona permissionMode when effective profile is claude-yolo', () => {
    const mgr = new PtyManager();
    const persona: Persona = {
      id: 'p1',
      name: 'Yolo Persona',
      baseProfile: 'claude-yolo',
      permissionMode: 'acceptEdits'
    };
    mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG,
      persona
    });
    const argv = spawned[0].args;
    expect(argv).not.toContain('--permission-mode');
  });

  it('stamps personaId onto the session object', () => {
    const mgr = new PtyManager();
    const persona: Persona = {
      id: 'persona-abc',
      name: 'Test'
    };
    const session = mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG,
      persona
    });
    expect(session.personaId).toBe('persona-abc');
  });

  it('passes persona mcpServers to mcp-config via the file path', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl('http://127.0.0.1:3000');
    const persona: Persona = {
      id: 'p1',
      name: 'Test',
      mcpServers: ['filesystem', 'git']
    };
    mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG,
      persona
    });
    const argv = spawned[0].args;
    const mcpIdx = argv.indexOf('--mcp-config');
    expect(mcpIdx).toBeGreaterThanOrEqual(0);
    // The mock ensureMcpConfigForProjectSync bakes extra names into the path
    const path = argv[mcpIdx + 1];
    expect(path).toContain('?extra=filesystem,git');
  });

  it('does nothing when persona is absent', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl('http://127.0.0.1:3000');
    mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG
      // no persona
    });
    const argv = spawned[0].args;
    // Should NOT contain persona-specific flags beyond the baseline MCP/inbox
    expect(argv.filter((a) => a === '--append-system-prompt').length).toBe(1);
  });
});

describe('PtyManager.create — trustZccToolsEnabled (whole-server pre-approval)', () => {
  beforeEach(() => {
    spawned.length = 0;
  });

  it('injects the whole-server wildcard and drops the narrow per-tool list when ON', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl('http://127.0.0.1:3000');
    mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: { ...CONFIG, trustZccToolsEnabled: true }
    });
    const argv = spawned[0].args;
    const idx = argv.indexOf('--allowedTools');
    expect(idx).toBeGreaterThanOrEqual(0);
    const tools = argv[idx + 1].split(',');
    // The whole-server wildcard covers every current + future zcc-inbox tool.
    expect(tools).toContain('mcp__zcc-inbox');
    expect(tools).toContain('mcp__plugin_example_browser');
    // The narrow per-tool entries are replaced by the wildcard, not appended
    // alongside it (no redundant scoping).
    expect(tools).not.toContain('mcp__zcc-inbox__inbox_push');
  });

  it('leaves the narrow per-tool allow-list intact when explicitly OFF', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl('http://127.0.0.1:3000');
    mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      // PtyManager.create reads config.trustZccToolsEnabled literally (no
      // fallback of its own) — the app-wide ON-by-default lives in
      // store.getConfig(), which is what actually feeds `config` at runtime.
      config: { ...CONFIG, trustZccToolsEnabled: false }
    });
    const argv = spawned[0].args;
    const idx = argv.indexOf('--allowedTools');
    const tools = argv[idx + 1].split(',');
    // Narrow list present; wildcard absent; privileged delete still withheld.
    expect(tools).toContain('mcp__zcc-inbox__inbox_push');
    expect(tools).toContain('mcp__zcc-inbox__preview_file');
    expect(tools).not.toContain('mcp__zcc-inbox');
    expect(tools).not.toContain('mcp__zcc-inbox__library_remove');
    expect(tools).not.toContain('mcp__plugin_example_browser');
    expect(tools).not.toContain('mcp__zcc-inbox__run_in_terminal');
  });

  it('pre-approves run_in_terminal only when the in-app terminals experiment is on', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl('http://127.0.0.1:3000');
    mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: { ...CONFIG, trustZccToolsEnabled: false, inAppAgentTerminalsEnabled: true }
    });
    const argv = spawned[0].args;
    const idx = argv.indexOf('--allowedTools');
    const tools = argv[idx + 1].split(',');
    expect(tools).toContain('mcp__zcc-inbox__run_in_terminal');
  });
});

describe('PtyManager.create — Codex MCP approval overrides', () => {
  beforeEach(() => {
    spawned.length = 0;
  });

  it.each(['job-team', 'structured', 'freeform'] as const)('keeps workspace-write + on-request and safe tool approvals for %s', (coordinationMode) => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl('http://127.0.0.1:3000');
    mgr.create({
      projectId: 'proj1',
      profile: 'codex',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      coordinationMode,
      config: {
        ...CONFIG,
        defaultCodexSandbox: 'workspace-write',
        defaultCodexApproval: 'on-request',
        trustZccToolsEnabled: false
      }
    });
    const argv = spawned[0].args;
    expect(argv).toEqual(expect.arrayContaining(['-s', 'workspace-write', '-a', 'on-request']));
    const prefix = 'mcp_servers.zcc-inbox.tools=';
    const override = argv.find((arg) => arg.startsWith(prefix));
    expect(override).toBeDefined();
    const tools = parse(`tools=${override!.slice(prefix.length)}`).tools;
    expect(tools).toMatchObject({
      'execution.work.complete': { approval_mode: 'approve' },
      'execution.work.block': { approval_mode: 'approve' },
      'execution.work.heartbeat': { approval_mode: 'approve' },
      inbox_push: { approval_mode: 'approve' }
    });
    expect(argv).not.toContain('--allowedTools');
    expect(tools).not.toHaveProperty('remote_exec');
    expect(tools).not.toHaveProperty('library_remove');
  });

  it('maps Trust all ZCC tools to Codex server-wide approval mode', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl('http://127.0.0.1:3000');
    mgr.create({
      projectId: 'proj1',
      profile: 'codex',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      coordinationMode: 'job-team',
      config: {
        ...CONFIG,
        defaultCodexSandbox: 'workspace-write',
        defaultCodexApproval: 'on-request',
        trustZccToolsEnabled: true
      }
    });
    const argv = spawned[0].args;
    expect(argv).toContain('mcp_servers.zcc-inbox.default_tools_approval_mode="approve"');
    expect(argv.some((arg) => arg.startsWith('mcp_servers.zcc-inbox.tools='))).toBe(false);
  });

  it.each([undefined, 'interactive-team'] as const)('does not add native approval overrides to an ordinary %s session', (coordinationMode) => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl('http://127.0.0.1:3000');
    mgr.create({ projectId: 'proj1', profile: 'codex', cwd: '/tmp', cols: 80, rows: 24,
      coordinationMode, config: { ...CONFIG, trustZccToolsEnabled: false } });
    expect(spawned[0].args.some((arg) => arg.includes('approval_mode'))).toBe(false);
  });

  it('does not add native approvals without a wired MCP server', () => {
    const mgr = new PtyManager();
    mgr.create({ projectId: 'proj1', profile: 'codex', cwd: '/tmp', cols: 80, rows: 24,
      coordinationMode: 'job-team', config: { ...CONFIG, trustZccToolsEnabled: true } });
    expect(spawned[0].args.some((arg) => arg.includes('approval_mode'))).toBe(false);
  });
});

describe('PtyManager.create — isolated-worktree self-awareness layer', () => {
  beforeEach(() => {
    spawned.length = 0;
  });

  it('appends an EXTRA worktree guidance block naming the path + branch', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl('http://127.0.0.1:3000');
    mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/Users/me/zcc-worktrees/proj1/featx',
      cols: 80,
      rows: 24,
      config: CONFIG,
      worktree: { path: '/Users/me/zcc-worktrees/proj1/featx', branch: 'zcc/featx' }
    });
    const argv = spawned[0].args;
    const promptFlags: string[] = [];
    for (let i = 0; i < argv.length; i += 1) {
      if (argv[i] === '--append-system-prompt') promptFlags.push(argv[i + 1]);
    }
    // Two blocks now: the baseline MCP/inbox guidance + the worktree block.
    expect(promptFlags.length).toBe(2);
    const wt = promptFlags[1];
    expect(wt).toContain('ISOLATED WORKTREE');
    expect(wt).toContain('/Users/me/zcc-worktrees/proj1/featx');
    expect(wt).toContain('zcc/featx');
    // The worktree block layers AFTER the inbox guidance (additive, not replacing).
    expect(promptFlags[0]).toContain('inbox_push');
  });

  it('records the worktree on the session object', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl('http://127.0.0.1:3000');
    const session = mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/Users/me/zcc-worktrees/proj1/featx',
      cols: 80,
      rows: 24,
      config: CONFIG,
      worktree: { path: '/Users/me/zcc-worktrees/proj1/featx', branch: 'zcc/featx' }
    });
    expect(session.worktree).toEqual({
      path: '/Users/me/zcc-worktrees/proj1/featx',
      branch: 'zcc/featx'
    });
  });

  it('emits NO worktree block on a normal launch (argv unchanged)', () => {
    const mgr = new PtyManager();
    mgr.setMcpBaseUrl('http://127.0.0.1:3000');
    const session = mgr.create({
      projectId: 'proj1',
      profile: 'claude',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      config: CONFIG
      // no worktree
    });
    const argv = spawned[0].args;
    expect(argv.filter((a) => a === '--append-system-prompt').length).toBe(1);
    expect(argv.some((a) => a.includes('ISOLATED WORKTREE'))).toBe(false);
    expect(session.worktree).toBeUndefined();
  });
});

describe('personaArgs_build — persona reasoning effort (#584)', () => {
  it('REQ-1: emits --effort with the persona level for a Claude persona', () => {
    const args = personaArgs_build({ id: 'p', name: 'P', reasoningLevel: 'high' }, 'claude');
    const idx = args.indexOf('--effort');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('high');
  });

  it.each(['low', 'medium', 'high', 'xhigh', 'max'] as const)('REQ-1: passes %s through unchanged', (level) => {
    const args = personaArgs_build({ id: 'p', name: 'P', reasoningLevel: level }, 'claude');
    expect(args).toEqual(['--effort', level]);
  });

  it('REQ-1: places --effort after --permission-mode, leaving other flag order alone', () => {
    const args = personaArgs_build(
      { id: 'p', name: 'P', appendSystemPrompt: 'x', permissionMode: 'plan', reasoningLevel: 'max' },
      'claude'
    );
    expect(args.indexOf('--effort')).toBeGreaterThan(args.indexOf('--permission-mode'));
    expect(args.indexOf('--append-system-prompt')).toBeLessThan(args.indexOf('--permission-mode'));
  });

  it('REQ-2: a persona without reasoningLevel launches with exactly the old arguments', () => {
    const base: Persona = {
      id: 'p', name: 'P', appendSystemPrompt: 'x', addDirs: ['/a'], allowedTools: ['Read'],
      deniedTools: ['Write'], permissionMode: 'plan'
    };
    const args = personaArgs_build(base, 'claude');
    expect(args).not.toContain('--effort');
    expect(args).toEqual([
      '--append-system-prompt', 'x', '--add-dir', '/a', '--allowedTools', 'Read',
      '--disallowedTools', 'Write', '--permission-mode', 'plan'
    ]);
  });

  it('REQ-3: claude-yolo gets --effort but never --permission-mode', () => {
    const args = personaArgs_build(
      { id: 'p', name: 'P', permissionMode: 'acceptEdits', reasoningLevel: 'xhigh' },
      'claude-yolo'
    );
    expect(args).toContain('--effort');
    expect(args[args.indexOf('--effort') + 1]).toBe('xhigh');
    expect(args).not.toContain('--permission-mode');
  });

  it('OBL-007: with a permission mode the argument list ends --permission-mode <mode> --effort <level>', () => {
    const args = personaArgs_build({ id: 'p', name: 'P', permissionMode: 'plan', reasoningLevel: 'high' }, 'claude');
    expect(args.slice(-4)).toEqual(['--permission-mode', 'plan', '--effort', 'high']);
  });

  it('OBL-006: claude-yolo with max effort and a permission mode yields exactly --effort max', () => {
    expect(personaArgs_build({ id: 'p', name: 'P', permissionMode: 'plan', reasoningLevel: 'max' }, 'claude-yolo'))
      .toEqual(['--effort', 'max']);
  });

  it('REQ-7: non-Claude harnesses ignore reasoningLevel', () => {
    for (const profile of ['codex', 'codex-yolo', 'opencode', 'cursor', 'pi'] as const) {
      const without = personaArgs_build({ id: 'p', name: 'P' }, profile);
      const withLevel = personaArgs_build({ id: 'p', name: 'P', reasoningLevel: 'max' }, profile);
      expect(withLevel, profile).toEqual(without);
      expect(withLevel, profile).not.toContain('--effort');
    }
  });
});

describe('PtyManager.create — persona reasoning effort (#584)', () => {
  beforeEach(() => {
    spawned.length = 0;
  });

  const create = (profile: 'claude' | 'claude-yolo' | 'codex', persona: Persona, extraArgs?: string[]) => {
    const mgr = new PtyManager();
    mgr.create({
      projectId: 'proj1', profile, cwd: '/tmp', cols: 80, rows: 24,
      config: { ...CONFIG, harnessCodexEnabled: true }, persona, extraArgs
    });
    return spawned[spawned.length - 1].args;
  };

  it('REQ-1/REQ-9: a Squad-seat style launch with a persona carries --effort', () => {
    const argv = create('claude', { id: 'squad-qa', name: 'QA', modelLevel: 'medium', reasoningLevel: 'high' });
    expect(argv[argv.indexOf('--effort') + 1]).toBe('high');
    expect(argv.filter((a) => a === '--effort')).toHaveLength(1);
  });

  it('REQ-2: the spawn argv without reasoningLevel has no --effort and matches the persona-less shape', () => {
    const persona: Persona = { id: 'p', name: 'P', modelLevel: 'medium' };
    const withField = create('claude', { ...persona, reasoningLevel: 'low' });
    const without = create('claude', persona);
    expect(without).not.toContain('--effort');
    expect(withField).toContain('--effort');
    // The session id is random per spawn; everything else must be identical.
    const stable = (argv: string[]) => argv.filter((a, i) => a !== argv[argv.indexOf('--session-id') + 1] || i === 0);
    const removeEffort = withField.filter((a, i) => !(a === '--effort' || withField[i - 1] === '--effort'));
    expect(stable(removeEffort)).toEqual(stable(without));
  });

  it('REQ-3: claude-yolo launch has --effort and no --permission-mode', () => {
    const argv = create('claude-yolo', { id: 'p', name: 'P', permissionMode: 'plan', reasoningLevel: 'max' });
    expect(argv).toContain('--effort');
    expect(argv).not.toContain('--permission-mode');
  });

  it('REQ-4: a per-tab --effort in extraArgs comes after the persona one', () => {
    const argv = create('claude', { id: 'p', name: 'P', reasoningLevel: 'low' }, ['--effort', 'max']);
    const positions = argv.map((a, i) => (a === '--effort' ? i : -1)).filter((i) => i >= 0);
    expect(positions).toHaveLength(2);
    expect(argv[positions[0] + 1]).toBe('low');
    expect(argv[positions[1] + 1]).toBe('max');
  });

  it('REQ-7: a Codex launch is identical with and without reasoningLevel', () => {
    const base: Persona = { id: 'p', name: 'P', codexSandbox: 'workspace-write', codexApproval: 'never' };
    const withLevel = create('codex', { ...base, reasoningLevel: 'max' });
    const without = create('codex', base);
    expect(withLevel).toEqual(without);
    expect(withLevel).not.toContain('--effort');
  });
});
