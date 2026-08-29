import { product } from '../../lib/product-client.js';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Plus, X, ArrowLeft, AppWindow } from 'lucide-react';
import { useData, useUi, useAgentStatus, useIdleTriage, usePersonas } from '../../store.js';
import type { Project, LaunchProfileId, Persona, TerminalSession } from '@zana-ai/zcc-domain/product';
import { profileLabel } from '@zana-ai/zcc-domain/launch-provider';
import { composerProjectLabel } from '../composer-project-default.js';
import { profileIcon, personaIcon } from '../../lib/profileIcon.js';
import { bucketSessions } from '../../lib/sessionBuckets.js';
import { getScopedProjectId } from '../../lib/windowScope.js';
import { ListPaneResizer } from '../ListPaneResizer.js';
import { SectionHeader } from './SectionHeader.js';
import { AgentStatusDot } from './AgentStatusDot.js';
import { ProjectRollupDot } from './ProjectRollupDot.js';
import { AppPageHeader } from '../AppPageHeader.js';
import { useAgentCardActions, AgentCardMenu, clampMenuAnchor } from '../agentCardActions.js';
import { PromptModal } from '../PromptModal.js';
import type { AgentCard } from '../AgentBoard.js';

/** Quick-launch profiles offered by the focus-view "+" dropdown, in order. */
const FOCUS_NEW_PROFILES: { profile: LaunchProfileId; label: string }[] = [
  { profile: 'claude', label: profileLabel('claude') },
  { profile: 'claude-yolo', label: profileLabel('claude-yolo') },
  { profile: 'shell', label: profileLabel('shell') }
];

/**
 * Focus mode: the column drills into a single project, showing all its sessions
 * grouped by live status bucket. Replaces the project list while
 * `focusedProjectId` is set. Renderer-only — consumes Sprint-1 store + buckets.
 */
