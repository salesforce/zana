import { AlertTriangle, GitBranch } from 'lucide-react';
import { sortProjectsForDisplay, useData, useUi, visibleTerminals } from '../store';
import { profileIcon } from '../util/profileIcon';
import type { Project, TerminalSession } from '@shared/types';

export function OverviewPanel() {
  const projects = useData((s) => s.projects);
  const terminals = useData((s) => s.terminals);
  const gitStatus = useData((s) => s.gitStatus);
  const selectProject = useUi((s) => s.selectProject);
  const selectTab = useUi((s) => s.selectTab);
  const selectedTabId = useUi((s) => s.selectedTabId);

  const sorted = sortProjectsForDisplay(projects);

  const open = (p: Project, sessionId?: string) => {
    selectProject(p.id);
    if (sessionId) {
      selectTab(p.id, sessionId);
      return;
    }
    // No explicit pick: if the project's currently-selected tab is gone or
    // exited, land on a more useful default — the first running session.
    const list = visibleTerminals(terminals[p.id]);
    const current = list.find((t) => t.id === selectedTabId[p.id]);
    if (current && current.status !== 'exited') return;
    const fallback = list.find((t) => t.status !== 'exited') ?? list[0];
    if (fallback) selectTab(p.id, fallback.id);
  };

  return (
    <main className="overview-panel">
      <div className="overview-inner">
        <header className="overview-header">
          <h2>Workspaces Overview</h2>
          <span className="overview-count">
            {sorted.length} {sorted.length === 1 ? 'workspace' : 'workspaces'}
          </span>
        </header>
        {sorted.length === 0 ? (
          <div className="overview-empty">
            No projects yet. Add one from the Projects sidebar.
          </div>
        ) : (
          <div className="overview-grid">
            {sorted.map((p) => {
              const sessions = visibleTerminals(terminals[p.id]);
              const git = gitStatus[p.id];
              const crashed = sessions.filter(
                (s) => s.status === 'exited' && (s.exitCode ?? 0) !== 0
              ).length;
              return (
                <article
                  key={p.id}
                  className={`overview-card ${crashed > 0 ? 'has-crashed' : ''}`}
                  onClick={() => open(p)}
                >
                  <header className="overview-card-head">
                    <span
                      className="overview-card-dot"
                      style={p.color ? { background: p.color } : undefined}
                    />
                    <div className="overview-card-title">
                      <div className="overview-card-name">{p.name}</div>
                      <div className="overview-card-sub">
                        Active {timeAgo(p.lastActiveAt)}
                      </div>
                    </div>
                    {crashed > 0 && (
                      <span
                        className="overview-card-crashed"
                        title={`${crashed} crashed session${crashed === 1 ? '' : 's'}`}
                      >
                        <AlertTriangle size={12} />
                        {crashed}
                      </span>
                    )}
                  </header>

                  <SessionsBlock
                    sessions={sessions}
                    onPick={(s) => open(p, s.id)}
                  />

                  {git && (git.branch || git.detached) && (
                    <footer className={`overview-card-git ${git.dirty ? 'dirty' : ''}`}>
                      <GitBranch size={11} />
                      <span>{git.detached ? 'detached' : git.branch}</span>
                      {git.ahead > 0 && (
                        <span className="overview-card-git-ab">↑{git.ahead}</span>
                      )}
                      {git.behind > 0 && (
                        <span className="overview-card-git-ab">↓{git.behind}</span>
                      )}
                      {git.dirty && (
                        <span className="overview-card-git-dot" aria-hidden="true">●</span>
                      )}
                    </footer>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

function SessionsBlock({
  sessions,
  onPick
}: {
  sessions: TerminalSession[];
  onPick: (s: TerminalSession) => void;
}) {
  if (sessions.length === 0) {
    return <div className="overview-card-sessions empty">No sessions</div>;
  }
  return (
    <div className="overview-card-sessions">
      <div className="overview-card-label">Sessions · {sessions.length}</div>
      {sessions.map((s) => {
        const exited = s.status === 'exited';
        const bad = exited && (s.exitCode ?? 0) !== 0;
        const statusLabel = exited
          ? bad
            ? `exited ✗${s.exitCode}`
            : 'exited'
          : 'running';
        return (
          <button
            key={s.id}
            type="button"
            className="overview-session-row"
            onClick={(e) => {
              e.stopPropagation();
              onPick(s);
            }}
            title={
              exited && s.exitCode != null
                ? `${s.title} · exited (code ${s.exitCode})`
                : s.title
            }
          >
            <span className={`tab-profile-icon profile-${s.profile}`} aria-hidden="true">
              {profileIcon(s.profile)}
            </span>
            <span className="overview-session-name">{s.title}</span>
            <span
              className={`overview-session-status ${exited ? 'exited' : 'running'} ${
                bad ? 'bad' : ''
              }`}
            >
              {statusLabel}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
