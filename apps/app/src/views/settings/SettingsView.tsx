import { product } from '../../lib/product-client.js';
import { DelayedStencilList } from '../../components/ui/Skeleton.js';
import { useEffect, useState, useCallback, useRef } from 'react';
import { SETTINGS_SECTIONS } from './settings-navigation.js';
export { SETTINGS_GROUPS, SETTINGS_SECTIONS, SETTINGS_SUBSECTIONS } from './settings-navigation.js';
export type { SettingsGroup } from './settings-navigation.js';
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
import { MachinesTab } from '@/views/settings/MachinesSettingsView';
import { ConnectivityTab } from '@/views/settings/ConnectivityView';
import { PhoneTab } from '@/views/settings/PhoneSettingsView';
import { RemoteAccessView } from '@/views/settings/RemoteAccessView';
import { InboxSettingsTab } from '@/views/settings/InboxSettingsView';
import { KeyboardSettingsSection } from '@/views/settings/KeyboardSettingsSection';
import { ComposerSettingsView } from '@/views/settings/ComposerSettingsView';
import { BrowserSettingsSection } from '@/components/settings/BrowserSettingsSection';
import { ProjectTab } from '@/views/settings/ProjectSettingsView';
import { PersonasPanel } from '@/views/settings/PersonasView';
import { SquadsPanel } from '@/views/settings/SquadsView';
import { UsagePanel } from '@/views/settings/UsageView';
import { PerformanceSettingsView } from './PerformanceSettingsView.js';
import './settings.css';

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

  const [homedir, setHomedir] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    product.config.get().then((next) => {
      if (!cancelled) setConfig(next);
    }).catch(() => {});
    product.app.homedir().then((next) => {
      if (!cancelled) setHomedir(next);
    }).catch(() => {});
    const unsub = product.config.onChanged((next) => {
      if (!cancelled) setConfig(next);
    });
    return () => {
      cancelled = true;
      unsub();
    };
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
      <div className="settings-panel settings-panel--preferences" aria-label="Settings" aria-busy="true">
        <div className="settings-inner">
          <DelayedStencilList label="Loading settings" className="settings-empty" />
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
      if (typeof patch.cliRemoteToolProxyEnabled === 'boolean') {
        useData.getState().setCliRemoteToolProxyEnabled(patch.cliRemoteToolProxyEnabled);
      }
      if (typeof patch.followUpsEnabled === 'boolean') {
        useData.getState().setFollowUpsEnabled(patch.followUpsEnabled);
      }
      if (typeof patch.catchUpSummaryEnabled === 'boolean') {
        useData.getState().setCatchUpSummaryEnabled(patch.catchUpSummaryEnabled);
      }
      if (typeof patch.classicSessionViewEnabled === 'boolean') {
        useData.getState().setClassicSessionViewEnabled(patch.classicSessionViewEnabled);
      }
      if (typeof patch.catchUpSummaryDelaySeconds === 'number') {
        useData.getState().setCatchUpSummaryDelaySeconds(patch.catchUpSummaryDelaySeconds);
      }
      if (typeof patch.feedNoiseClassifierEnabled === 'boolean') {
        useData.getState().setFeedNoiseClassifierEnabled(patch.feedNoiseClassifierEnabled);
      }
      if (typeof patch.terminalClipboardWriteEnabled === 'boolean') {
        useData.getState().setTerminalClipboardWriteEnabled(patch.terminalClipboardWriteEnabled);
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
      if (typeof patch.harnessGrokEnabled === 'boolean') {
        useData.getState().setHarnessGrokEnabled(patch.harnessGrokEnabled);
      }
      if (typeof patch.harnessMastracodeEnabled === 'boolean') {
        useData.getState().setHarnessMastracodeEnabled(patch.harnessMastracodeEnabled);
      }
      if (typeof patch.harnessAfcodeEnabled === 'boolean') {
        useData.getState().setHarnessAfcodeEnabled(patch.harnessAfcodeEnabled);
      }
      if (typeof patch.nativeAgentDiscoveryEnabled === 'boolean') {
        useData.setState({ nativeAgentDiscoveryEnabled: patch.nativeAgentDiscoveryEnabled });
      }
      if (typeof patch.microVmEnabled === 'boolean') {
        useData.getState().setMicroVmEnabled(patch.microVmEnabled);
      }
      if (typeof patch.teamJobLaunchEnabled === 'boolean') {
        useData.getState().setTeamJobLaunchEnabled(patch.teamJobLaunchEnabled);
      }
      if (typeof patch.composerShowCliAgent === 'boolean') {
        useData.getState().setComposerShowCliAgent(patch.composerShowCliAgent);
      }
      if (typeof patch.composerShowModern === 'boolean') {
        useData.getState().setComposerShowModern(patch.composerShowModern);
      }
      if (typeof patch.composerShowAutonomousTeam === 'boolean') {
        useData.getState().setComposerShowAutonomousTeam(patch.composerShowAutonomousTeam);
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
    <div className="settings-panel settings-panel--preferences">
      <div className={`settings-inner${WIDE_TABS.has(tab) ? ' settings-inner--wide' : ''}`}>
        {tab !== 'remote-access' && <header className="settings-header">
          <div className="settings-header-title">
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
        </header>}

        {tab === 'global' ? (
          <GlobalTab
            config={config}
            onConfigDraft={setConfig}
            onUpdate={update}
          />
        ) : tab === 'composer' ? (
          <ComposerSettingsView
            config={config}
            onUpdate={update}
          />
        ) : tab === 'keyboard' ? (
          <KeyboardSettingsSection />
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
        ) : tab === 'performance' ? (
          <PerformanceSettingsView />
        ) : tab === 'experimental' ? (
          <ExperimentalTab
            config={config}
            onConfigDraft={setConfig}
            onUpdate={update}
          />
        ) : tab === 'about' ? (
          <AboutTab config={config} onUpdate={update} />
        ) : tab === 'machines' ? (
          <MachinesTab
            config={config}
            onConfigDraft={setConfig}
            onUpdate={update}
          />
        ) : tab === 'connectivity' ? (
          <ConnectivityTab
            config={config}
            onConfigDraft={setConfig}
            onUpdate={update}
          />
        ) : tab === 'remote-access' ? (
          <RemoteAccessView config={config} onConfigDraft={setConfig} />
        ) : tab === 'phone' ? (
          <PhoneTab />
        ) : tab === 'inbox' ? (
          <InboxSettingsTab
            config={config}
            onConfigDraft={setConfig}
            onUpdate={update}
          />
        ) : tab === 'browser' ? (
          <BrowserSettingsSection />
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
