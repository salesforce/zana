import { product } from '../lib/product-client.js';
import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { Terminal as TerminalIcon } from 'lucide-react';
import type {
  Project,
  TerminalSession
} from '@zana-ai/zcc-domain/product';
import { useData, useTeams } from '../store.js';
import { profileIcon } from '../lib/profileIcon.js';
import { AutonomousTeamComposer } from './AutonomousTeamComposer.js';
import { ThreadCommandComposer } from './ThreadCommandComposer.js';
import { LegacyAgentHomeComposer } from './LegacyAgentHomeComposer.js';
import { LaunchModeSegmented, type LaunchMode } from './LaunchModeSegmented.js';
import { AgentConversationHistory } from './AgentConversationHistory.js';
import { titleFromPrompt } from '../lib/promptTitle.js';
import { useDialogFocusTrap } from '../hooks/useDialogFocusTrap.js';

/**
 * The one agent launcher. The user types an instruction, picks a Claude profile
 * (claude / claude --yolo) and an optional persona or framework primer, then
 * launches an agent seeded with that first prompt. It renders in two modes from
 * a SINGLE component so the two surfaces can't drift (this used to be two
 * siblings — `QuickAgentLauncher` and `LaunchPanel`):
 *
 *   - **Scratch / global mode** (`project` omitted): a one-off Quick Agent
 *     anchored to the built-in `~/zcc-workspace` scratch project. Adds a project
 *     picker (so the global board's "+" can start an agent in ANY project),
 *     editable starter-prompt chips, and scratch subfolder isolation. Opened
 *     from the Agents view / global board.
 *   - **Project mode** (`project` set): pinned to one registered project — no
 *     picker, no chips. Instead surfaces the project-only affordances: a
 *     resumable-conversations list, a background-session tray, and a
 *     default-persona star. Opened from a project's Agents board "New agent".
 *
 * Agent-only by design: shell launches live in the Terminals view (the TabBar
 * "+" spawns a shell directly), so "New agent" never offers a non-agent option.
 */

/**
 * Build raw prompt intent and title for a launch. Main converts `prompt` to
 * provider argv after it resolves the effective profile, keeping this renderer
 * request advisory and preserving prompt text for spawn-time features.
 */
export function buildLaunchArgs(
  rawPrompt: string,
  fallbackTitle: string
): { prompt?: string; title?: string } {
  const body = rawPrompt.trim();
  const title = body ? titleFromPrompt(body) : fallbackTitle;
  return {
    prompt: body || undefined,
    title: title || undefined
  };
}

interface Props {
  onClose: () => void;
  /**
   * Pin the launcher to one registered project. When set, the launcher is in
   * PROJECT mode: no project picker, no starter chips, but it surfaces the
   * resume list, background tray, and default-persona star. When omitted, it's
   * in SCRATCH/global mode (project picker + chips, anchored to the built-in
   * `~/zcc-workspace` scratch project).
   */
  project?: Project;
  /**
   * Background (detached) sessions to surface so the tray isn't lost. Project
   * mode only — passed by the project Workspace.
   */
  backgroundTabs?: TerminalSession[];
  /**
   * Post-launch behavior. When provided, it OVERRIDES the default
   * redirect-into-the-project — the launcher calls it with the freshly created
   * session + its project id and does NOT navigate. The Agents (global) view
   * uses this to pop the agent-inspector modal instead of leaving the board.
   * When omitted, the default redirect (select the project + focus its tab) runs.
   */
  onLaunched?: (session: TerminalSession, projectId: string) => void;
  /**
   * Seed the instruction box with this text on open. Used by callers that want
   * the launcher to start prefilled — e.g. the inbox's "spawn an agent against
   * this message" button hands over the report as the first prompt. The user can
   * still edit it before launching.
   */
  initialPrompt?: string;
}

