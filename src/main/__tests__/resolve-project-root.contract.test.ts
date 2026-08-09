// TDD gate for A3/A4 — MUST stay RED until A3 lands resolveProjectRoot and A4
// wires the opts.id guard. Loosening any assertion to go green is a contract
// regression — escalate.
//
// This suite is the executable form of Engineering Rules 1 & 2 (main
// authorizes; confine via realpath-match against registered projects / the
// HOME anchor). It pins the security behaviour of the not-yet-built core
// resolver (A3) and the `opts.id` traversal guard (A4) so neither can merge
// without satisfying confinement. Test-only — no production code here.
//
// ── SEAM (agreed with the A3/A4 owners; only the import target may be
//    confirmed later, never the assertions) ────────────────────────────────
// A1 froze the SDK *type* (packages/extension-sdk/src/main.ts). A3 exports the
// *implementation* in the dependency-injected PURE form so this test needs no
// electron / store / sqlite:
//
//   // src/main/resolve-project-root.ts (A3)
//   export function resolveProjectRoot(
//     opts: { projectPath?: string; useGlobal?: boolean },
//     deps: { listProjects: () => Project[]; home: string }
//   ): string;            // returns realpath(<root>)/.zana — THROWS on rejection,
//                         // NEVER a silent global fallback.
//
//   // A4's bare-ticket-id traversal guard (core, NOT plugins/zana):
//   export function assertSafeTicketId(id: string): void;  // THROWS on unsafe id
//
// Until A3/A4 land these exports, the imports below are unresolved and the
// suite fails to compile/run = RED. That RED is the documented blocker on
// A3/A4 (Acceptance criterion #1) — it is the intended signal, not a defect.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, symlinkSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Project } from '../../shared/types.js';
import { resolveProjectRoot } from '../resolve-project-root.js';
import { assertSafeTicketId } from '../resolve-project-root.js';

// ── Fixture: a fresh tmp HOME + tmp registered project (each with a `.zana/`),
//    plus an OUTSIDE dir and a symlink inside the project that escapes to it.
//    Rebuilt per-test and torn down so no state leaks between cases. ──────────
let BASE: string;
let HOME: string;
let PROJECT_DIR: string;
let OUTSIDE: string;
let ESCAPE_LINK: string;
let deps: { listProjects: () => Project[]; home: string };

beforeEach(() => {
  BASE = mkdtempSync(join(tmpdir(), 'zana-rpr-'));
  HOME = join(BASE, 'home');
  PROJECT_DIR = join(BASE, 'proj');
  OUTSIDE = join(BASE, 'outside');
  ESCAPE_LINK = join(PROJECT_DIR, 'escape');
  mkdirSync(HOME);
  mkdirSync(join(HOME, '.zana'));
  mkdirSync(PROJECT_DIR);
  mkdirSync(join(PROJECT_DIR, '.zana'));
  mkdirSync(OUTSIDE);
  symlinkSync(OUTSIDE, ESCAPE_LINK); // lexically inside PROJECT_DIR, realpaths out
  // One registered project. The resolver must realpath-match a supplied path
  // against THIS before trusting it; the HOME anchor is fixed and NOT matched.
  deps = { listProjects: () => [{ id: 'p1', path: PROJECT_DIR } as Project], home: HOME };
});

afterEach(() => {
  rmSync(BASE, { recursive: true, force: true });
});

describe('resolveProjectRoot — confinement contract (A3)', () => {
  it('(1) in-project path resolves to realpath(<project>)/.zana', () => {
    const root = resolveProjectRoot({ projectPath: PROJECT_DIR }, deps);
    expect(root).toBe(join(realpathSync(PROJECT_DIR), '.zana'));
  });

  it('(2) forged/out-of-project path THROWS — and never silently falls back to global', () => {
    expect(() => resolveProjectRoot({ projectPath: '/etc' }, deps)).toThrow();
    // Positive guard against a naive resolveSource port that would "succeed" by
    // returning the global anchor instead of rejecting.
    let returned: string | undefined;
    try {
      returned = resolveProjectRoot({ projectPath: '/etc' }, deps);
    } catch {
      /* expected */
    }
    expect(returned).toBeUndefined();
    expect(returned).not.toBe(join(realpathSync(HOME), '.zana'));
  });

  it('(3) useGlobal resolves to realpath(HOME)/.zana exactly', () => {
    const root = resolveProjectRoot({ useGlobal: true }, deps);
    // Asserted against realpath(HOME), never raw homedir — catches an A3 that
    // forgets to realpath the fixed HOME anchor.
    expect(root).toBe(join(realpathSync(HOME), '.zana'));
  });

  it('(4) a symlink inside the project that escapes outside is REJECTED (realpath both sides)', () => {
    // Lexically ESCAPE_LINK is within PROJECT_DIR; its realpath is OUTSIDE, an
    // unregistered dir. A lexical-only isWithin would wrongly accept it.
    expect(() => resolveProjectRoot({ projectPath: ESCAPE_LINK }, deps)).toThrow();
  });
});

describe('assertSafeTicketId — opts.id traversal guard (A4)', () => {
  it('(5a) rejects path-traversal and non-bare-id forms', () => {
    expect(() => assertSafeTicketId('../../../etc/passwd')).toThrow();
    expect(() => assertSafeTicketId('..')).toThrow();
    expect(() => assertSafeTicketId('foo/bar')).toThrow();
    expect(() => assertSafeTicketId('/etc/passwd')).toThrow();
  });

  it('(5b) accepts a bare v4-style UUID (no trailing .json)', () => {
    expect(() => assertSafeTicketId('11111111-2222-4333-8444-555555555555')).not.toThrow();
  });
});
