/**
 * Design Docs settings inside the workbench: one header button opens a
 * two-pane view (grouped section rail + content) that replaces the doc list
 * and doc while open.
 */
import type { ReactNode } from 'react';
import { ArrowLeft, Bot, Settings as SettingsIcon, Users, type LucideIcon } from 'lucide-react';
import type { PeerStatus } from './api.js';
import { usePersistentState } from './hooks.js';
import { PeerSettings } from './PeerSettings.js';

export type SettingsTab = 'peers' | 'agent';

interface SettingsSection {
  id: SettingsTab;
  label: string;
  icon: LucideIcon;
  title: string;
  description: string;
}

/** Left-rail groups, mirroring the PR Monitor settings shell. */
const NAV_GROUPS: Array<{ label: string; sections: SettingsSection[] }> = [
  {
    label: 'SYNC',
    sections: [
      {
        id: 'peers',
        label: 'Peers',
        icon: Users,
        title: 'Peers',
        description: 'Choose which connected computers Design Docs syncs with.'
      }
    ]
  },
  {
    label: 'AGENTS',
    sections: [
      {
        id: 'agent',
        label: 'Agent',
        icon: Bot,
        title: 'Agent harness',
        description: 'Which AI harness Design Docs agents run on.'
      }
    ]
  }
];

const SECTIONS = NAV_GROUPS.flatMap((group) => group.sections);

/**
 * The header toggle. From the docs it is a plain Settings icon; from settings it is the way back.
 * (The count of syncing computers lives on the Sync button.)
 */
export function SettingsToggle({ open, onToggle }: { open: boolean; onToggle(): void }) {
  if (open) {
    return (
      <button
        type="button"
        className="btn dd-head-btn dd-settings-toggle"
        aria-pressed
        aria-label="Back to design docs"
        title="Back to design docs"
        onClick={onToggle}
      >
        <ArrowLeft size={13} aria-hidden /> <span>Design docs</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className="btn dd-head-btn dd-head-icon dd-settings-toggle"
      aria-pressed={false}
      aria-label="Settings"
      title="Design Docs settings: peers and agent"
      onClick={onToggle}
    >
      <SettingsIcon size={13} aria-hidden />
    </button>
  );
}

/**
 * The settings view: a common header (icon, title, subtitle, back to the docs),
 * a grouped section rail on the left and the selected section in a centered
 * reading column. Collapses the rail to a row of tabs at narrow widths.
 */
export function SettingsView({ peer, onBack, headerActions }: { peer: PeerStatus | null; onBack(): void; headerActions?: ReactNode }) {
  const [stored, setSection] = usePersistentState<SettingsTab>('settings-tab', 'peers');
  const section = SECTIONS.find((entry) => entry.id === stored) ?? SECTIONS[0]!;
  return (
    <div className="dd-peers-view dd-settings-view">
      <header className="dd-settings-header">
        <SettingsToggle open onToggle={onBack} />
        <SettingsIcon size={16} className="dd-settings-header-icon" aria-hidden />
        <div className="dd-settings-heading">
          <h2>Settings</h2>
          <p>Manage Design Docs sync, agents and publishing preferences.</p>
        </div>
        <span className="dd-spacer" />
        {headerActions}
      </header>
      <div className="dd-settings-body">
        <nav className="dd-settings-nav" aria-label="Settings sections">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="dd-nav-group">
              <div className="dd-nav-group-label">{group.label}</div>
              {group.sections.map((entry) => {
                const Icon = entry.icon;
                const on = entry.id === section.id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    id={`dd-settings-nav-${entry.id}`}
                    className={`dd-nav-row${on ? ' active' : ''}`}
                    aria-current={on ? 'page' : undefined}
                    onClick={() => setSection(entry.id)}
                  >
                    <Icon size={15} aria-hidden />
                    <span>{entry.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="dd-peers-view-scroll">
          <div className="dd-peers-view-body">
            <div className="dd-settings-section-head">
              <h3>{section.title}</h3>
              <p className="dd-muted">{section.description}</p>
            </div>
            {section.id === 'peers' ? <PeerSettings />
              : <AgentSettings />}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Which AI harness Design Docs agents run on. Informational: agents always
 * follow the project's AI harness setting (`harness: 'project-default'`).
 *
 * DECISION(design-docs-ai-harness, 2026-10-13): inherit-only. No "Always use"
 * mode and no override pickers here until core offers a plugin-facing harness
 * control (doc-vault zana/design-docs-ai-harness/proposal.md). A read-only
 * "what will this resolve to" summary was skipped: it needs a new SDK surface.
 */
export function AgentSettings() {
  return (
    <section className="dd-agent-settings" aria-label="Agent harness">
      <p className="dd-muted dd-agent-intro">
        Design Docs agents (Create &amp; draft, Ask agent and Publish) use the AI harness settings of the doc&apos;s project. They
        look in this order:
      </p>
      <ol className="dd-muted dd-agent-order">
        <li>the doc&apos;s project;</li>
        <li>for a doc with no project, the Default Project;</li>
        <li>anything the project leaves unset, the global AI harness settings.</li>
      </ol>
      <p className="dd-muted dd-agent-help">
        Change these in <strong>Settings → AI Harness</strong>, where you can also install and enable harnesses. If a project
        setting can&apos;t be used by Design Docs agents, the agent won&apos;t start and the error names that setting.
      </p>
    </section>
  );
}
