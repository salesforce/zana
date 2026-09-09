import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir as osHomedir } from 'node:os';
import { isWithin } from '@zana-ai/zcc-path-confine';
import type { CliPlanFile, HarnessFamily, TerminalSession } from '@zana-ai/zcc-domain/product';
import { harnessFamilyOf } from '@zana-ai/zcc-domain/launch-provider';

export const CLI_PLAN_MAX_BYTES = 256 * 1024;
export const CLI_PLAN_MTIME_SLACK_MS = 5_000;
export const CLI_PLAN_FAMILIES = ['claude', 'cursor', 'opencode'] as const;

export type CliPlanFamily = (typeof CLI_PLAN_FAMILIES)[number];

export function cliPlanIntentForLaunch(input: {
  familyId: HarnessFamily | string | null | undefined;
  executionState?: string;
  roleTargetId?: string;
}): boolean {
  if (!isCliPlanFamily(input.familyId)) return false;
  if (input.executionState === 'plan') return true;
  return input.familyId === 'opencode' && input.roleTargetId === 'plan';
}

export function isCliPlanFamily(family: string | null | undefined): family is CliPlanFamily {
  return family === 'claude' || family === 'cursor' || family === 'opencode';
}

export function isLocalCliPlanSession(session: TerminalSession): boolean {
  if (session.remoteTmuxId || session.remoteTunnel) return false;
  if (session.environment === 'runtime-host' || session.environment === 'microvm') return false;
  return true;
}

function realPathOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function cwdIsAllowed(cwd: string, allowedRoots: readonly string[]): boolean {
  const realCwd = realPathOrNull(cwd);
  if (!realCwd || allowedRoots.length === 0) return false;
  return allowedRoots.some((root) => {
    const realRoot = realPathOrNull(root);
    return realRoot ? isWithin(realCwd, realRoot) : false;
  });
}

function dirIsUnderAnyRoot(dir: string, roots: readonly string[]): boolean {
  const realDir = realPathOrNull(dir);
  if (!realDir || roots.length === 0) return false;
  return roots.some((root) => {
    const realRoot = realPathOrNull(root);
    return realRoot ? isWithin(realDir, realRoot) : false;
  });
}

function homePlansDir(homedir: string, family: 'claude' | 'cursor'): string {
  return join(homedir, family === 'claude' ? '.claude' : '.cursor', 'plans');
}

/** Candidate plan directories. Missing dirs are still returned (lexical) for watchers. */
export function cliPlanDirsFor(input: {
  family: CliPlanFamily;
  cwd: string;
  homedir: string;
  allowedRoots?: readonly string[];
}): string[] {
  const dirs: string[] = [];
  if (input.family === 'claude' || input.family === 'cursor') {
    dirs.push(homePlansDir(input.homedir, input.family));
  }
  const cwdAllowed = cwdIsAllowed(input.cwd, input.allowedRoots ?? [input.cwd]);
  if (cwdAllowed) {
    if (input.family === 'claude') dirs.push(join(input.cwd, '.claude', 'plans'));
    if (input.family === 'cursor') dirs.push(join(input.cwd, '.cursor', 'plans'));
    if (input.family === 'opencode') dirs.push(join(input.cwd, '.opencode', 'plans'));
  }
  return dirs;
}

function isMarkdownPlanName(name: string, family: CliPlanFamily): boolean {
  if (name.startsWith('.') || name.includes('/') || name.includes('\\') || name === '..') return false;
  const lower = name.toLowerCase();
  if (!lower.endsWith('.md')) return false;
  if (family === 'cursor' && !(lower.endsWith('.plan.md') || lower.endsWith('.md'))) return false;
  return true;
}

function listPlanCandidates(dir: string, family: CliPlanFamily): Array<{ path: string; mtime: number; size: number }> {
  const realDir = realPathOrNull(dir);
  if (!realDir) return [];
  let names: string[] = [];
  try {
    names = readdirSync(realDir);
  } catch {
    return [];
  }
  const out: Array<{ path: string; mtime: number; size: number }> = [];
  for (const name of names) {
    if (!isMarkdownPlanName(name, family)) continue;
    const full = join(realDir, name);
    const realFile = realPathOrNull(full);
    if (!realFile || !isWithin(realFile, realDir)) continue;
    if (basename(realFile) !== name) continue;
    let stats;
    try {
      stats = statSync(realFile);
    } catch {
      continue;
    }
    if (!stats.isFile()) continue;
    out.push({ path: realFile, mtime: stats.mtimeMs, size: stats.size });
  }
  return out;
}

export function readCliPlanFile(path: string, plansDir: string): CliPlanFile | null {
  const realDir = realPathOrNull(plansDir);
  const realFile = realPathOrNull(path);
  if (!realDir || !realFile || !isWithin(realFile, realDir)) return null;
  if (!basename(realFile).toLowerCase().endsWith('.md')) return null;
  let stats;
  try {
    stats = statSync(realFile);
  } catch {
    return null;
  }
  if (!stats.isFile() || stats.size <= 0 || stats.size > CLI_PLAN_MAX_BYTES) return null;
  try {
    return {
      path: realFile,
      markdown: readFileSync(realFile, 'utf8'),
      mtime: stats.mtimeMs
    };
  } catch {
    return null;
  }
}

export function discoverCliPlanFile(input: {
  family: CliPlanFamily;
  cwd: string;
  homedir: string;
  createdAt: number;
  now?: number;
  allowedRoots?: readonly string[];
}): CliPlanFile | null {
  const now = input.now ?? Date.now();
  const floor = input.createdAt - CLI_PLAN_MTIME_SLACK_MS;
  if (floor > now + CLI_PLAN_MTIME_SLACK_MS) return null;
  const dirs = cliPlanDirsFor(input);
  const homeDir = input.family === 'claude' || input.family === 'cursor'
    ? homePlansDir(input.homedir, input.family)
    : null;
  let best: CliPlanFile | null = null;
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const confineRoots = dir === homeDir ? [input.homedir] : (input.allowedRoots ?? [input.cwd]);
    if (!dirIsUnderAnyRoot(dir, confineRoots)) continue;
    for (const candidate of listPlanCandidates(dir, input.family)) {
      if (candidate.mtime < floor) continue;
      const file = readCliPlanFile(candidate.path, dir);
      if (!file) continue;
      if (!best || file.mtime > best.mtime || (file.mtime === best.mtime && file.path > best.path)) {
        best = file;
      }
    }
  }
  return best;
}

export function discoverCliPlanForSession(
  session: TerminalSession,
  opts?: { homedir?: string; allowedRoots?: readonly string[]; now?: number }
): CliPlanFile | null {
  if (!session.cliPlanIntent || !isLocalCliPlanSession(session)) return null;
  const family = harnessFamilyOf(session.profile);
  if (!isCliPlanFamily(family)) return null;
  return discoverCliPlanFile({
    family,
    cwd: session.cwd,
    homedir: opts?.homedir ?? osHomedir(),
    createdAt: session.createdAt,
    now: opts?.now,
    allowedRoots: opts?.allowedRoots ?? [session.cwd]
  });
}
