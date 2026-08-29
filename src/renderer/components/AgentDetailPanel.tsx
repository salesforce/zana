import type { ReactNode } from 'react';
import { PanelRightClose, PanelRightOpen, GitBranch, Server } from 'lucide-react';
import type { AgentState, LaunchProfileId, SessionStats, TerminalSession } from '@shared/types';
import { usePersonas, useData } from '../store';
import { profileIcon, personaIcon } from '../util/profileIcon';
import { providerCapabilities } from '@shared/launch-provider';
import { useSessionGit } from '../util/gitInfo';
import { AgentInsights, useSessionStats } from './AgentInsights';
import { AgentMetadata } from './AgentMetadata';
import { FavoriteStar } from './FavoriteStar';
import { OpenerButtons } from './OpenerButtons';
import { formatDuration } from './AgentBoard';

/**
 * The agent detail panel — identity · facts · transcript insights · actions —
 * shared by the Agent Monitor's right rail (List view) and the agent-inspector
 * modal. Both surfaces show the SAME information about one agent beside its live
 * terminal; this is the one component that renders it, so they can't drift.
 *
 * The panel is collapsible: collapsed, it shrinks to a thin rail (status dot +
 * expand button) so the terminal gets the width. The caller owns the collapsed
 * bit (persisted per-surface in {@link useAgentPanel}) and passes it in, since
 * the monitor collapses a CSS-grid column while the modal collapses a flex
 * child — the layout mechanics live with each caller, only the toggle is shared.
 *
 * Actions differ per surface (the monitor's "Stop" is a non-destructive Ctrl-C;
 * the modal's is a kill), so the caller passes its own action buttons as
 * {@link Props.actions} — the panel just gives them a home at the bottom.
 */

const STATE_LABEL: Record<AgentState, string> = {
  blocked: 'Needs you',
  working: 'Working',
  idle: 'Idle',
  done: 'Done',
  unknown: 'Idle',
  waiting: 'Waiting for model'
};

/** Team membership for the Team fact (monitor board only). */
interface DetailCohort {
  teamName: string;
  role: string;
}

/** Heartbeat opt-in control (modal only). */
interface DetailHeartbeat {
  checked: boolean;
  onToggle: () => void;
}

interface Props {
  session: TerminalSession;
  projectId: string;
  projectName: string;
  projectColor?: string;
  state: AgentState;
  /** Show the owning-project fact (global board + always in the modal). */
  showProject?: boolean;
  /** Team membership → a Team fact. */
  cohort?: DetailCohort | null;
  /** Background/scheduled origin → an Origin fact. */
  background?: boolean;
  /** Heartbeat toggle → a Heartbeat fact (only when the surface offers it). */
  heartbeat?: DetailHeartbeat | null;
  /** Per-surface action buttons, stacked at the panel foot. */
  actions?: ReactNode;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Which surface — drives the root class so each can size/scroll its own way. */
  variant: 'monitor' | 'modal';
  /** Show the icon/title/sub in the panel head. The monitor needs it (no other
   *  title); the modal already has a title bar, so it suppresses the duplicate
   *  and the head carries only the star + collapse control. Default true. */
  showIdentity?: boolean;
  maxFiles?: number;
  maxQueue?: number;
  stats?: SessionStats | null;
}

export function agentDirectoryFacts(
  session: Pick<TerminalSession, 'cwd' | 'worktree'>,
  projectPath: string | undefined
): Array<{ label: string; path: string }> {
  if (session.worktree && projectPath) {
    return [
      { label: 'Project directory', path: projectPath },
      { label: 'Worktree directory', path: session.cwd }
    ];
  }
  return [{ label: 'Directory', path: session.cwd }];
}

/** Transcript capability controls presentation; received stats remain displayable
 * during capability changes or a persisted-session restore. */
export function shouldShowTranscriptInsights(
  profile: LaunchProfileId,
  stats: SessionStats | null
): boolean {
  return providerCapabilities(profile).hasTranscript || stats !== null;
}

