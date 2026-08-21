import { useEffect } from 'react';
import { create } from 'zustand';

/**
 * A tiny, cwd-keyed cache of git branch/ahead-behind info, shared by every
 * surface that wants to show "which branch is this agent on" — the board cards,
 * the agent-inspector modal, and the List-view monitor's detail panel.
 *
 * Why cwd-keyed and not project-keyed (the store's `gitStatus` cache is keyed by
 * project id): an agent can run in a linked git *worktree* whose branch differs
 * from the project root's, so the honest answer is the branch of the session's
 * OWN working directory. That's the same source the modal's "Changes" tab reads
 * (`AgentDiffPanel` → `git.status(cwd)`).
 *
 * The cache dedupes and throttles: many cards sharing a cwd cause ONE `git`
 * call, and a fresh entry is reused for {@link GIT_INFO_TTL_MS} before we shell
 * `git` again. Reads run off the render path (an effect), so a board full of
 * agents never blocks paint. Remote (SSH) projects have no local git, so callers
 * skip them — there's nothing to shell.
 */

export interface GitCwdInfo {
  /** Short branch name (no `refs/heads/`), null when detached / not a repo. */
  branch: string | null;
  /** Detached HEAD — no branch name, but still a valid checkout. */
  detached: boolean;
  ahead: number;
  behind: number;
  /** Renderer clock ms of the last successful read (0 = never). */
  fetchedAt: number;
  loading: boolean;
  /** The cwd isn't a git repo (status returned null / bare). */
  notRepo: boolean;
}

interface GitInfoState {
  byCwd: Record<string, GitCwdInfo>;
  setItem: (cwd: string, patch: Partial<GitCwdInfo>) => void;
}

export const useGitInfo = create<GitInfoState>((set) => ({
  byCwd: {},
  setItem: (cwd, patch) =>
    set((s) => {
      const prev = s.byCwd[cwd] ?? {
        branch: null,
        detached: false,
        ahead: 0,
        behind: 0,
        fetchedAt: 0,
        loading: false,
        notRepo: false
      };
      return { byCwd: { ...s.byCwd, [cwd]: { ...prev, ...patch } } };
    })
}));

/** Reuse a cached read for this long before shelling `git` again. Branch rarely
 *  changes, so a gentle TTL keeps subprocess churn near zero. */
export const GIT_INFO_TTL_MS = 30_000;

/**
 * Refresh one cwd's git info, deduped + throttled. No-ops when a read is already
 * in flight or the cached entry is younger than {@link GIT_INFO_TTL_MS}. Never
 * throws — a non-repo / permission error resolves to `notRepo`.
 */
export function refreshGitInfo(cwd: string): void {
  if (!cwd) return;
  const cur = useGitInfo.getState().byCwd[cwd];
  if (cur?.loading) return;
  if (cur?.fetchedAt && Date.now() - cur.fetchedAt < GIT_INFO_TTL_MS) return;
  const { setItem } = useGitInfo.getState();
  setItem(cwd, { loading: true });
  void window.cc.git
    .status(cwd)
    .then((st) => {
      setItem(cwd, {
        branch: st?.branch ?? null,
        detached: st?.detached ?? false,
        ahead: st?.ahead ?? 0,
        behind: st?.behind ?? 0,
        notRepo: !st,
        loading: false,
        fetchedAt: Date.now()
      });
    })
    .catch(() => {
      setItem(cwd, {
        branch: null,
        detached: false,
        ahead: 0,
        behind: 0,
        notRepo: true,
        loading: false,
        fetchedAt: Date.now()
      });
    });
}

/**
 * Subscribe one surface to a cwd's branch info: fetches on mount and refreshes
 * on a gentle interval while mounted (the TTL guard makes each call a cheap
 * no-op unless the cache went stale). Skips remote projects entirely — there's
 * no local git to read. Returns the cached entry (null until the first read).
 */
export function useSessionGit(cwd: string, isRemote: boolean): GitCwdInfo | null {
  const info = useGitInfo((s) => s.byCwd[cwd]);
  useEffect(() => {
    if (isRemote || !cwd) return;
    refreshGitInfo(cwd);
    const id = setInterval(() => refreshGitInfo(cwd), GIT_INFO_TTL_MS);
    return () => clearInterval(id);
  }, [cwd, isRemote]);
  return info ?? null;
}