export function ProjectFocusView({ project }: { project: Project }) {
  const exitProjectFocus = useUi((s) => s.exitProjectFocus);
  const selectProject = useUi((s) => s.selectProject);
  const selectTab = useUi((s) => s.selectTab);
  const setWorkspaceMode = useUi((s) => s.setWorkspaceMode);
  const selectedTabId = useUi((s) => s.selectedTabId);
  const selectedId = useUi((s) => s.selectedProjectId);
  const collapsedSections = useUi((s) => s.collapsedSections);
  const unread = useUi((s) => s.unread);
  const createTerminal = useData((s) => s.createTerminal);
  const closeTerminal = useData((s) => s.closeTerminal);
  const restoreTerminal = useData((s) => s.restoreTerminal);
  const renameTerminal = useData((s) => s.renameTerminal);
  const {
    menu: agentMenu,
    setMenu: setAgentMenu,
    actions: agentActions,
    rename: agentRename,
    closeRename: closeAgentRename,
    submitRename: submitAgentRename
  } = useAgentCardActions();

  const sessionToCard = (session: TerminalSession): AgentCard => ({
    session,
    state: useAgentStatus.getState().byId[session.id] ?? 'unknown',
    projectId: project.id,
    projectName: composerProjectLabel(project),
    projectColor: project.color,
    triage: useIdleTriage.getState().byId[session.id]
  });

  const openAgentCardMenu = (e: MouseEvent, session: TerminalSession) => {
    e.preventDefault();
    e.stopPropagation();
    setAgentMenu({ card: sessionToCard(session), ...clampMenuAnchor(e) });
  };

  const pickAgent = (card: AgentCard) => {
    selectProject(card.projectId);
    if (card.session.headless && card.session.status !== 'exited') {
      void restoreTerminal(card.session.id, card.projectId);
    } else {
      selectTab(card.projectId, card.session.id);
    }
    setWorkspaceMode(card.projectId, 'terminals');
  };

  // Inline rename of an agent row, mirroring the tab strip's double-click→edit.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const startRename = (id: string, title: string) => {
    setRenamingId(id);
    setRenameValue(title);
  };
  const commitRename = () => {
    if (renamingId) {
      const v = renameValue.trim();
      if (v) renameTerminal(project.id, renamingId, v);
    }
    setRenamingId(null);
  };

  // Raw, stable slices only — never call bucketSessions() inside an inline
  // selector (it returns a fresh array → infinite render loop, see
  // zustand-selector-stable-ref memory). Subscribe to the project's session
  // list and the whole agent-status map as primitives/stable refs, then derive
  // the buckets in a useMemo keyed on them.
  const sessions = useData((s) => s.terminals[project.id]);
  const agentById = useAgentStatus((s) => s.byId);
  // Personas offered in the "+" menu: builtin + global + this project's own.
  const allPersonas = usePersonas((s) => s.personas);
  const personas = allPersonas.filter(
    (p) =>
      typeof p.source !== 'object' ||
      p.source === null ||
      !('projectId' in p.source) ||
      p.source.projectId === project.id
  );

  const buckets = useMemo(() => {
    // Pass the FULL list (visible + hidden). Hidden tabs (closed but still
    // running) classify by their real status — clicking a row re-opens them.
    // Scheduler jobs are filtered out inside bucketSessions.
    if (!sessions || sessions.length === 0) return [];
    return bucketSessions(sessions, agentById);
  }, [sessions, agentById]);

  const activeTab = selectedId === project.id ? selectedTabId[project.id] : undefined;
  const totalSessions = (sessions ?? []).length;

  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const newMenuRef = useRef<HTMLDivElement | null>(null);

  const handleNew = (profile: LaunchProfileId, persona?: Persona) => {
    setNewMenuOpen(false);
    // A persona's baseProfile (if any) wins over the menu's profile, mirroring
    // the launcher; the main process layers the persona's flags on top.
    const launchProfile = persona?.baseProfile ?? profile;
    void createTerminal(project.id, launchProfile, 80, 24, { personaId: persona?.id }).then(
      (session) => {
        if (session) {
          selectProject(project.id);
          selectTab(project.id, session.id);
        }
      }
    );
  };

  // Close the "+" launch menu on any outside click or Escape.
  useEffect(() => {
    if (!newMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (newMenuRef.current?.contains(e.target as Node)) return;
      setNewMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNewMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [newMenuOpen]);

  // In a per-project window there's nowhere to go "back" to — the rail is
  // permanently this one project — so the exit-focus affordance is hidden.
  const scopedProjectId = getScopedProjectId();

  return (
    <section className="list-pane">
      <AppPageHeader
        className="list-header"
        actions={!scopedProjectId ? (
          <button
            type="button"
            className="focus-popout"
            onClick={() => void product.windows.openProject(project.id)}
            title="Open this project in a new window"
            aria-label="Open this project in a new window"
          >
            <AppWindow size={14} />
          </button>
        ) : undefined}
      >
        {!scopedProjectId ? (
          <button
            type="button"
            className="focus-back"
            onClick={() => exitProjectFocus()}
            title="Back to all projects"
          >
            <ArrowLeft size={14} />
            <span>All projects</span>
          </button>
        ) : null}
      </AppPageHeader>
      <div className="focus-project-header">
        <span
          className="project-dot"
          style={project.color ? { background: project.color } : undefined}
        />
        <span className="focus-project-name" title={project.path}>
          {composerProjectLabel(project)}
        </span>
        <ProjectRollupDot projectId={project.id} />
        <div className="focus-new" ref={newMenuRef}>
          <button
            type="button"
            className="focus-new-btn"
            aria-label="New session"
            aria-haspopup="menu"
            aria-expanded={newMenuOpen}
            title="New session"
            onClick={() => setNewMenuOpen((v) => !v)}
          >
            <Plus size={14} />
          </button>
          {newMenuOpen && (
            <div className="focus-new-menu" role="menu">
              {FOCUS_NEW_PROFILES.map(({ profile, label }) => (
                <button
                  key={profile}
                  type="button"
                  role="menuitem"
                  className="focus-new-menu-item"
                  onClick={() => handleNew(profile)}
                >
                  <span className={`tab-profile-icon profile-${profile}`} aria-hidden="true">
                    {profileIcon(profile)}
                  </span>
                  <span>{label}</span>
                </button>
              ))}
              {personas.length > 0 && (
                <>
                  <div className="focus-new-menu-label" role="presentation">
                    Personas
                  </div>
                  {personas.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="menuitem"
                      className="focus-new-menu-item"
                      title={p.description ?? p.name}
                      onClick={() => handleNew(p.baseProfile ?? 'claude', p)}
                    >
                      <span className="tab-profile-icon" aria-hidden="true">
                        {personaIcon(p)}
                      </span>
                      <span>{p.name}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="list-body">
        {totalSessions === 0 ? (
          <div className="list-empty">
            No sessions.
            <br />
            Click <strong>+</strong> to start one.
          </div>
        ) : (
          buckets.map((bucket) => {
            const sectionKey = `focus:${project.id}:${bucket.id}`;
            const collapsed = !!collapsedSections[sectionKey];
            return (
              <div key={bucket.id} className="focus-bucket">
                <SectionHeader
                  label={bucket.label}
                  sectionKey={sectionKey}
                  action={<span className="list-count-badge">{bucket.sessions.length}</span>}
                />
                {!collapsed && (
                  <div className="project-terminals" role="list">
                    {bucket.sessions.map((t) => {
                      const exited = t.status === 'exited';
                      const bad = exited && (t.exitCode ?? 0) !== 0;
                      const isUnread = !!unread[t.id] && activeTab !== t.id;
                      // A "hidden" session is one closed out of the tab strip
                      // but still alive (headless). Clicking its row re-opens
                      // it as a tab; a visible session's row just selects it.
                      const hidden = !!t.headless && !exited;
                      return (
                        <div
                          key={t.id}
                          role="listitem"
                          className={`project-terminal-row ${activeTab === t.id ? 'active' : ''} ${
                            exited ? 'exited' : ''
                          } ${bad ? 'exited-bad' : ''} ${isUnread ? 'unread' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            // Surface the agent's live terminal: select it (or
                            // restore it from background) AND switch the
                            // workspace to Terminals mode, so a board/explorer
                            // view doesn't keep covering it.
                            selectProject(project.id);
                            if (hidden) {
                              void restoreTerminal(t.id, project.id);
                            } else {
                              selectTab(project.id, t.id);
                            }
                            setWorkspaceMode(project.id, 'terminals');
                          }}
                          onContextMenu={(e) => openAgentCardMenu(e, t)}
                          aria-label={isUnread ? `${t.title} · unread output` : undefined}
                          title={
                            exited && t.exitCode != null
                              ? `${t.title} · exited (code ${t.exitCode})`
                              : isUnread
                                ? `${t.title} · unread output`
                                : hidden
                                  ? `${t.title} · click to open`
                                  : t.title
                          }
                        >
                          <span
                            className={`tab-profile-icon profile-${t.profile}`}
                            aria-hidden="true"
                          >
                            {profileIcon(t.profile)}
                          </span>
                          {renamingId === t.id ? (
                            <input
                              className="project-terminal-rename"
                              value={renameValue}
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onBlur={commitRename}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  commitRename();
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  setRenamingId(null);
                                }
                              }}
                            />
                          ) : (
                            <span
                              className="project-terminal-name"
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                startRename(t.id, t.title);
                              }}
                              title="Double-click to rename"
                            >
                              {t.title}
                            </span>
                          )}
                          <AgentStatusDot sessionId={t.id} />
                          {bad && (
                            <span
                              className="project-terminal-exit-bad"
                              aria-label={`Exit code ${t.exitCode}`}
                            >
                              ✗{t.exitCode}
                            </span>
                          )}
                          <button
                            type="button"
                            className="project-terminal-close"
                            aria-label={exited ? `Dismiss ${t.title}` : `Delete ${t.title}`}
                            title={exited ? 'Dismiss' : 'Delete (ends the process)'}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (
                                !exited &&
                                !window.confirm(
                                  `Delete "${t.title}"? The process will be terminated.`
                                )
                              ) {
                                return;
                              }
                              void closeTerminal(t.id, project.id);
                            }}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      <ListPaneResizer />
      {agentMenu && (
        <AgentCardMenu
          menu={agentMenu}
          setMenu={setAgentMenu}
          actions={agentActions}
          onPick={pickAgent}
        />
      )}
      {agentRename && (
        <PromptModal
          title="Rename agent"
          label="Name"
          initialValue={agentRename.card.session.title}
          confirmLabel="Rename"
          onSubmit={(v) => submitAgentRename(agentRename.card, v)}
          onClose={closeAgentRename}
        />
      )}
    </section>
  );
}
