import { product } from '../../lib/product-client.js';
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Settings2,
  Sparkles,
  FlaskConical,
  Bot,
  Drama,
  Users,
  BarChart3,
  Info,
  TerminalSquare,
  SquareArrowOutUpRight,
  type LucideIcon
} from 'lucide-react';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import type { SettingsTab } from '@/store';
import { applyTheme, useData, useUi } from '@/store';
import { PromptsTab } from '@/views/settings/PromptsView';
import { ScopeControl } from '@/components/settings/ScopeControl';
import { GlobalTab } from '@/views/settings/GlobalView';
import { TerminalTab } from '@/views/settings/TerminalSettingsView';
import { AgentsTab } from '@/views/settings/AgentsSettingsView';
import { HarnessTab } from '@/views/settings/HarnessView';
import { EditorTab } from '@/views/settings/EditorView';
import { ExperimentalTab } from '@/views/settings/ExperimentalView';
import { AboutTab } from '@/views/settings/AboutView';
import { ProjectTab } from '@/views/settings/ProjectSettingsView';
import { PersonasPanel } from '@/views/settings/PersonasView';
import { SquadsPanel } from '@/views/settings/SquadsView';
import { UsagePanel } from '@/views/settings/UsageView';

/**
 * Settings sections. The section *picker* now lives in the list pane (column 2,
 * see `SettingsPane` in ListPane.tsx) — this map is the single source of truth
 * for each section's label + icon, shared by the picker and this panel's header.
 * Plugins / Skills / MCP live on the top-level Extensions workspace, not here.
 *
 * Section groups for the settings picker (column 2). Each section names its
 * `group`; the picker renders these headers in this order with the group's
 * sections beneath. Ordered most-used → most-specialised. `project` is not in
 * this list — Project settings is its own trailing group in the picker.
 */
export type SettingsGroup = 'config' | 'agents' | 'catalogues' | 'labs' | 'app';

export const SETTINGS_GROUPS: Array<{ id: SettingsGroup; label: string }> = [
  { id: 'config', label: 'Configuration' },
  { id: 'agents', label: 'Agents & Automation' },
  { id: 'catalogues', label: 'Catalogues' },
  { id: 'labs', label: 'Labs' },
  // Trailing group: app-level meta (version, updates, release notes) — not
  // configuration/behaviour, so it sits apart from the config groups, like the
  // Project group the picker appends after this loop.
  { id: 'app', label: 'App' }
];

export const SETTINGS_SECTIONS: Array<{
  id: SettingsTab;
  label: string;
  icon: LucideIcon;
  desc: string;
  group: SettingsGroup;
  /** Section can be scoped to a single project (shows the Global/Project toggle). */
  projectScoped?: boolean;
}> = [
  { id: 'global', label: 'Global', icon: Settings2, desc: 'App-wide defaults', group: 'config' },
  { id: 'terminal', label: 'Terminal', icon: TerminalSquare, desc: 'Appearance, shell & tmux', group: 'config' },
  { id: 'harness', label: 'Code Harness', icon: Bot, desc: 'Verify & enable Claude Code, Cursor, Codex & PI', group: 'config' },
  { id: 'editor', label: 'Editor', icon: SquareArrowOutUpRight, desc: 'Open-in-editor & terminal buttons', group: 'config' },
  { id: 'prompts', label: 'Prompts', icon: Sparkles, desc: 'LLM micro-call prompts', group: 'config' },
  { id: 'agents', label: 'Agents', icon: Bot, desc: 'Attention, automation, heartbeat & Overseer', group: 'agents' },
  { id: 'personas', label: 'Personas', icon: Drama, desc: 'Reusable launch profiles', group: 'agents' },
  { id: 'squads', label: 'Squads', icon: Users, desc: 'Reusable multi-agent teams', group: 'agents' },
  { id: 'usage', label: 'Usage', icon: BarChart3, desc: 'Session activity rollup', group: 'catalogues' },
  { id: 'experimental', label: 'Experimental', icon: FlaskConical, desc: 'Opt-in features under evaluation', group: 'labs' },
  { id: 'about', label: 'About', icon: Info, desc: 'Version, updates & release notes', group: 'app' }
];

/**
 * Anchor sub-sections per settings tab — the inner `<Section>` blocks the picker
 * exposes as clickable jump targets. `id` matches the `anchorId` passed to the
 * corresponding `<Section>` (which renders `id="settings-anchor-<id>"`); the
 * picker switches to `tab` then scrolls that element into view. Only the two
 * config-heavy tabs have anchors — catalogue tabs (Personas/Squads/Usage) are
 * whole sub-components with no core `<Section>` blocks to target.
 */
