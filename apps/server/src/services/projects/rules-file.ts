/**
 * Project + global RULES.md — the WARP.md analogue (WARP-C5).
 *
 * A launched agent inherits, on top of the built-in guidance, the operator's own
 * standing instructions from two layered markdown files:
 *   - GLOBAL:  `~/.zcc/RULES.md`            — applies to every project.
 *   - PROJECT: `<project.path>/.zcc/RULES.md` — git-trackable, project-specific.
 *
 * Both are OPTIONAL and best-effort: a missing/empty/oversized/unreadable file
 * contributes nothing, and a launch with neither is byte-identical to before
 * (the golden-argv net). The composed block is injected as an EXTRA
 * `--append-system-prompt` layer at spawn (see PtyManager.create), so it never
 * pollutes the user's global claude config and only applies to launcher-spawned
 * sessions.
 *
 * Trust model (Rule 1 / Rule 2): the PROJECT file is read ONLY from a path
 * confined against the registered project root via {@link confine} — a symlinked
 * `.zcc` pointing out of the project resolves outside the root and is rejected,
 * so a renderer/agent-supplied project handle can't coax main into reading an
 * arbitrary file. The read is size-capped ({@link RULES_MAX_BYTES}) so a
 * pathological file can't bloat every argv on the box (Rule 5).
 */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { confine } from './fs.js';
import { electronZccDataDir } from '../../electron-data-dir.js';

/** Filename convention, shared by both scopes. */
export const RULES_FILENAME = 'RULES.md';

/**
 * Hard cap on a single rules file. Standing instructions are meant to be short;
 * anything larger is almost certainly a mistake (a pasted transcript, a
 * generated dump) and would balloon the system prompt for every launch. Read is
 * skipped entirely above this — we do NOT truncate mid-file (a half-rule is
 * worse than none).
 */
export const RULES_MAX_BYTES = 32 * 1024; // 32 KiB

const globalRulesPath = () => join(electronZccDataDir(), RULES_FILENAME);

/**
 * Read one rules file, returning its trimmed text or null. Best-effort: any
 * error (missing, unreadable, oversized) resolves to null rather than throwing —
 * a launch must never fail because a RULES.md is malformed. Not exported; the
 * scope-specific readers below are the surface.
 */
function readRulesAt(path: string): string | null {
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size === 0 || st.size > RULES_MAX_BYTES) return null;
    const text = readFileSync(path, 'utf8').trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/** Read the global `~/.zcc/RULES.md`, or null when absent/empty/oversized. */
export function readGlobalRules(): string | null {
  return readRulesAt(globalRulesPath());
}

/**
 * Read a project's `<root>/.zcc/RULES.md`, or null. `projectRoot` MUST be a
 * registered project's path — the target is {@link confine}d against it so a
 * symlink escape is rejected before any read (Rule 2). Returns null on any
 * confinement failure or read error.
 */
export function readProjectRules(projectRoot: string): string | null {
  const target = join(projectRoot, '.zcc', RULES_FILENAME);
  const c = confine(projectRoot, target);
  if (!c.ok) return null;
  return readRulesAt(c.path);
}

/**
 * Compose the layered rules into ONE system-prompt block, or null when both
 * scopes are empty (so the caller omits the `--append-system-prompt` entirely
 * and the argv stays byte-identical). Project rules are placed AFTER global so a
 * project-specific instruction reads as the more-specific, later word. Pure
 * given its two inputs — the file I/O is in the readers above, so this is
 * trivially testable and safe to reuse from the spawn plan.
 */
export function composeRulesGuidance(
  globalRules: string | null,
  projectRules: string | null
): string | null {
  const sections: string[] = [];
  if (globalRules) {
    sections.push(`GLOBAL RULES (~/.zcc/${RULES_FILENAME}) — the operator's standing instructions:\n${globalRules}`);
  }
  if (projectRules) {
    sections.push(`PROJECT RULES (.zcc/${RULES_FILENAME}) — instructions specific to THIS project:\n${projectRules}`);
  }
  if (sections.length === 0) return null;
  return [
    'OPERATOR RULES: The following are standing instructions the operator has',
    'placed in their rules files for you to follow in this project. Treat them as',
    'authoritative project guidance (below only explicit instructions in this',
    'session). If a rule conflicts with a direct request in the conversation, the',
    'conversation wins — surface the conflict rather than silently ignoring either.',
    '\n\n' + sections.join('\n\n')
  ].join(' ');
}

/**
 * Resolve the full composed rules block for a project root, reading both scopes
 * from disk. Returns null when there is nothing to inject. This is the one call
 * the boot wiring hands to PtyManager as its rules resolver (keeps PtyManager
 * free of file I/O).
 */
export function resolveRulesGuidance(projectRoot: string | undefined): string | null {
  const globalRules = readGlobalRules();
  const projectRules = projectRoot ? readProjectRules(projectRoot) : null;
  return composeRulesGuidance(globalRules, projectRules);
}
