/**
 * suggest_action — project-scoped outbound channel for RUNNABLE next actions.
 *
 * The sibling of {@link ./inbox-mcp-tool.ts}: where `inbox_push` surfaces a
 * question/report ("here's something to read/answer"), `suggest_action` proposes
 * a one-click action ("here's a thing you could DO next"). Like inbox_push it's a
 * project-scoped factory — `projectId` is closed over from the MCP route, never
 * taken from the agent (Rule 1) — and every action field is ADVISORY: the host
 * re-authorizes each step at run time (confining cwd/projectId, whitelisting
 * profile/persona/nav), so a forged path/bin can never escape via a suggestion.
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ISuggestionsStore } from './suggestions-store.js';
import type { SuggestedActionKind, InboxOrigin } from '@zana-ai/zcc-domain/product';

export const SUGGEST_ACTION_DESCRIPTION = [
  'Propose a RUNNABLE next action for the operator to trigger with one click.',
  'Use this ONLY when you have PRE-ASSEMBLED a concrete action the operator would',
  'otherwise have to compose by hand — a seeded agent, a project-scoped terminal,',
  'or an ordered multi-step combo. It is NOT for questions or reports (inbox_push)',
  'and NOT for pointing at a view or project the operator can already reach in one',
  'sidebar click. The action is advisory — the host re-authorizes every field.',
  '',
  'Standalone action kinds (each must carry real payload):',
  "- {kind:'start-agent', persona?, prompt} — spawn an agent seeded with a SPECIFIC",
  '  prompt (the whole point: you write the prompt so the operator does not have to).',
  "- {kind:'start-terminal', profile?, cwd?} — open a terminal in a specific cwd/profile.",
  "- {kind:'combo', steps:[...]} — run several actions in order.",
  '',
  'Navigation kinds carry NO payload and CANNOT stand alone — they are allowed',
  'ONLY as the LAST step of a combo (a courtesy "…then take me there" tail):',
  "- {kind:'open-view', nav} — open a top-level view (e.g. 'inbox').",
  "- {kind:'navigate', projectId, tabId?} — focus a project/tab.",
  'A standalone open-view/navigate suggestion is REJECTED.',
  '',
  'REQUIRED `reason`: one line answering "why this, why now" — the operator reads it',
  'to decide. State the trigger and expected outcome (e.g. "CI is green on the branch',
  'you just pushed — ready for a review pass"). A bare restatement of the title is',
  'not a reason. `detail` (optional) is longer body copy.',
  '',
  'Pass `expiresInMinutes` — a next step is time-bound; it defaults to a few hours',
  'and is dropped when stale. Pass `dedupeKey` to refresh an existing suggestion',
  'instead of adding a new one.',
  'LINKING: a next step you propose from the same session as an inbox_push report',
  'is AUTOMATICALLY linked to it — the inbox entry shows a "Related next steps"',
  'chip pointing here, so the operator can jump from the report straight to the',
  'action it produced (both calls share the session the host stamps from the',
  'route; you need do nothing). You can also link explicitly across sessions by',
  'giving this call the same `dedupeKey` the report used.'
].join(' ');

// NOTE: projectId is deliberately ABSENT — it is stamped from the MCP route so
// an agent cannot forge which project a suggestion targets (rule 1).
export const suggestActionInputSchema = {
  title: z.string().min(1).max(200).describe('Short label for the action button.'),
  reason: z
    .string()
    .min(1)
    .max(280)
    .describe('REQUIRED one line: why this, why now (the trigger + expected outcome).'),
  detail: z.string().max(2000).optional().describe('Optional longer description (markdown).'),
  action: z
    .any()
    .describe('The action to run. Polymorphic on `kind`; validated by the host.'),
  dedupeKey: z
    .string()
    .max(200)
    .optional()
    .describe('Coalescing key — refreshes an existing suggestion sharing this key.'),
  expiresInMinutes: z
    .number()
    .positive()
    .max(10080)
    .optional()
    .describe('Drop the suggestion after this many minutes (max 1 week).')
};

const KNOWN_KINDS = new Set(['start-terminal', 'start-agent', 'open-view', 'navigate', 'combo']);

// Advisory field caps — main re-authorizes, but bound the persisted payload so a
// runaway agent can't write megabytes of "cwd" into the store.
const MAX_PATH = 1024;
const MAX_SHORT = 200;
const MAX_REASON = 280;
const MAX_PROMPT = 4000;
const MAX_COMBO_STEPS = 12;

/** A next step is time-bound. When the agent gives no `expiresInMinutes`, expire
 *  it after this default so stale suggestions self-drop (read-time filtered). */
const DEFAULT_EXPIRY_MINUTES = 240; // 4 hours