export const AgentLauncher = memo(function AgentLauncher({
  onClose,
  project,
  backgroundTabs,
  onLaunched,
  initialPrompt
}: Props) {
  const restoreTerminal = useData((s) => s.restoreTerminal);
  const loadProjects = useData((s) => s.loadProjects);
  // PERF FIX: wrap array selectors in useShallow to prevent re-renders on every
  // store update when the array content is unchanged.
  const projects = useData(useShallow((s) => s.projects));
  const [anchor, setAnchor] = useState<Project | null>(null);
  const [anchorError, setAnchorError] = useState<string | null>(null);
  // History-provider availability drives the "unavailable providers" note.
  const harnessCursorEnabled = useData((s) => s.harnessCursorEnabled);
  const harnessCodexEnabled = useData((s) => s.harnessCodexEnabled);
  const harnessPiEnabled = useData((s) => s.harnessPiEnabled);
  // Target project for a SCRATCH-mode launch. `null` = the built-in scratch
  // workspace (the default). Unused in project mode (the target is fixed).
  const [targetProjectId] = useState<string | null>(null);
  // Launch mode: Modern thread (HTTP), CLI Agent (PTY spawn), or an autonomous
  // team run. Each mode mounts its own composer below.
  const [mode, setMode] = useState<LaunchMode>('thread');
  const teams = useTeams(useShallow((s) => s.teams));
  useEffect(() => {
    if (mode === 'autonomous' && teams.length === 0) setMode('thread');
  }, [mode, teams.length]);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Project mode is pinned to one project; scratch mode offers the picker.
  const projectMode = !!project;
  const unavailableHistoryProviders = [
    harnessCursorEnabled ? 'Cursor' : null,
    harnessCodexEnabled ? 'Codex' : null,
    harnessPiEnabled ? 'PI' : null
  ].filter((provider): provider is string => provider !== null);
  // Resolve scratch-mode project selection.
  const target = projectMode
    ? project!
    : (targetProjectId ? projects.find((p) => p.id === targetProjectId) : null) ?? anchor;
  const scratchIsTarget = !projectMode && targetProjectId === null;

  // On mount: in scratch mode only, ensure the scratch project exists (creates
  // ~/zcc-workspace on first run) so a scratch launch has a resolvable target.
  useEffect(() => {
    let cancelled = false;
    void loadProjects();
    (async () => {
      const anchorRes = projectMode ? null : await product.projects.ensureQuickAgent();
      if (cancelled || !anchorRes) return;
      if (!anchorRes.ok) {
        setAnchorError(anchorRes.message);
        return;
      }
      setAnchor(anchorRes.value);
      // `ensureQuickAgent` creates the scratch project lazily in main but does
      // NOT broadcast a projects change, so the store's `projects` list won't
      // know about a freshly-created ~/zcc-workspace. Merge it in (mirroring
      // host.ts / Workspace.tsx) — otherwise a scratch launch lands a session
      // whose projectId the store can't resolve, and the Agents views render
      // the owning project as "Unknown".
      if (!useData.getState().projects.some((p) => p.id === anchorRes.value.id)) {
        void loadProjects();
      }
    })().catch((err) => {
      if (!cancelled) setAnchorError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
    };
  }, [projectMode, loadProjects]);

  useDialogFocusTrap(dialogRef, onClose);

  // Resume a backgrounded terminal, closing the launcher so the restored
  // terminal isn't hidden behind the backdrop.
  const resumeBackground = (id: string) => {
    if (!target) return;
    void restoreTerminal(id, target.id);
    onClose();
  };

  const bg = projectMode ? backgroundTabs ?? [] : [];

  const content = (
      <div
        ref={dialogRef}
        data-testid="launch-modal"
        className="palette launch-modal"
        role="dialog"
        aria-modal
        aria-label={mode === 'autonomous' ? 'New autonomous team' : 'New agent'}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="launch-panel">
          <div className="launch-header">
            <div>
              <h3>
                {mode === 'thread'
                  ? (projectMode ? project!.name : 'New agent')
                  : projectMode ? project!.name : scratchIsTarget ? 'Quick agent' : target?.name ?? 'New agent'}
              </h3>
              <p>
                {mode === 'thread'
                  ? 'Start an agent'
                  : projectMode
                    ? 'Start a session'
                    : scratchIsTarget
                      ? 'A scratch Claude session in your workspace'
                      : 'Start a Claude session in this project'}
              </p>
            </div>
          </div>

          {mode !== 'thread' && anchorError && scratchIsTarget && (
            <div className="launch-error" role="alert">
              Couldn’t prepare the workspace: {anchorError}
            </div>
          )}

          {/* Everything between the header and the Send button scrolls as one
              region — the button itself stays pinned outside it (see
              .launch-scroll / .launch-actions in global.css) so a long Advanced
              section or extra-args panel can never push Send off-screen. */}
          <div className="launch-scroll">
          {/* Launch mode: Modern (HTTP conversation) and CLI Agent (PTY) are
              always offered. Autonomous Team only appears when teams exist. */}
          <div className="launch-row">
            <LaunchModeSegmented
              value={mode}
              onChange={setMode}
              showAutonomousTeam={teams.length > 0}
            />
          </div>

          {mode === 'thread' && (
            <div className="launch-thread-composer">
              <ThreadCommandComposer
                project={project}
                initialText={initialPrompt}
                onCreated={onClose}
              />
            </div>
          )}

          {mode === 'agent' && (
            <div className="launch-thread-composer">
              <LegacyAgentHomeComposer
                project={project}
                initialText={initialPrompt}
                onLaunched={onLaunched}
                onClose={onClose}
              />
            </div>
          )}

          {mode === 'autonomous' && (
          <div className="launch-thread-composer">
            <AutonomousTeamComposer
              project={project}
              initialText={initialPrompt}
              onClose={onClose}
            />
          </div>
          )}

          {bg.length > 0 && (
            <div className="launch-background">
              <div className="launch-section-label">
                <TerminalIcon size={12} aria-hidden /> Still running ({bg.length})
              </div>
              <div className="launch-bg-list">
                {bg.map((t) => (
                  <button
                    key={t.id}
                    className="launch-bg-row"
                    title={`Resume ${t.title} · ${t.profile}`}
                    onClick={() => resumeBackground(t.id)}
                  >
                    <span className={`tab-profile-icon profile-${t.profile}`} aria-hidden="true">
                      {profileIcon(t.profile)}
                    </span>
                    <span className="launch-bg-title">{t.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {projectMode && <AgentConversationHistory projectId={project!.id} unavailableProviders={unavailableHistoryProviders} onResumed={onClose} />}
          </div>
        </div>
      </div>
  );

  return createPortal(
    <div className="palette-backdrop" onMouseDown={onClose}>
      {content}
    </div>,
    document.body
  );
});
