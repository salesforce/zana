/**
 * Core project-root resolver for the in-process built-in module tier (A3).
 *
 * This is the trusted, host-side authorization gate behind the SDK's optional
 * `ctx.resolveProjectRoot` (packages/extension-sdk/src/main.ts) — the executable
 * form of Engineering Rules 1 & 2: the renderer/agent is untrusted, so MAIN
 * confines any supplied project handle by realpath-matching it against a
 * REGISTERED project before granting access. A path that doesn't match a
 * registered project (or escapes one via a symlink) is REJECTED by throwing —
 * never a silent fall-back to the global anchor.
 *
 * Kept dependency-injected and electron-free (deps: { listProjects, home }) so
 * it is unit-testable without electron / the store / sqlite; the ctx member in
 * `modules/registry.ts` adapts this pure fn to the `ProjectRootResolution`
 * shape the SDK type promises.
 */

import { join, isAbsolute } from 'node:path';
import { realpathSync } from 'node:fs';
import { isWithin } from './extensions/path-util.js';
import type { Project } from '../shared/types.js';

export interface ResolveProjectRootDeps {
  /** The registered project list (the only trust anchors for a supplied path). */
  listProjects: () => Project[];
  /** Absolute HOME dir — the fixed base for the `.zana` global anchor. */
  home: string;
}

/**
 * Resolve a renderer/agent-supplied project handle to a CONFINED, authorized
 * `.zana` root. THROWS on rejection (Rule 1: main authorizes) — it NEVER
 * silently falls back to the global anchor when a project path is rejected.
 *
 * - `opts.useGlobal === true` → the FIXED `realpath(HOME)/.zana` anchor. This is
 *   a HOME-derived path, NOT a registered project, so it is NOT matched against
 *   `listProjects`.
 * - `opts.projectPath` → realpath BOTH the candidate AND each registered project
 *   root, then `isWithin`; the first match wins and resolves to
 *   `realpath(<project root>)/.zana`. An unmatched or escaping path THROWS.
 *
 * Resolving BOTH sides via `realpath` (mirrors `trustedProjectRoot` /
 * `createTerminalConfined` in index.ts) defeats a symlink that is lexically
 * inside a project but points outside it — a lexical-only `isWithin` would be
 * fooled.
 */
export function resolveProjectRoot(
  opts: { projectPath?: string; useGlobal?: boolean },
  deps: ResolveProjectRootDeps
): string {
  if (opts.useGlobal) {
    // Fixed HOME anchor — realpath'd so a symlinked HOME resolves consistently,
    // never matched against the registry.
    return join(realpathSync(deps.home), '.zana');
  }

  if (!opts.projectPath) {
    throw new Error('resolveProjectRoot: no projectPath and useGlobal not set');
  }

  let realCandidate: string;
  try {
    realCandidate = realpathSync(opts.projectPath);
  } catch {
    throw new Error(`resolveProjectRoot: cannot resolve path "${opts.projectPath}"`);
  }

  for (const project of deps.listProjects()) {
    let realRoot: string;
    try {
      realRoot = realpathSync(project.path);
    } catch {
      continue; // a registered project whose dir is gone can't anchor trust
    }
    if (isWithin(realCandidate, realRoot)) {
      return join(realRoot, '.zana');
    }
  }

  // No registered project contains the candidate → reject (NEVER fall back to
  // the global anchor).
  throw new Error(
    `resolveProjectRoot: path "${opts.projectPath}" is not within any registered project`
  );
}

/**
 * Bare-ticket-id traversal guard (A4's seam, owned by core). A ticket id flows
 * into a `<root>/.zana/.../<id>.json` path, so it must be a BARE identifier with
 * no path semantics. Accepts only a bare v4-style UUID; anything containing a
 * path separator, a `..`, or an absolute prefix is rejected by THROWING.
 */
export function assertSafeTicketId(id: string): void {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('assertSafeTicketId: id must be a non-empty string');
  }
  // Defense-in-depth: reject obvious traversal/path forms before the strict
  // shape check, so the error message points at the actual problem.
  if (id.includes('/') || id.includes('\\') || id.includes('..') || isAbsolute(id)) {
    throw new Error(`assertSafeTicketId: unsafe ticket id "${id}"`);
  }
  const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!V4.test(id)) {
    throw new Error(`assertSafeTicketId: not a bare v4 UUID: "${id}"`);
  }
}
