import type { LaunchProfileId, TerminalSession, Project, SessionWorktree } from '@zana-ai/zcc-domain/product';
import { isClaudeProfile, isCodexProfile, isOpenCodeProfile } from '@zana-ai/zcc-domain/launch-provider';

/**
 * Silent session restore across app launches.
 *
 * The app kills every pty client on quit. Tmux-backed processes survive and are
 * reattached; other remembered tabs are re-spawned on next launch. We remember
 * visible tabs plus lifecycle-managed Team workers — and, for
 * Claude tabs, relaunch with `--continue` so the agent picks up its most recent
 * conversation in that directory (Claude CLI persists transcripts to disk;
 * `--continue` is non-interactive and silently starts fresh when there's no
 * prior conversation, so restore never errors).
 *
 * This module is pure: snapshot shape + the planning logic. The store owns the
 * localStorage I/O and the actual createTerminal calls, so this stays unit-
 * testable without a DOM or IPC.
 */

const STORAGE_KEY = 'zcc.openSessions';

/** One remembered tab. Mirrors ClosedTab — enough to reopen faithfully. */
export interface SessionSnapshot {
  /** Opaque main-issued launch capability. No launch routing is trusted from this snapshot. */
  restoreCapabilityId?: string;
  profile: LaunchProfileId;
  title: string;
  extraArgs?: string[];
  cwd?: string;
  worktree?: SessionWorktree;
  pinned?: boolean;
  /** Preserve a manual rename across relaunch so the restored tab keeps its
   *  user-chosen name and the OSC auto-rename stays suppressed. */
  titleLocked?: boolean;
  /** Preserve the auto-title pins across relaunch. Without these, a restored
   *  tab carries its name but neither pin, so the FIRST post-restore OSC
   *  idle-title re-renames it — the "tabs got renamed on restore" bug. Carrying
   *  them keeps the established name stable. */
  autoTitledByLlm?: boolean;
  autoTitledByOsc?: boolean;
  /** This tab's own Claude transcript id (minted at first launch via
   *  `--session-id`). When present, restore resumes THIS conversation
   *  (`--resume <id>`) instead of the cwd's most-recent one — so multiple
   *  claude tabs in one project each reopen their own conversation. */
  claudeSessionId?: string;
  /** This tab's own Codex rollout id, DETECTED after first launch (codex mints
   *  it itself; we read it from the rollout file — see TerminalSession.codexSessionId).
   *  When present, restore resumes THIS conversation via the `codex-resume`
   *  profile + `resumeSessionId` (`codex resume <id>`) — codex's resume is a
   *  POSITIONAL subcommand, so it CANNOT ride `extraArgs` like claude's flag. */
  codexSessionId?: string;
  /** This tab's own OpenCode session id, DETECTED after first launch (OpenCode
   *  mints it itself; we read it back via `opencode session list` — see
   *  TerminalSession.openCodeSessionId). When present, restore resumes THIS
   *  exact conversation via the `opencode-resume` profile + `resumeSessionId`
   *  (`opencode --session <id>`) — carried out-of-band like Codex's id, for
   *  the same reason: OpenCode's id isn't known until after spawn. */
  openCodeSessionId?: string;
}

/** Per-project map of remembered tabs, in tab order. */
export type SessionSnapshotMap = Record<string, SessionSnapshot[]>;

/**
 * The launcher (AgentLauncher) and the scheduler/palette path
 * in main seed a Claude tab's OPENING PROMPT as a positional argv element inside
 * `extraArgs` (preceded by a `--` end-of-options marker when the prompt starts
 * with a dash). That's correct for the FIRST launch — it's the agent's first
 * turn — but it must NEVER be replayed on restore: a relaunch should resume the
 * conversation, not re-issue the original request. Left in, restore runs e.g.
 * `claude "Look at the repo…" --continue`, which Claude treats as a fresh
 * first turn (auto-titling the tab from the prompt) instead of silently
 * resuming — so one conversation forks into a new spawn on every relaunch.
 *
 * The launchers append the prompt as the TRAILING positional (optionally
 * preceded by a `--` marker when the prompt starts with a dash). But a snapshot
 * that already survived one bad restore has the resume flag withResumeArgs
 * appended AFTER the prompt (e.g. `["<prompt>", "--continue"]` — a real shape
 * found on disk), so the prompt is no longer last. The strip therefore runs in
 * two steps:
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
 * Build the snapshot for one project's sessions. Visible local tabs and
 * lifecycle-managed Team workers are remembered. Other headless/background
 * sessions and remote (ssh) projects are skipped (their silent re-spawn is
 * surprising — a stale tunnel could hang).
 * The caller passes already-visible tabs; we just project them to the snapshot
 * shape. Pure.
 */
