import { useEffect, useMemo } from 'react';
import { Clock, MessagesSquare, Sparkles } from 'lucide-react';
import { useData, useScheduler } from '../store';
import type { ClaudeSessionSummary } from '@shared/types';

interface Props {
  projectId: string;
  onResume: (s: ClaudeSessionSummary) => void;
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Collapse whitespace, drop a truncation ellipsis, lowercase — so a session's
 *  (120-char, possibly `…`-suffixed) first prompt can be prefix-matched against
 *  a schedule's full prompt. */
function normalizePrompt(s: string): string {
  return s.replace(/\s+/g, ' ').trim().replace(/…$/, '').toLowerCase();
}

export function ClaudeSessionsList({ projectId, onResume }: Props) {
  const sessions = useData((s) => s.claudeSessions[projectId]);
  const load = useData((s) => s.loadClaudeSessions);
  // Scheduler-spawned runs write their `.jsonl` into the same Claude projects
  // dir as user sessions, with the schedule's prompt as the first user message
  // — so they'd otherwise clutter the resume list (often as N identical rows).
  // We can't correlate ids (Claude mints its own), so we match on the prompt:
  // any schedule prompt for this project that the session's first prompt is a
  // prefix of marks that session as a scheduled run, and we hide it.
  //
  // Select the raw tasks array (a stable reference between changes) and derive
  // the prompt list in a memo — selecting a freshly-built array here would hand
  // zustand a new snapshot every render and spin an infinite update loop.
  const tasks = useScheduler((s) => s.tasks);
  const scheduledPrompts = useMemo(
    () =>
      tasks
        .filter((t) => t.projectId === projectId && t.prompt)
        .map((t) => normalizePrompt(t.prompt as string)),
    [tasks, projectId]
  );

  useEffect(() => {
    load(projectId);
  }, [projectId, load]);

  const visible = useMemo(() => {
    if (!sessions) return sessions;
    if (scheduledPrompts.length === 0) return sessions;
    return sessions.filter((s) => {
      if (!s.firstUserPrompt) return true;
      const key = normalizePrompt(s.firstUserPrompt);
      if (!key) return true;
      return !scheduledPrompts.some((p) => p.startsWith(key));
    });
  }, [sessions, scheduledPrompts]);

  if (!sessions) return null;
  if (!visible || visible.length === 0) {
    return <div className="sessions-empty">No previous agents in this folder.</div>;
  }

  return (
    <div className="sessions">
      <div className="sessions-title">Agents</div>
      <div className="sessions-list">
        {visible.slice(0, 8).map((s) => (
          <button
            key={s.id}
            className="agents-row session-agent-row"
            onClick={() => onResume(s)}
            title={s.title ?? s.firstUserPrompt ?? 'empty session'}
          >
            <span className="agents-row-icon tab-profile-icon profile-claude">
              <Sparkles size={13} />
            </span>
            <span className="agents-row-text">
              <span className="agents-row-title-line">
                <span className="agents-row-title">
                  {/* Prefer the session's short name (/rename custom-title, else
                      Claude's ai-title); fall back to the opening prompt. */}
                  {s.title ?? s.firstUserPrompt ?? <em className="dim">empty session</em>}
                </span>
              </span>
              <span className="agents-row-meta">
                <span title={new Date(s.lastActiveAt).toLocaleString()}>
                  <Clock size={11} /> {timeAgo(s.lastActiveAt)}
                </span>
                <span>
                  <MessagesSquare size={11} /> {s.messageCount}
                </span>
                <span className="session-id">{s.id.slice(0, 7)}</span>
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