export function AgentDetailPanel({
  session: t,
  projectId,
  projectName,
  projectColor,
  state,
  showProject = false,
  cohort,
  background = false,
  heartbeat,
  actions,
  collapsed,
  onToggleCollapse,
  variant,
  showIdentity = true,
  maxFiles,
  maxQueue,
  stats: providedStats
}: Props) {
  const personas = usePersonas((s) => s.personas);
  // The owning project's remote (SSH) descriptor, resolved by id so the callers
  // don't have to thread it through. A remote project has no local git; we show
  // its host as a "Remote" fact instead of a branch.
  const project = useData((s) => s.projects.find((p) => p.id === projectId));
  const remote = project?.remote;
  const isRemote = !!remote;
  // Branch of the SESSION's own cwd (a worktree can differ from the project
  // root). Cwd-keyed, deduped/throttled cache; skipped for remote projects.
  const git = useSessionGit(t.cwd, isRemote);
  // Show a branch fact when the cwd is a real repo: the branch name, or
  // "detached" for a detached HEAD. Null for a non-repo cwd (nothing to show).
  const branchLabel = git && !git.notRepo ? (git.detached ? 'detached' : git.branch) : null;
  const exited = t.status === 'exited';
  // Transcript-derived live stats. Polls while mounted; frozen (read once) for
  // an exited agent.
  const loadedStats = useSessionStats(t.id, projectId, exited, providedStats === undefined);
  const stats = providedStats ?? loadedStats;
  const showInsights = shouldShowTranscriptInsights(t.profile, stats);
  const persona = t.personaId ? personas.find((p) => p.id === t.personaId) : undefined;
  const subtitle = persona?.name ?? t.profile;
  const bad = exited && (t.exitCode ?? 0) !== 0;
  const dur = formatDuration((exited ? t.finishedAt ?? t.createdAt : Date.now()) - t.createdAt);
  const statusLabel = exited ? (bad ? `Exited (code ${t.exitCode})` : 'Exited') : STATE_LABEL[state];
  const directoryFacts = agentDirectoryFacts(t, project?.path);

  if (collapsed) {
    // Thin rail: an expand affordance + a status dot, so the agent's state is
    // still legible at a glance while the terminal owns the width.
    return (
      <aside className={`agent-detail-panel agent-detail-panel--${variant} is-collapsed`}>
        <button
          type="button"
          className="agent-detail-collapse"
          onClick={onToggleCollapse}
          title="Expand details"
          aria-label="Expand details"
          aria-expanded={false}
        >
          <PanelRightOpen size={15} />
        </button>
        {!exited && (
          <span
            className={`tab-agent-dot agent-${state} agent-detail-rail-dot`}
            title={statusLabel}
            aria-hidden="true"
          />
        )}
      </aside>
    );
  }

  return (
    <aside className={`agent-detail-panel agent-detail-panel--${variant}`}>
      <div className={`agent-detail-head ${showIdentity ? '' : 'no-identity'}`}>
        {showIdentity && (
          <>
            <span
              className={`agent-detail-icon tab-profile-icon profile-${t.profile}`}
              style={projectColor ? ({ '--project-color': projectColor } as React.CSSProperties) : undefined}
            >
              {persona ? personaIcon(persona, 15) : profileIcon(t.profile, 15)}
            </span>
            <span className="agent-detail-heading">
              <span style={{ display: 'flex', alignItems: 'center' }}>
                {!!t.cohort?.executionId && (
                  <span className="job-badge" title={`Execution-backed job member (Run ID: ${t.cohort.executionId})`} style={{ margin: 0, marginRight: 5 }}>
                    job
                  </span>
                )}
                <span className="agent-detail-title">{t.title}</span>
              </span>
              <span className="agent-detail-sub">{subtitle}</span>
            </span>
            <FavoriteStar session={t} size={15} className="agent-detail-fav" />
          </>
        )}
        <button
          type="button"
          className="agent-detail-collapse"
          onClick={onToggleCollapse}
          title="Collapse details"
          aria-label="Collapse details"
          aria-expanded
        >
          <PanelRightClose size={15} />
        </button>
      </div>

      <dl className="agent-detail-facts">
        <div className="agent-detail-fact">
          <dt>Status</dt>
          <dd className={`agent-detail-fact-status ${bad ? 'is-bad' : ''}`}>
            {!exited && <span className={`tab-agent-dot agent-${state}`} aria-hidden="true" />}
            {statusLabel}
          </dd>
        </div>
        {showProject && (
          <div className="agent-detail-fact">
            <dt>Project</dt>
            <dd>
              <span
                className="agent-detail-fact-dot"
                style={projectColor ? { background: projectColor } : undefined}
                aria-hidden="true"
              />
              {projectName}
            </dd>
          </div>
        )}
        {isRemote ? (
          <div className="agent-detail-fact">
            <dt>Remote</dt>
            <dd className="agent-detail-fact-remote" title={`SSH host: ${remote!.host}`}>
              <Server size={12} aria-hidden="true" />
              {remote!.user ? `${remote!.user}@${remote!.host}` : remote!.host}
            </dd>
          </div>
        ) : (
          branchLabel && (
            <div className="agent-detail-fact">
              <dt>Branch</dt>
              <dd className="agent-detail-fact-branch" title={`On branch ${branchLabel}`}>
                <GitBranch size={12} aria-hidden="true" />
                <span className="agent-detail-branch-name">{branchLabel}</span>
                {(git!.ahead > 0 || git!.behind > 0) && (
                  <span
                    className="agent-detail-branch-ab"
                    title={`${git!.ahead} ahead, ${git!.behind} behind the upstream`}
                  >
                    {git!.ahead > 0 ? `↑${git!.ahead}` : ''}
                    {git!.behind > 0 ? `↓${git!.behind}` : ''}
                  </span>
                )}
              </dd>
            </div>
          )
        )}
        {t.worktree && (
          <div className="agent-detail-fact">
            <dt>Worktree name</dt>
            <dd title={t.worktree.path}>{t.worktree.branch.replace(/^zcc\//, '')}</dd>
          </div>
        )}
        {persona && (
          <div className="agent-detail-fact">
            <dt>Persona</dt>
            <dd>{persona.name}</dd>
          </div>
        )}
        {heartbeat && (
          <div className="agent-detail-fact">
            <dt>Heartbeat</dt>
            <dd>
              <label
                className="agent-detail-heartbeat"
                title="Nudge this agent to continue when it sits idle."
              >
                <input type="checkbox" checked={heartbeat.checked} onChange={heartbeat.onToggle} />
                <span>{heartbeat.checked ? 'On' : 'Off'}</span>
              </label>
            </dd>
          </div>
        )}
        <div className="agent-detail-fact">
          <dt>{exited ? 'Ran for' : 'Running for'}</dt>
          <dd>{dur}</dd>
        </div>
        {typeof t.pid === 'number' && (
          <div className="agent-detail-fact">
            <dt>PID</dt>
            <dd>{t.pid}</dd>
          </div>
        )}
        {cohort && (
          <div className="agent-detail-fact">
            <dt>Team</dt>
            <dd>
              {cohort.teamName}
              {cohort.role === 'orchestrator' ? ' · orchestrator' : ' · worker'}
            </dd>
          </div>
        )}
        {background && (
          <div className="agent-detail-fact">
            <dt>Origin</dt>
            <dd>{t.scheduled ? 'Scheduled' : 'Background'}</dd>
          </div>
        )}
        {directoryFacts.map((fact) => (
          <div key={fact.label} className="agent-detail-fact agent-detail-fact-cwd" title={fact.path}>
            <dt>{fact.label}</dt>
            <dd>{fact.path}</dd>
            {/* Openers act on the LOCAL filesystem — a remote (SSH) cwd isn't
                reachable by Finder/editors here, so offer them only for local. */}
            {!isRemote && <OpenerButtons path={fact.path} className="agent-detail-openers" />}
          </div>
        ))}
      </dl>

      {showInsights && (
        <div className="agent-detail-insights">
          <AgentInsights stats={stats} maxFiles={maxFiles} maxQueue={maxQueue} />
        </div>
      )}

      <AgentMetadata metadata={t.metadata} />

      {actions && <div className="agent-detail-actions">{actions}</div>}
    </aside>
  );
}
