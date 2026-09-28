/**
 * Genuine-Claude-Code preference for the `claude` bare-command PATH lookup.
 *
 * `~/.aisuite/bin` (and other tool-installer dirs `fallbackDirs()` picks up)
 * can carry a `claude`-named wrapper we don't control that shadows the
 * genuine Claude Code CLI ahead of it on PATH. The launcher's spawn-time
 * resolver (`resolveHarnessCommand`, `harness-verify.ts`) takes the FIRST
 * PATH match by basename — correct for every other harness, but for claude a
 * wrong first match rejects claude-only flags (`unknown command:
 * --allowedTools`) and dies at spawn. This module scans every `claude` on
 * PATH and prefers the first one that identifies as the genuine CLI; when
 * none can be confirmed it returns the caller's fallback unchanged, so it can
 * only ever improve resolution, never regress it (a probe failure or an
 * install with an unexpected `--version` banner degrades to prior behavior,
 * not a block).
 */

import { execFileSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';

const PROBE_TIMEOUT_MS = 800;

/** Per-path identity verdicts, probed once per resolved path per process lifetime. */
const identityCache = new Map<string, boolean>();

function looksLikeGenuineClaudeCode(output: string): boolean {
  return /claude code/i.test(output);
}

/**
 * Spawn `<bin> --version` with a bounded timeout and classify the output.
 * Never throws: a missing/slow/erroring/unrecognized candidate is simply "not
 * genuine". Exported so tests can substitute a deterministic executor.
 */
export function probeClaudeIdentity(
  bin: string,
  exec: (command: string, args: readonly string[]) => string = (command, args) =>
    execFileSync(command, [...args], {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore']
    })
): boolean {
  if (identityCache.has(bin)) return identityCache.get(bin)!;
  let genuine = false;
  try {
    genuine = looksLikeGenuineClaudeCode(exec(bin, ['--version']));
  } catch {
    genuine = false;
  }
  identityCache.set(bin, genuine);
  return genuine;
}

/** Test-only: clear cached identity verdicts between runs. */
export function resetClaudeIdentityCacheForTests(): void {
  identityCache.clear();
}

/** Every directory on `pathVar` holding an executable literally named `claude`, in PATH order, deduped. */
function claudeCandidatesOnPath(pathVar: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of pathVar.split(':')) {
    if (!dir) continue;
    const candidate = join(dir, 'claude');
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      accessSync(candidate, constants.X_OK);
      out.push(candidate);
    } catch {
      /* not on this dir */
    }
  }
  return out;
}

/**
 * Prefer the first PATH `claude` candidate that identifies as genuine Claude
 * Code over the plain first-match `fallback`. Only meaningful for a bare
 * command name resolved from PATH — an explicit absolute/relative
 * `claudeBinary` override is operator intent and must never be second-guessed
 * (callers gate on that before calling this).
 */
export function resolveGenuineClaudeFromPath(
  fallback: string,
  pathVar: string = process.env.PATH ?? '',
  probe: (bin: string) => boolean = probeClaudeIdentity
): string {
  for (const candidate of claudeCandidatesOnPath(pathVar)) {
    if (probe(candidate)) return candidate;
  }
  return fallback;
}
