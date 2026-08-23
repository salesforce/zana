import type { LaunchProfileId } from '@zana-ai/zcc-domain/product';
import { isClaudeProfile, isCodexProfile, isOpenCodeProfile } from '@zana-ai/zcc-domain/launch-provider';

/**
 * Restart helpers for an already-open tab.
 *
 * Surviving tmux sessions reattach via main's restore-capability ledger.
 * This module only folds resume flags so an explicit Restart does not replay
 * the opening prompt or collapse sibling conversations onto `--continue`.
 */

/**
 * The launcher (AgentLauncher) and the scheduler/palette path
 * in main seed a Claude tab's OPENING PROMPT as a positional argv element inside
 * `extraArgs` (preceded by a `--` end-of-options marker when the prompt starts
 * with a dash). That's correct for the FIRST launch — it's the agent's first
 * turn — but it must NEVER be replayed on restart: a relaunch should resume the
 * conversation, not re-issue the original request. Left in, restart runs e.g.
 * `claude "Look at the repo…" --continue`, which Claude treats as a fresh
 * first turn (auto-titling the tab from the prompt) instead of silently
 * resuming — so one conversation forks into a new spawn.
 *
 * The launchers append the prompt as the TRAILING positional (optionally
 * preceded by a `--` marker when the prompt starts with a dash). A dirty
 * extraArgs that already has a resume flag appended AFTER the prompt (e.g.
 * `["<prompt>", "--continue"]`) is also healed: the prompt is no longer last.
 * The strip therefore runs in two steps:
 *
 *   1. Peel any trailing resume suffix we know withResumeArgs adds — a boolean
 *      `--continue`/`-c` (or `=`-joined), or a value pair `--resume <uuid>` /
 *      `--session-id <uuid>` (or `=`-joined) — setting it aside to re-attach.
 *   2. In what remains, the opening prompt is the trailing bare positional
 *      (launchers append it after any caller flags). Drop it, plus a `--` marker
 *      guarding it. A trailing bare token whose PRECEDING token is a flag is
 *      treated as that flag's value (e.g. `opus` in `--model opus`) and kept —
 *      so we never corrupt a value-taking flag we don't know about.
 *
 * Re-attach the peeled suffix and return; undefined when nothing survives. Pure.
 */
const BOOLEAN_RESUME = new Set(['--continue', '-c']);
const VALUE_RESUME = new Set(['--resume', '-r', '--session-id']);
export function stripOpeningPrompt(extraArgs: string[] | undefined): string[] | undefined {
  if (!extraArgs || extraArgs.length === 0) return extraArgs;
  const withoutOpenCodePrompt: string[] = [];
  for (let index = 0; index < extraArgs.length; index += 1) {
    if (extraArgs[index] === '--prompt') {
      index += 1;
      continue;
    }
    if (extraArgs[index].startsWith('--prompt=')) continue;
    withoutOpenCodePrompt.push(extraArgs[index]);
  }
  // 1. Peel the trailing resume suffix (right-to-left) so the prompt, if it was
  //    pushed left by a prior restore's appended flag, becomes findable again.
  const head = withoutOpenCodePrompt;
  const suffix: string[] = [];
  for (;;) {
    const n = head.length;
    if (n === 0) break;
    const last = head[n - 1];
    if (BOOLEAN_RESUME.has(last) || /^(?:--continue|--resume|--session-id)=/.test(last)) {
      suffix.unshift(head.pop() as string);
      continue;
    }
    const prev = n >= 2 ? head[n - 2] : undefined;
    if (prev && VALUE_RESUME.has(prev) && !last.startsWith('-')) {
      suffix.unshift(head.pop() as string); // the <uuid> value
      suffix.unshift(head.pop() as string); // the --resume / --session-id flag
      continue;
    }
    break;
  }
  // 2. Strip the trailing opening prompt from the head.
  if (head.length > 0) {
    const last = head[head.length - 1];
    const prev = head.length >= 2 ? head[head.length - 2] : undefined;
    if (prev === '--') {
      head.length -= 2; // drop the `--` marker and the dash-prefixed prompt
    } else if (!last.startsWith('-') && !(prev && prev.startsWith('-'))) {
      // A bare trailing token NOT preceded by a flag is the opening prompt.
      // (Preceded by a flag → it's that flag's value; leave it alone.)
      head.length -= 1;
    }
  }
  const out = [...head, ...suffix];
  return out.length > 0 ? out : undefined;
}

/**
 * Whether `--continue` should be appended for this profile. Exposed for tests
 * and so restart and any future caller agree on the rule.
 */
export function shouldResumeConversation(profile: LaunchProfileId): boolean {
  return isClaudeProfile(profile);
}

/**
 * Build a claude tab's resume args so it reopens its PRIOR conversation.
 *
 * Preferred path: when we captured the tab's own transcript id at first launch
 * (`claudeSessionId`), resume THAT exact conversation with `--resume <id>`.
 * This is what stops N tabs in one cwd from all collapsing onto the single
 * most-recent conversation — each tab owns a distinct id.
 *
 * Fallback: a tab with no captured id appends the blunt `--continue` — still
 * better than a cold tab, just can't distinguish between sibling tabs.
 *
 * Idempotent: never adds a second resume/continue flag, and leaves a tab that
 * already carries an explicit `--resume <id>` (resume-picker tabs) untouched so
 * we don't fight an explicit session pin. Returns a new array; pure.
 */
export function withResumeArgs(
  profile: LaunchProfileId,
  extraArgs: string[] | undefined,
  claudeSessionId?: string
): string[] | undefined {
  if (!shouldResumeConversation(profile)) return extraArgs;
  const args = extraArgs ?? [];
  // Already resuming/continuing (space- or `=`-joined, short or long form) —
  // don't add a conflicting flag, and don't override an explicit --resume <id>.
  const alreadyResumes = args.some(
    (a) =>
      a === '--continue' ||
      a === '-c' ||
      a === '--resume' ||
      a === '-r' ||
      a.startsWith('--continue=') ||
      a.startsWith('--resume=')
  );
  if (alreadyResumes) return extraArgs;
  if (claudeSessionId) return [...args, '--resume', claudeSessionId];
  return [...args, '--continue'];
}

/**
 * One place that decides the resume profile/args/id triple for the
 * Codex/OpenCode families, shared by `restartTerminal` so call sites can't
 * drift. Pure.
 */
export function resolveRestartProfile(
  profile: LaunchProfileId,
  cleanArgs: string[] | undefined,
  claudeSessionId: string | undefined,
  codexSessionId: string | undefined,
  openCodeSessionId: string | undefined
): { profile: LaunchProfileId; extraArgs: string[] | undefined; resumeSessionId: string | undefined } {
  const isCodex = isCodexProfile(profile);
  const isOpenCode = isOpenCodeProfile(profile);
  return {
    profile: isCodex ? 'codex-resume' : isOpenCode ? 'opencode-resume' : profile,
    extraArgs: isCodex || isOpenCode ? cleanArgs : withResumeArgs(profile, cleanArgs, claudeSessionId),
    resumeSessionId: isCodex ? codexSessionId : isOpenCode ? openCodeSessionId : undefined
  };
}
