import { isSkip, preflightOrSkip } from '../src/matrix.js';
import { Zcc } from '../src/client.js';
import type { ProjectRecord } from '../src/projects.js';
import type { CliAgentLaunchSpec } from '../src/types.js';

/** Claude Code, Cursor, Codex, OpenCode — the four profiles these scenarios cover. */
export const SCENARIO_PROFILES = ['claude', 'cursor', 'codex', 'opencode'] as const;
export type ScenarioProfile = (typeof SCENARIO_PROFILES)[number];

export function harnessRoutingFor(profile: string): CliAgentLaunchSpec['harnessRouting'] {
  if (profile !== 'opencode') return undefined;
  return { schemaVersion: 1, byAdapter: { opencode: { roleTargetId: 'build' } } };
}

/**
 * Trusted execution-state routing so a file write does not hang on a native
 * permission TUI. extraArgs cannot carry `--force` / `--permission-mode` /
 * `-s` / `--auto` — `sanitizeExtraArgs` strips those as untrusted.
 */
export function writeAllowRouting(profile: string): CliAgentLaunchSpec['harnessRouting'] {
  return {
    schemaVersion: 1,
    byAdapter: { [profile]: { executionState: 'autonomous' } }
  };
}

export function pidIsDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

export async function withLiveAgent(
  profile: string,
  fn: (ctx: { zcc: Zcc; project: ProjectRecord }) => Promise<void>
): Promise<void> {
  const zcc = await Zcc.connect();
  try {
    const project = await zcc.projects.ensureLiveSandbox();
    const pre = await preflightOrSkip(zcc, { surface: 'cli-agent', profile });
    if (isSkip(pre)) {
      console.warn(`[live] skip ${profile}: ${pre.reason}`);
      return;
    }
    await fn({ zcc, project });
  } finally {
    await zcc.close();
  }
}