export const SETTINGS_SUBSECTIONS: Partial<Record<SettingsTab, Array<{ id: string; label: string }>>> = {
  agents: [
    { id: 'auto-mode', label: 'Auto mode' },
    { id: 'git-worktrees', label: 'Git worktrees' },
    { id: 'agent-tabs', label: 'Tabs' },
    { id: 'agent-attention', label: 'Agent attention' },
    { id: 'agent-automation', label: 'Agent automation' },
    { id: 'agent-heartbeat', label: 'Agent heartbeat' },
    { id: 'auto-close-idle', label: 'Idle handling & follow-ups' },
    { id: 'overseer', label: 'Overseer' }
  ],
  global: [
    { id: 'appearance', label: 'Appearance' },
    { id: 'authorizations', label: 'Authorizations' },
    { id: 'connectivity', label: 'Connectivity' },
    { id: 'performance', label: 'Performance & limits' },
    { id: 'projects', label: 'Projects' },
    { id: 'inbox', label: 'Inbox' }
  ],
  terminal: [
    { id: 'terminal-appearance', label: 'Appearance' },
    { id: 'terminal-shell', label: 'Shell' },
    { id: 'terminal-tmux', label: 'tmux' }
  ],
  harness: [
    { id: 'harness-status', label: 'Install status' },
    { id: 'harness-thread', label: 'Thread' },
    { id: 'harness-legacy', label: 'Legacy Agent' },
    { id: 'harness-claude', label: 'Claude Code' },
    { id: 'harness-cursor', label: 'Cursor' },
    { id: 'harness-codex', label: 'Codex' },
    { id: 'harness-pi', label: 'PI' },
    { id: 'harness-opencode', label: 'OpenCode' }
  ],
  editor: [
    { id: 'editor-status', label: 'Installed editors' },
    { id: 'editor-cursor', label: 'Cursor' },
    { id: 'editor-code', label: 'VS Code' },
    { id: 'editor-intellij', label: 'IntelliJ IDEA' },
    { id: 'editor-finder', label: 'Finder' },
    { id: 'editor-terminal', label: 'Terminal' }
  ],
};

/** Catalogue sections that need room for their list/detail controls. */
const WIDE_TABS = new Set<SettingsTab>([
  'personas',
  'squads',
  'usage'
]);

function sectionMeta(tab: SettingsTab) {
  return SETTINGS_SECTIONS.find((s) => s.id === tab);
}

