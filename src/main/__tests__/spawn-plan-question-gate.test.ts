import { describe, it, expect } from 'vitest';
import { buildHookSettings } from '../harness/spawn-plan.js';

/**
 * GATE test for the EXPERIMENTAL AskUserQuestion in-app feature (flag
 * `askUserQuestionUiEnabled`, default false). `buildHookSettings` is where the
 * `question` hook is (or is not) registered. The contract:
 *   - flag OFF  → emitted hooks are byte-identical to today (no /hook/question
 *     forwarding hook; the notify blocked/unblocked entries are untouched).
 *   - flag ON   → exactly ONE additive PreToolUse hook forwarding to
 *     $ZCC_QUESTION_URL, and nothing else changes.
 */

type Hook = { type: string; command: string };
type HookEntry = { matcher: string; hooks: Hook[] };
type Hooks = Record<string, HookEntry[]>;

function parseHooks(json: string): Hooks {
  return (JSON.parse(json) as { hooks: Hooks }).hooks;
}

/** All command strings across every hook group, flattened. */
function allCommands(hooks: Hooks): string[] {
  return Object.values(hooks).flatMap((entries) =>
    entries.flatMap((e) => e.hooks.map((h) => h.command))
  );
}

// A representative interactive launch: stop + notify + firstPrompt + subagents,
// which is what an autoclose/scheduled-off claude tab emits today.
const baseOpts = {
  stop: true,
  notify: true,
  firstPrompt: true,
  subagents: true
} as const;

describe('buildHookSettings — AskUserQuestion gate', () => {
  describe('flag OFF', () => {
    it('emits identical hooks whether `question` is omitted or explicitly false', () => {
      const omitted = buildHookSettings({ ...baseOpts });
      const explicitFalse = buildHookSettings({ ...baseOpts, question: false });
      expect(explicitFalse).toBe(omitted);
    });

    it('registers no /hook/question forwarding hook', () => {
      const hooks = parseHooks(buildHookSettings({ ...baseOpts, question: false }));
      expect(allCommands(hooks).some((c) => c.includes('ZCC_QUESTION_URL'))).toBe(false);
    });

    it('leaves the notify blocked/unblocked entries unchanged', () => {
      const hooks = parseHooks(buildHookSettings({ ...baseOpts, question: false }));
      // Notify's AskUserQuestion PreToolUse entry pings /blocked, discards stdin.
      const askEntry = hooks.PreToolUse.find((e) => e.matcher === 'AskUserQuestion');
      expect(askEntry).toBeDefined();
      expect(askEntry!.hooks[0].command).toContain('$ZCC_NOTIFY_URL/blocked');
      expect(askEntry!.hooks[0].command).not.toContain('ZCC_QUESTION_URL');
      // PostToolUse AskUserQuestion pings /unblocked.
      expect(hooks.PostToolUse[0].hooks[0].command).toContain('$ZCC_NOTIFY_URL/unblocked');
      // Notification match-all guards the blocked notification types.
      expect(hooks.Notification[0].hooks[0].command).toContain('$ZCC_NOTIFY_URL/blocked');
    });
  });

  describe('flag ON', () => {
    it('adds exactly one additive PreToolUse hook forwarding to $ZCC_QUESTION_URL', () => {
      const off = parseHooks(buildHookSettings({ ...baseOpts, question: false }));
      const on = parseHooks(buildHookSettings({ ...baseOpts, question: true }));

      // Exactly one more PreToolUse entry than the OFF case.
      expect(on.PreToolUse).toHaveLength(off.PreToolUse.length + 1);

      // The new entries (present ON, absent OFF) are exactly one, scoped to
      // AskUserQuestion, forwarding the body to $ZCC_QUESTION_URL.
      const offCmds = new Set(off.PreToolUse.map((e) => e.hooks[0].command));
      const added = on.PreToolUse.filter((e) => !offCmds.has(e.hooks[0].command));
      expect(added).toHaveLength(1);
      expect(added[0].matcher).toBe('AskUserQuestion');
      expect(added[0].hooks[0].command).toContain('ZCC_QUESTION_URL');
      expect(added[0].hooks[0].command).toContain('--data-binary @-');
      expect(added[0].hooks[0].command).toContain('exit 0');
    });

    it('exactly one command across all hooks references $ZCC_QUESTION_URL', () => {
      const on = parseHooks(buildHookSettings({ ...baseOpts, question: true }));
      const qCmds = allCommands(on).filter((c) => c.includes('ZCC_QUESTION_URL'));
      expect(qCmds).toHaveLength(1);
    });

    it('does not perturb the other hook groups (only PreToolUse changes)', () => {
      const off = parseHooks(buildHookSettings({ ...baseOpts, question: false }));
      const on = parseHooks(buildHookSettings({ ...baseOpts, question: true }));
      for (const key of Object.keys(off)) {
        if (key === 'PreToolUse') continue;
        expect(on[key]).toEqual(off[key]);
      }
      // And the pre-existing PreToolUse entries are preserved verbatim.
      for (const entry of off.PreToolUse) {
        expect(on.PreToolUse).toContainEqual(entry);
      }
    });
  });
});