function clampStr(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  return v.slice(0, max);
}

/**
 * Validate + clamp an action to a known-`kind` shape. Returns null when the kind
 * is unknown (or, for combo, when NO step survives). Recurses one level for combo
 * (nested combos are dropped as steps — no unbounded recursion). Every field is
 * clamped, never trusted; the host re-authorizes at run time.
 *
 * PAYLOAD RULE: `open-view` / `navigate` carry no payload and duplicate a
 * one-click sidebar action, so they are REJECTED as a standalone top-level
 * action (`depth === 0`) and accepted ONLY as a combo step (`depth > 0`). This
 * is the enforcement point for the "next steps must carry weight" contract.
 */
export function sanitizeAction(a: unknown, depth = 0): SuggestedActionKind | null {
  if (!a || typeof a !== 'object') return null;
  const kind = (a as { kind?: unknown }).kind;
  if (typeof kind !== 'string' || !KNOWN_KINDS.has(kind)) return null;
  const raw = a as Record<string, unknown>;
  switch (kind) {
    case 'start-terminal':
      return { kind, profile: clampStr(raw.profile, MAX_SHORT), cwd: clampStr(raw.cwd, MAX_PATH) };
    case 'start-agent':
      return { kind, persona: clampStr(raw.persona, MAX_SHORT), prompt: clampStr(raw.prompt, MAX_PROMPT) };
    case 'open-view': {
      // Nav-only — allowed solely as a combo step, never standalone.
      if (depth === 0) return null;
      const nav = clampStr(raw.nav, MAX_SHORT);
      if (!nav) return null;
      return { kind, nav };
    }
    case 'navigate': {
      // Nav-only — allowed solely as a combo step, never standalone.
      if (depth === 0) return null;
      const projectId = clampStr(raw.projectId, MAX_SHORT);
      if (!projectId) return null;
      return { kind, projectId, tabId: clampStr(raw.tabId, MAX_SHORT) };
    }
    case 'combo': {
      // Guard against nesting: combo steps may not themselves be combos.
      if (depth > 0) return null;
      const rawSteps = Array.isArray(raw.steps) ? raw.steps.slice(0, MAX_COMBO_STEPS) : [];
      const steps = rawSteps
        .map((s) => sanitizeAction(s, depth + 1))
        .filter((s): s is SuggestedActionKind => s !== null);
      // A combo must contain at least one payload-bearing step — a combo of only
      // nav steps is the same empty gesture we reject standalone.
      if (steps.length === 0) return null;
      const hasPayloadStep = steps.some(
        (s) => s.kind === 'start-terminal' || s.kind === 'start-agent'
      );
      if (!hasPayloadStep) return null;
      return { kind, steps };
    }
    default:
      return null;
  }
}

export interface RegisterSuggestActionOpts {
  projectId: string;
  projectLabel?: string;
  sessionId?: string;
  origin?: InboxOrigin;
  suggestionsStore: ISuggestionsStore;
  now?: () => number;
}

export function registerSuggestActionTool(server: McpServer, opts: RegisterSuggestActionOpts): void {
  const now = opts.now ?? (() => Date.now());
  server.registerTool(
    'suggest_action',
    { description: SUGGEST_ACTION_DESCRIPTION, inputSchema: suggestActionInputSchema },
    async ({ title, reason, detail, action, dedupeKey, expiresInMinutes }) => {
      try {
        const sanitized = sanitizeAction(action);
        if (!sanitized) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text:
                  'suggest_action failed: action must carry a payload — a standalone ' +
                  'open-view/navigate is rejected (allowed only as a combo tail), and a ' +
                  'combo needs at least one start-terminal/start-agent step.'
              }
            ]
          };
        }
        // A next step is time-bound — default the expiry so stale ones self-drop.
        const minutes = expiresInMinutes ?? DEFAULT_EXPIRY_MINUTES;
        const expiresAt = now() + minutes * 60_000;
        const entry = await opts.suggestionsStore.append({
          projectId: opts.projectId, // from route, never input
          projectLabel: opts.projectLabel,
          title: String(title).slice(0, MAX_SHORT),
          reason: String(reason).slice(0, MAX_REASON),
          detail: detail ? String(detail).slice(0, 2000) : undefined,
          action: sanitized,
          sessionId: opts.sessionId,
          origin: opts.origin,
          dedupeKey: dedupeKey ? String(dedupeKey).slice(0, MAX_SHORT) : undefined,
          expiresAt
        });
        return {
          content: [{ type: 'text' as const, text: `Suggestion queued. id=${entry.id}` }]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `suggest_action failed: ${message}` }]
        };
      }
    }
  );
}