export function SettingsView() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const savedTimer = useRef<number | null>(null);
  const tab = useUi((s) => s.settingsTab);
  const settingsAnchor = useUi((s) => s.settingsAnchor);
  const setSettingsAnchor = useUi((s) => s.setSettingsAnchor);

  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const projects = useData((s) => s.projects);
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  const [hooks, setHooks] = useState<unknown>(null);
  const [homedir, setHomedir] = useState<string>('');

  useEffect(() => {
    product.config.get().then(setConfig).catch(() => {});
    product.app.homedir().then(setHomedir).catch(() => {});
    product.skills.readHooks().then(setHooks).catch(() => {});
  }, []);

  const markSaved = useCallback(() => {
    setSavedFlash(true);
    if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => {
      setSavedFlash(false);
      savedTimer.current = null;
    }, 1600);
  }, []);

  useEffect(() => {
    return () => {
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    };
  }, []);

  // Scroll a pending sub-section anchor into view once its tab has rendered
  // (set by the section picker), then clear it so it fires only once. A short
  // rAF-ish delay lets the newly-switched tab's DOM mount before we query it.
  useEffect(() => {
    if (!settingsAnchor) return;
    const id = `settings-anchor-${settingsAnchor}`;
    const timer = window.setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setSettingsAnchor(null);
    }, 60);
    return () => window.clearTimeout(timer);
  }, [settingsAnchor, tab, setSettingsAnchor]);

  if (!config) {
    return (
      <div className="settings-panel" aria-label="Settings" aria-busy="true">
        <div className="settings-inner">
          <div className="settings-empty">Loading…</div>
        </div>
      </div>
    );
  }

  const resolve = (p: string) => (homedir ? p.replace(/^~/, homedir) : p);
  const openFile = (path: string) => {
    product.openers.openIn('cursor', resolve(path)).catch(() => {});
  };

  const update = async (patch: Partial<AppConfig>) => {
    try {
      const next = await product.config.set(patch);
      setConfig(next);
      if (typeof patch.fontSize === 'number') useData.getState().setFontSize(patch.fontSize);
      if (typeof patch.terminalTheme === 'string') {
        useData.getState().setTerminalTheme(patch.terminalTheme);
      }
      if (typeof patch.inboxGuidanceEnabled === 'boolean') {
        useData.getState().setInboxGuidanceEnabled(patch.inboxGuidanceEnabled);
      }
      if (typeof patch.terminalWheelArrowsEnabled === 'boolean') {
        useData.getState().setTerminalWheelArrowsEnabled(patch.terminalWheelArrowsEnabled);
      }
      if (typeof patch.heartbeatEnabled === 'boolean') {
        useData.getState().setHeartbeatEnabled(patch.heartbeatEnabled);
      }
      if (typeof patch.goalsEnabled === 'boolean') {
        useData.getState().setGoalsEnabled(patch.goalsEnabled);
      }
      if (typeof patch.followUpsEnabled === 'boolean') {
        useData.getState().setFollowUpsEnabled(patch.followUpsEnabled);
      }
      if (typeof patch.catchUpSummaryEnabled === 'boolean') {
        useData.getState().setCatchUpSummaryEnabled(patch.catchUpSummaryEnabled);
      }
      if (typeof patch.catchUpSummaryDelaySeconds === 'number') {
        useData.getState().setCatchUpSummaryDelaySeconds(patch.catchUpSummaryDelaySeconds);
      }
      if (typeof patch.feedNoiseClassifierEnabled === 'boolean') {
        useData.getState().setFeedNoiseClassifierEnabled(patch.feedNoiseClassifierEnabled);
      }
      if (typeof patch.structuredQuestionsEnabled === 'boolean') {
        useData.getState().setStructuredQuestionsEnabled(patch.structuredQuestionsEnabled);
      }
      if (typeof patch.worktreeIsolationDefault === 'boolean') {
        useData.getState().setWorktreeIsolationDefault(patch.worktreeIsolationDefault);
      }
      if (typeof patch.agentListNeedsYouFromTriage === 'boolean') {
        useData.getState().setAgentListNeedsYouFromTriage(patch.agentListNeedsYouFromTriage);
      }
      if (typeof patch.voiceInputEnabled === 'boolean') {
        useData.getState().setVoiceInputEnabled(patch.voiceInputEnabled);
      }
      if (typeof patch.harnessCursorEnabled === 'boolean') {
        useData.getState().setHarnessCursorEnabled(patch.harnessCursorEnabled);
      }
      if (typeof patch.harnessCodexEnabled === 'boolean') {
        useData.getState().setHarnessCodexEnabled(patch.harnessCodexEnabled);
      }
      if (typeof patch.harnessPiEnabled === 'boolean') {
        useData.getState().setHarnessPiEnabled(patch.harnessPiEnabled);
      }
      if (typeof patch.harnessOpenCodeEnabled === 'boolean') {
        useData.getState().setHarnessOpenCodeEnabled(patch.harnessOpenCodeEnabled);
      }
      if (typeof patch.microVmEnabled === 'boolean') {
        useData.getState().setMicroVmEnabled(patch.microVmEnabled);
      }
      if (Array.isArray(patch.openerHiddenTargets)) {
        useData.getState().setOpenerHiddenTargets(patch.openerHiddenTargets);
      }
      if (patch.theme) applyTheme(patch.theme);
      markSaved();
    } catch {
      // noop
    }
  };

  const meta = sectionMeta(tab);
  // Project settings are inherently project-scoped. Everything else is
  // app-wide and shows no scope control.
  const showScope = tab === 'project' || !!meta?.projectScoped;
  const allowGlobalScope = tab !== 'project';

  return (
    <div className="settings-panel">
      <div className={`settings-inner${WIDE_TABS.has(tab) ? ' settings-inner--wide' : ''}`}>
        <header className="settings-header">
          <div className="settings-header-title">
            {meta?.icon ? <meta.icon size={18} /> : null}
            <h1>{tab === 'project' ? 'Project settings' : meta?.label ?? 'Settings'}</h1>
            {meta?.desc && tab !== 'project' && (
              <span className="settings-header-desc">{meta.desc}</span>
            )}
          </div>
          {showScope && (
            <ScopeControl
              projects={projects}
              selectedProjectId={selectedProjectId}
              allowGlobal={allowGlobalScope}
            />
          )}
        </header>

        {tab === 'global' ? (
          <GlobalTab
            config={config}
            onConfigDraft={setConfig}
            onUpdate={update}
            hooks={hooks}
            onOpen={openFile}
          />
        ) : tab === 'terminal' ? (
          <TerminalTab config={config} onConfigDraft={setConfig} onUpdate={update} />
        ) : tab === 'agents' ? (
          <AgentsTab config={config} onConfigDraft={setConfig} onUpdate={update} />
        ) : tab === 'prompts' ? (
          <PromptsTab />
        ) : tab === 'harness' ? (
          <HarnessTab
            config={config}
            onConfigDraft={setConfig}
            onUpdate={update}
          />
        ) : tab === 'editor' ? (
          <EditorTab
            config={config}
            onConfigDraft={setConfig}
            onUpdate={update}
          />
        ) : tab === 'personas' ? (
          <PersonasPanel />
        ) : tab === 'squads' ? (
          <SquadsPanel />
        ) : tab === 'usage' ? (
          <UsagePanel />
        ) : tab === 'experimental' ? (
          <ExperimentalTab
            config={config}
            onConfigDraft={setConfig}
            onUpdate={update}
          />
        ) : tab === 'about' ? (
          <AboutTab config={config} onUpdate={update} />
        ) : (
          <ProjectTab
            project={selectedProject}
            onOpen={openFile}
            onSaved={markSaved}
          />
        )}

        {savedFlash && <div className="settings-saved">Saved</div>}
      </div>
    </div>
  );
}

export { SettingsView as SettingsPanel };