export function snapshotTabs(tabs: TerminalSession[]): SessionSnapshot[] {
  return tabs
    .filter((t) => (!t.headless || t.cohort?.role === 'worker') && t.status !== 'exited')
    .map((t) => ({
      profile: t.profile,
      restoreCapabilityId: t.restoreCapabilityId,
      title: t.title,
      // Strip the opening prompt: a restored tab must resume the conversation,
      // not re-issue the original request (see stripOpeningPrompt).
      extraArgs: stripOpeningPrompt(t.extraArgs),
      cwd: t.cwd,
      worktree: t.worktree,
      pinned: t.pinned,
      titleLocked: t.titleLocked,
      autoTitledByLlm: t.autoTitledByLlm,
      autoTitledByOsc: t.autoTitledByOsc,
      claudeSessionId: t.claudeSessionId,
      codexSessionId: t.codexSessionId,
      openCodeSessionId: t.openCodeSessionId
    }));
}

/**
 * Whether `--continue` should be appended for this profile. Exposed for tests
 * and so the planner and any future caller agree on the rule.
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
 * Fallback: a legacy snapshot (taken before we minted ids) has no id, so we
 * append the blunt `--continue` — still better than a cold tab, just can't
 * distinguish between sibling tabs.
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

/** One tab to spawn during restore: the project + the args to launch with. */
export interface RestorePlanItem {
  restoreCapabilityId?: string;
  projectId: string;
  profile: LaunchProfileId;
  title: string;
  cwd?: string;
  worktree?: SessionWorktree;
  pinned?: boolean;
  /** Preserved manual-rename lock; re-applied so the restored tab keeps its name. */
  titleLocked?: boolean;
  /** Preserved auto-title pins; re-applied so a restored auto-named tab isn't
   *  re-renamed by the first post-restore OSC idle-title. */
  autoTitledByLlm?: boolean;
  autoTitledByOsc?: boolean;
  /** extraArgs with the resume flag (`--resume <id>`, or legacy `--continue`)
   *  already folded in for claude profiles. */
  extraArgs?: string[];
  /** Codex/OpenCode exact-session resume target. Codex's resume is a POSITIONAL
   *  subcommand (`codex resume <id>`) and OpenCode's is a flag (`--session <id>`)
   *  — both are carried out-of-band rather than folded into `extraArgs`, and
   *  passed to createTerminal as `resumeSessionId`. Set only when
   *  `profile === 'codex-resume'` or `profile === 'opencode-resume'`. */
  resumeSessionId?: string;
}

/**
 * One place that decides the resume profile/args/id triple for the
 * Codex/OpenCode families, shared by `planRestore` and `restartTerminal` so
 * the two call sites can't drift out of sync. Pure.
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

/**
 * Decide what to spawn on launch. For each remembered tab we emit a plan item,
 * EXCEPT:
 *   - projects that no longer exist (deleted while the app was closed),
 *   - remote projects (ssh) — excluded in v1,
 *   - projects that already have live sessions — a renderer reload (not a fresh
 *     launch) re-hydrates live ptys from main, and we must not double-spawn on
 *     top of them.
 *
 * Pure: takes the snapshot + current world, returns the spawn list.
 */
export function planRestore(
  snapshot: SessionSnapshotMap,
  projects: Project[],
  liveTerminals: Record<string, TerminalSession[]>,
  skipProjectIds?: Set<string>
): RestorePlanItem[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const plan: RestorePlanItem[] = [];
  for (const [projectId, tabs] of Object.entries(snapshot)) {
    const project = byId.get(projectId);
    if (!project) continue; // project deleted while closed
    if (project.remote) continue; // remote tabs not restored in v1
    if (skipProjectIds?.has(projectId)) continue; // hydration failed — can't tell if live
    const live = liveTerminals[projectId] ?? [];
    if (live.length > 0) continue; // already alive (renderer reload) — don't dupe
    for (const tab of tabs) {
      // Heal snapshots written before snapshotTabs stripped the opening prompt:
      // strip again here so an existing dirty snapshot on disk doesn't replay
      // the original request as a fresh first turn on this launch.
      const cleanArgs = stripOpeningPrompt(tab.extraArgs);
      // Codex/OpenCode resume via an out-of-band id rather than extraArgs (see
      // resolveRestartProfile) — with no captured id, Codex still becomes
      // `codex-resume` (→ `resume --last`, the cwd's newest session), the codex
      // twin of claude's blunt `--continue` fallback; OpenCode falls back the
      // same way to `--continue`.
      const resolved = resolveRestartProfile(
        tab.profile,
        cleanArgs,
        tab.claudeSessionId,
        tab.codexSessionId,
        tab.openCodeSessionId
      );
      plan.push({
        restoreCapabilityId: tab.restoreCapabilityId,
        projectId,
        profile: resolved.profile,
        title: tab.title,
        cwd: tab.cwd,
        worktree: tab.worktree,
        pinned: tab.pinned,
        titleLocked: tab.titleLocked,
        autoTitledByLlm: tab.autoTitledByLlm,
        autoTitledByOsc: tab.autoTitledByOsc,
        extraArgs: resolved.extraArgs,
        resumeSessionId: resolved.resumeSessionId
      });
    }
  }
  return plan;
}

/** Read the snapshot from localStorage. Returns {} on any error. */
export function readSnapshot(): SessionSnapshotMap {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as SessionSnapshotMap) : {};
  } catch {
    return {};
  }
}

/** Write the snapshot to localStorage. Swallows quota/serialization errors. */
export function writeSnapshot(snapshot: SessionSnapshotMap): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* quota or serialization failure — losing restore state is non-fatal */
  }
}
