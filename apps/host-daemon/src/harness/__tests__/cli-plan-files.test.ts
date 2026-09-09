import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';
import {
  CLI_PLAN_MAX_BYTES,
  cliPlanDirsFor,
  cliPlanIntentForLaunch,
  discoverCliPlanFile,
  discoverCliPlanForSession
} from '../cli-plan-files.js';

const dirs: string[] = [];

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function session(over: Partial<TerminalSession>): TerminalSession {
  return {
    id: 's1',
    projectId: 'p1',
    title: 'Plan',
    profile: 'claude',
    cwd: '/tmp/proj',
    status: 'running',
    createdAt: 1_000_000,
    ...over
  } as TerminalSession;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('cliPlanIntentForLaunch', () => {
  it('stamps Claude/Cursor Plan execution and OpenCode --agent plan', () => {
    expect(cliPlanIntentForLaunch({ familyId: 'claude', executionState: 'plan' })).toBe(true);
    expect(cliPlanIntentForLaunch({ familyId: 'cursor', executionState: 'plan' })).toBe(true);
    expect(cliPlanIntentForLaunch({ familyId: 'opencode', roleTargetId: 'plan' })).toBe(true);
    expect(cliPlanIntentForLaunch({ familyId: 'opencode', executionState: 'plan' })).toBe(true);
  });

  it('skips Agent-mode, Codex, Pi, and remote-ineligible families', () => {
    expect(cliPlanIntentForLaunch({ familyId: 'claude' })).toBe(false);
    expect(cliPlanIntentForLaunch({ familyId: 'claude', executionState: 'interactive' })).toBe(false);
    expect(cliPlanIntentForLaunch({ familyId: 'codex', executionState: 'plan' })).toBe(false);
    expect(cliPlanIntentForLaunch({ familyId: 'pi', executionState: 'plan' })).toBe(false);
    expect(cliPlanIntentForLaunch({ familyId: 'opencode', roleTargetId: 'build' })).toBe(false);
  });
});

describe('discoverCliPlanFile', () => {
  it('picks the newest markdown written since spawn and ignores older files', () => {
    const home = tmp('cli-plan-home-');
    const plans = join(home, '.claude', 'plans');
    mkdirSync(plans, { recursive: true });
    const older = join(plans, 'old-slug.md');
    const newer = join(plans, 'new-slug.md');
    writeFileSync(older, '# old');
    writeFileSync(newer, '# new');
    utimesSync(older, new Date(900_000), new Date(900_000));
    utimesSync(newer, new Date(1_000_000), new Date(1_000_000));
    const found = discoverCliPlanFile({
      family: 'claude',
      cwd: tmp('cli-plan-cwd-'),
      homedir: home,
      createdAt: 1_000_000,
      now: 1_000_000
    });
    expect(found?.markdown).toBe('# new');
    expect(found?.path.endsWith('new-slug.md')).toBe(true);
  });

  it('returns null when the plans directory is missing', () => {
    expect(discoverCliPlanFile({
      family: 'claude',
      cwd: tmp('cli-plan-missing-cwd-'),
      homedir: tmp('cli-plan-missing-home-'),
      createdAt: 1_000_000,
      now: 1_000_000
    })).toBeNull();
  });

  it('caps oversized files and skips them', () => {
    const home = tmp('cli-plan-size-');
    const plans = join(home, '.claude', 'plans');
    mkdirSync(plans, { recursive: true });
    writeFileSync(join(plans, 'huge.md'), 'x'.repeat(CLI_PLAN_MAX_BYTES + 1));
    utimesSync(join(plans, 'huge.md'), new Date(1_000_000), new Date(1_000_000));
    expect(discoverCliPlanFile({
      family: 'claude',
      cwd: tmp('cli-plan-size-cwd-'),
      homedir: home,
      createdAt: 1_000_000,
      now: 1_000_000
    })).toBeNull();
  });

  it('rejects a symlink that escapes the plans directory', () => {
    const home = tmp('cli-plan-esc-home-');
    const outside = tmp('cli-plan-esc-out-');
    const plans = join(home, '.claude', 'plans');
    mkdirSync(plans, { recursive: true });
    const secret = join(outside, 'secret.md');
    writeFileSync(secret, '# leaked');
    symlinkSync(secret, join(plans, 'alias.md'));
    expect(discoverCliPlanFile({
      family: 'claude',
      cwd: tmp('cli-plan-esc-cwd-'),
      homedir: home,
      createdAt: Date.now(),
      now: Date.now()
    })).toBeNull();
  });

  it('rejects a HOME plans dir that symlink-escapes homedir', () => {
    const home = tmp('cli-plan-home-esc-');
    const outside = tmp('cli-plan-home-esc-out-');
    mkdirSync(join(home, '.claude'));
    writeFileSync(join(outside, 'secret.md'), '# leaked');
    symlinkSync(outside, join(home, '.claude', 'plans'));
    expect(discoverCliPlanFile({
      family: 'claude',
      cwd: tmp('cli-plan-home-esc-cwd-'),
      homedir: home,
      createdAt: Date.now(),
      now: Date.now()
    })).toBeNull();
  });

  it('refuses OpenCode cwd outside the registered project', () => {
    const project = tmp('cli-plan-oc-proj-');
    const other = tmp('cli-plan-oc-other-');
    mkdirSync(join(other, '.opencode', 'plans'), { recursive: true });
    const planted = join(other, '.opencode', 'plans', 'plan.md');
    writeFileSync(planted, '# other');
    expect(cliPlanDirsFor({
      family: 'opencode',
      cwd: other,
      homedir: tmp('cli-plan-oc-home-'),
      allowedRoots: [project]
    })).toEqual([]);
    expect(discoverCliPlanFile({
      family: 'opencode',
      cwd: other,
      homedir: tmp('cli-plan-oc-home2-'),
      createdAt: Date.now(),
      now: Date.now(),
      allowedRoots: [project]
    })).toBeNull();
  });

  it('reads an OpenCode plan under the project cwd', () => {
    const project = tmp('cli-plan-oc-ok-');
    mkdirSync(join(project, '.opencode', 'plans'), { recursive: true });
    const file = join(project, '.opencode', 'plans', 'plan.md');
    writeFileSync(file, '# opencode plan');
    const found = discoverCliPlanFile({
      family: 'opencode',
      cwd: project,
      homedir: tmp('cli-plan-oc-ok-home-'),
      createdAt: Date.now() - 1_000,
      now: Date.now(),
      allowedRoots: [project]
    });
    expect(found?.markdown).toBe('# opencode plan');
    expect(found?.path.endsWith('plan.md')).toBe(true);
  });

  it('reads Cursor *.plan.md from HOME', () => {
    const home = tmp('cli-plan-cursor-');
    mkdirSync(join(home, '.cursor', 'plans'), { recursive: true });
    const file = join(home, '.cursor', 'plans', 'task.plan.md');
    writeFileSync(file, '# cursor');
    const found = discoverCliPlanFile({
      family: 'cursor',
      cwd: tmp('cli-plan-cursor-cwd-'),
      homedir: home,
      createdAt: Date.now() - 1_000,
      now: Date.now()
    });
    expect(found?.markdown).toBe('# cursor');
  });
});

describe('discoverCliPlanForSession', () => {
  it('requires cliPlanIntent and a local session', () => {
    const home = tmp('cli-plan-sess-home-');
    mkdirSync(join(home, '.claude', 'plans'), { recursive: true });
    writeFileSync(join(home, '.claude', 'plans', 'x.md'), '# x');
    const cwd = tmp('cli-plan-sess-cwd-');
    expect(discoverCliPlanForSession(
      session({ cwd, cliPlanIntent: true }),
      { homedir: home, allowedRoots: [cwd] }
    )?.markdown).toBe('# x');
    expect(discoverCliPlanForSession(
      session({ cwd, cliPlanIntent: undefined }),
      { homedir: home, allowedRoots: [cwd] }
    )).toBeNull();
    expect(discoverCliPlanForSession(
      session({ cwd, cliPlanIntent: true, remoteTmuxId: 'cc-x' }),
      { homedir: home, allowedRoots: [cwd] }
    )).toBeNull();
  });

  it('does not import thread plan writers', () => {
    const source = readFileSync(new URL('../cli-plan-files.ts', import.meta.url), 'utf8');
    const watch = readFileSync(new URL('../cli-plan-watch.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('writeThreadPlanFile');
    expect(source).not.toContain('thread_plans');
    expect(source).not.toContain('conversation-plan');
    expect(watch).not.toContain('writeThreadPlanFile');
    expect(watch).not.toContain('thread_plans');
  });
});

describe('cliPlanDirsFor', () => {
  it('keeps HOME plans on the subdirectory, not the whole harness dir', () => {
    const home = '/Users/demo';
    expect(cliPlanDirsFor({
      family: 'claude',
      cwd: '/missing-cwd',
      homedir: home,
      allowedRoots: []
    })).toEqual([join(home, '.claude', 'plans')]);
  });
});
