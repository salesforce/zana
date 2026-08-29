/**
 * runSuggestion — the TRUST SEAM for executing a Suggested Action (afl-03 §4).
 *
 * A suggestion's action fields (`cwd`, `profile`, `persona`, `nav`, `projectId`)
 * are ADVISORY — they were proposed by an agent over MCP and are never trusted
 * as-authored (Rule 1/2). This module reads the suggestion from main's OWN store
 * (never a renderer-supplied action object), then RE-AUTHORIZES every step:
 *
 *  - `start-terminal` / `start-agent` → `createTerminal(...)`, which confines the
 *    cwd to a registered project and validates persona/profile. An unrecognized
 *    profile falls back to the default (`claude`).
 *  - `combo` → runs its steps IN ORDER, each independently re-authorized; a
 *    trailing `open-view`/`navigate` step returns a nav directive so the combo
 *    can move the operator after acting. (Nav kinds are combo-only — the store
 *    rejects them as a standalone suggestion.)
 *
 * Running a suggestion `delete`s it — every suggestion is one-shot.
 *
 * Deps are injected so the seam is unit-testable without an Electron main.
 */

import type { CreateTerminalRequest, LaunchProfileId, Result, TerminalSession } from '@zana-ai/zcc-domain/product';
import type { SuggestedActionKind } from '@zana-ai/zcc-domain/product';
import type { ISuggestionsStore } from './suggestions-store.js';
import { parseProfile } from '@zana-ai/zcc-domain/launch-provider';

/** What the renderer should do after a run — spawns happen in main, nav is a renderer concern. */
export interface RunDirective {
  nav?: string;
  projectId?: string;
  tabId?: string;
}

export interface RunSuggestionResult extends RunDirective {
  ok: boolean;
}

export interface RunSuggestionDeps {
  store: ISuggestionsStore;
  /** The confined terminal factory (main's `createTerminalConfined`). */
  createTerminal: (req: CreateTerminalRequest) => Result<TerminalSession> | Promise<Result<TerminalSession>>;
  /** Ids of the projects the store currently knows about (for `navigate` validation). */
  listProjectIds: () => string[];
}

/** Default launch profile when a suggestion's profile is missing/unrecognized. */
const DEFAULT_PROFILE: LaunchProfileId = 'claude';

async function createTerminalOrThrow(
  req: CreateTerminalRequest,
  deps: RunSuggestionDeps
): Promise<void> {
  const result = await deps.createTerminal(req);
  if (!result.ok) throw new Error(result.message);
}

/**
 * Execute ONE action step, re-authorizing every field. Returns a nav directive
 * for view/navigate steps; terminal/agent steps spawn and return `{}`. A `combo`
 * runs its steps in order and returns the LAST non-empty directive (so a combo
 * ending in a navigate still moves the operator there).
 */
async function executeAction(
  action: SuggestedActionKind,
  suggestionProjectId: string,
  deps: RunSuggestionDeps
): Promise<RunDirective> {
  switch (action.kind) {
    case 'start-terminal': {
      // profile is advisory — an unknown value falls back to the default, never
      // spawns something unexpected. cwd is confined by createTerminal (Rule 2).
      const profile = (action.profile && parseProfile(action.profile)) || DEFAULT_PROFILE;
      await createTerminalOrThrow({
        projectId: suggestionProjectId,
        profile,
        cwd: action.cwd,
        cols: 80,
        rows: 24
      }, deps);
      return {};
    }
    case 'start-agent': {
      // persona is advisory — createTerminal resolves it against the persona
      // store and silently ignores an unknown id. Prompt rides as-is (positional).
      await createTerminalOrThrow({
        projectId: suggestionProjectId,
        profile: DEFAULT_PROFILE,
        personaId: action.persona,
        prompt: action.prompt,
        cols: 80,
        rows: 24
      }, deps);
      return {};
    }
    case 'open-view': {
      // nav is a renderer-side view id — passed as an advisory directive the
      // renderer validates against its own known views (an unknown nav is a no-op).
      return { nav: action.nav };
    }
    case 'navigate': {
      // Re-authorize the target project against the store (Rule 1) — a forged
      // projectId that isn't registered yields no directive.
      if (!deps.listProjectIds().includes(action.projectId)) return {};
      return { projectId: action.projectId, tabId: action.tabId };
    }
    case 'combo': {
      let last: RunDirective = {};
      for (const step of action.steps) {
        const d = await executeAction(step, suggestionProjectId, deps);
        if (d.nav || d.projectId) last = d;
      }
      return last;
    }
    default:
      return {};
  }
}

/**
 * Read the suggestion from main's own store, execute it (re-authorizing every
 * step), and delete it unless it's a durable `open-view`. Unknown id → `{ ok:false }`.
 */
export async function runSuggestion(id: string, deps: RunSuggestionDeps): Promise<RunSuggestionResult> {
  const { entries } = await deps.store.read({ limit: 1000 });
  const s = entries.find((e) => e.id === id);
  if (!s) return { ok: false };

  const directive = await executeAction(s.action, s.projectId, deps);

  // One-shot: consuming the suggestion always removes it. (Nav-only kinds no
  // longer exist standalone, so there's no durable-shortcut exception.)
  await deps.store.delete(id);

  return { ok: true, ...directive };
}
