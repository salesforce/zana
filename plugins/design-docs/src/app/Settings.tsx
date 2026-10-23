/**
 * Design Docs settings inside the workbench: one header button opens a
 * two-pane view (grouped section rail + content) that replaces the doc list
 * and doc while open.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Bot, Settings as SettingsIcon, Users, type LucideIcon } from 'lucide-react';
import type { HarnessRoutingEditorPatch } from '@zana-ai/zcc-plugin-sdk/app';
import { experimental_HarnessRoutingEditor as HarnessRoutingEditor } from '@zana-ai/zcc-plugin-sdk/app';
import { errorMessage, toast, useApi, type HarnessRouting, type HarnessScope, type PeerStatus } from './api.js';
import { usePersistentState, useProjects, useResource } from './hooks.js';
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
        description: 'Which AI harness Design Docs agents run on, per scope.'
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

type ScopeKind = Exclude<HarnessScope['kind'], 'default-project'>;
type HarnessFamily = keyof HarnessRouting['byAdapter'];

/**
 * Design Docs offers two scopes: Default (stored at the host's Global scope)
 * and one Project. The host's Default Project scope is not offered: it would
 * reach the same docs as Default and only shadow it.
 */
const SCOPE_TABS: ReadonlyArray<readonly [ScopeKind, string]> = [
  ['global', 'Default'],
  ['project', 'Project']
];

const SCOPE_HELP: Record<ScopeKind, string> = {
  global: 'Applies to every Design Docs agent, including docs without a project, unless the doc’s project sets its own.',
  project: 'Applies only to docs in this project, over Default.'
};

/** An override that sets nothing is null, so the scope inherits again. */
function orInherit(value: HarnessRouting): HarnessRouting | null {
  return Object.keys(value.byAdapter).length || value.defaultHarness ? value : null;
}

/** Merge one adapter's patch into a routing value; undefined keys clear, an empty result is null (inherit). */
export function patchHarnessRouting(value: HarnessRouting | null, adapterId: HarnessFamily, patch: HarnessRoutingEditorPatch): HarnessRouting | null {
  const byAdapter: Record<string, Record<string, unknown>> = { ...(value?.byAdapter ?? {}) };
  const next: Record<string, unknown> = { ...(byAdapter[adapterId] ?? {}), ...patch };
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  if (Object.keys(next).length) byAdapter[adapterId] = next;
  else delete byAdapter[adapterId];
  return orInherit({ ...value, schemaVersion: 1, byAdapter } as HarnessRouting);
}

/** Set (or clear with `''`) the harness this scope runs Design Docs agents on. */
export function patchDefaultHarness(value: HarnessRouting | null, family: string): HarnessRouting | null {
  return orInherit({
    schemaVersion: 1,
    byAdapter: value?.byAdapter ?? {},
    ...(family ? { defaultHarness: family } : {})
  } as HarnessRouting);
}

/**
 * Which AI harness Design Docs agents run on. Core's own harness editor edits
 * this plugin's override at Default or one Project. The harness choice and each
 * harness's row come from the narrowest scope that sets them (Project, then
 * Default), a row as a whole value; where neither is set, agents follow Zana's
 * AI harness settings for the doc's project. Saving a
 * choice is the consent: there is no extra prompt (`harness: 'project-default'`).
 */
export function AgentSettings() {
  const api = useApi();
  const projects = useProjects();
  const [kind, setKind] = useState<ScopeKind>('global');
  const [projectId, setProjectId] = useState('');
  const projectList = (projects.data ?? []).filter((project) => !project.quickAgent);
  const selected = projectId || projectList[0]?.id || '';
  const scope: HarnessScope | null = kind === 'project'
    ? (selected ? { kind, projectId: selected } : null)
    : { kind };
  const key = scope ? JSON.stringify(scope) : null;
  const descriptors = useResource('harness-descriptors', () => api.harnessDescriptors());
  const [value, setValue] = useState<{ key: string; routing: HarnessRouting | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saves = useRef(0);

  useEffect(() => {
    setError(null);
    if (!scope || !key) return;
    let cancelled = false;
    void api.harnessRouting(scope).then(
      (routing) => { if (!cancelled) setValue({ key, routing }); },
      (failure: unknown) => { if (!cancelled) setError(errorMessage(failure)); }
    );
    return () => { cancelled = true; };
    // `scope` is derived from `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key]);

  const current = value?.key === key ? value.routing : null;
  const ready = !!scope && value?.key === key && descriptors.data !== null;

  const save = (next: HarnessRouting | null) => {
    if (!scope || !key || !ready) return;
    const sequence = ++saves.current;
    setError(null);
    api.setHarnessRouting(scope, next).then(
      (routing) => { if (sequence === saves.current) setValue({ key, routing }); },
      (failure: unknown) => {
        if (sequence !== saves.current) return;
        const message = errorMessage(failure);
        setError(message);
        toast(message, 'error');
      }
    );
  };

  return (
    <section className="dd-agent-settings" aria-label="Agent harness">
      <p className="dd-muted dd-agent-intro">
        Choose the AI harness, model and execution state Design Docs agents (Create &amp; draft, Ask agent and Publish) use. A
        project&apos;s choice wins over Default. Where neither is set, agents follow Zana&apos;s AI harness settings for the
        doc&apos;s project.
      </p>
      <div className="dd-agent-scopes" role="tablist" aria-label="Harness scope">
        {SCOPE_TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`dd-agent-scope-${id}`}
            aria-controls="dd-agent-scope-panel"
            className={`dd-agent-scope${kind === id ? ' active' : ''}`}
            aria-selected={kind === id}
            tabIndex={kind === id ? 0 : -1}
            onClick={() => setKind(id)}
            onKeyDown={(event) => {
              const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
              if (!step) return;
              event.preventDefault();
              const next = SCOPE_TABS[(SCOPE_TABS.findIndex(([tab]) => tab === kind) + step + SCOPE_TABS.length) % SCOPE_TABS.length]![0];
              setKind(next);
              document.getElementById(`dd-agent-scope-${next}`)?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="dd-agent-scope-panel" id="dd-agent-scope-panel" role="tabpanel" aria-labelledby={`dd-agent-scope-${kind}`}>
        <p className="dd-muted dd-agent-help">{SCOPE_HELP[kind]}</p>
        {kind === 'project' && (projectList.length ? (
          <label className="dd-field dd-agent-project">
            <span className="dd-field-label">Project</span>
            <select className="dd-input dd-select" aria-label="Project" value={selected} onChange={(event) => setProjectId(event.target.value)}>
              {projectList.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
        ) : <p className="dd-muted dd-agent-help">No projects are registered.</p>)}
        {(scope || error) && (
          <HarnessRoutingEditor
            descriptors={descriptors.data ?? []}
            value={current ?? undefined}
            onChange={(adapterId, patch) => save(patchHarnessRouting(current, adapterId, patch))}
            defaultHarness={{
              value: current?.defaultHarness ?? '',
              onChange: (family) => save(patchDefaultHarness(current, family))
            }}
            inheritLabel={kind === 'global' ? 'Use Zana’s AI harness settings' : 'Use Default'}
            loading={!ready && !error}
            notice={error ? <p className="dd-agent-error" role="alert">{error}</p> : null}
          />
        )}
      </div>
    </section>
  );
}
