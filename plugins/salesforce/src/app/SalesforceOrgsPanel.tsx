import { useEffect, useMemo, useState } from 'react';
import { AppWindow, Bot, Database, FileCode, FlaskConical, Home, Package, type LucideIcon } from 'lucide-react';
import { useZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
import type { HubProject } from '../../lib/hub-projects.js';
import type { WorkbenchView } from '../../lib/workbench-contract.js';
import { OrgPicker } from './OrgPicker.js';
import { rememberProjectView } from './project-view.js';
import { queueAgentScriptOpen } from './agent-script-open.js';
import { useSalesforceCall } from './components/client.js';
import { HUB_STYLES } from './components/hub-styles.js';
import { SalesforcePanelFrame } from './components/ui.js';
import { useResource } from './components/use-resource.js';
import { readRecentAgents, type RecentAgent } from './recent-agents.js';

const PROJECT_KEY = 'salesforce:hub:project';
const TAB_ID = 'salesforce';

/** Each tile opens the chosen project's Salesforce tab on one view; a new experience is one more row. */
const EXPERIENCES: ReadonlyArray<{ view: WorkbenchView; title: string; description: string; Icon: LucideIcon }> = [
  { view: 'agentforce', title: 'Agentforce Studio', description: 'Edit, preview, test and publish agents.', Icon: Bot },
  { view: 'data', title: 'Data', description: 'Objects, fields, SOQL and records.', Icon: Database },
  { view: 'apex', title: 'Apex & logs', description: 'Apex tests, debug logs and LWC.', Icon: FlaskConical },
  { view: 'deployments', title: 'Deployments', description: 'Deploy, retrieve and operation history.', Icon: Package },
  { view: 'overview', title: 'Project home', description: 'Target org, checks and recent activity.', Icon: Home },
];

function readStoredProject(): string {
  try { return localStorage.getItem(PROJECT_KEY) ?? ''; } catch { return ''; }
}

function storeProject(projectId: string): void {
  try { localStorage.setItem(PROJECT_KEY, projectId); } catch { /* optional */ }
}

const fileName = (path: string) => (path.split('/').pop() || path).replace(/\.agent$/i, '');

function ago(openedAt: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - openedAt) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** The global Salesforce page: open the Studio or a tool in a project, then manage orgs. */
export function SalesforceOrgsPanel(props: { pluginId: string; subPath?: string }) {
  const navigate = useZccNavigate();
  const call = useSalesforceCall(props.pluginId);
  const listed = useResource<{ projects?: HubProject[] }>(call, 'hub.projects');
  const projects = useMemo(() => listed.data?.projects ?? [], [listed.data]);
  const [chosen, setChosen] = useState(readStoredProject);
  const [recent] = useState<RecentAgent[]>(readRecentAgents);
  const [windowError, setWindowError] = useState<string | null>(null);

  // A remembered project that is gone falls back to the first Salesforce project.
  const project = projects.find(row => row.id === chosen) ?? projects[0] ?? null;
  useEffect(() => { setWindowError(null); }, [project?.id]);
  const names = useMemo(() => new Map(projects.map(row => [row.id, row.name])), [projects]);
  const recentRows = recent.filter(row => names.has(row.projectId));
  const salesforceProjects = projects.filter(row => row.salesforce);
  const otherProjects = projects.filter(row => !row.salesforce);
  const canOpenWindow = typeof navigate.openInWindow === 'function';

  const choose = (projectId: string) => {
    setChosen(projectId);
    storeProject(projectId);
  };
  const open = (view: WorkbenchView, projectId = project?.id) => {
    if (!projectId) return;
    choose(projectId);
    rememberProjectView(projectId, view);
    navigate.toProject(projectId, { tabId: TAB_ID });
  };
  const openWindow = async () => {
    if (!project || !navigate.openInWindow) return;
    setWindowError(null);
    rememberProjectView(project.id, 'agentforce', true);
    const opened = await navigate.openInWindow(project.id, { tabId: TAB_ID }).catch(() => false);
    if (!opened) setWindowError('The Studio window is only available in the desktop app.');
  };
  const openRecent = (row: RecentAgent) => {
    queueAgentScriptOpen(row.projectId, row.path);
    open('agentforce', row.projectId);
  };

  const target = project?.targetAlias;
  return (
    <SalesforcePanelFrame title="Salesforce">
      <style>{HUB_STYLES}</style>
      <div className="sf-scroll sf-content sf-hub" data-testid="salesforce-orgs-panel">
        <h2>Salesforce</h2>
        <p className="sf-muted">Build agents, explore data and ship changes in your Salesforce projects.</p>

        <section className="sf-hub-studio" aria-labelledby="sf-hub-studio-title">
          <div className="sf-hub-studio-head">
            <span className="sf-hub-studio-icon"><Bot aria-hidden="true" /></span>
            <div>
              <h3 id="sf-hub-studio-title">Agentforce Studio</h3>
              <div className="sf-muted sf-small">Author Agent Script, preview conversations, run tests and publish.</div>
            </div>
          </div>
          {listed.error ? (
            <div className="sf-hub-note" role="alert">
              {listed.error} <button className="sf-btn quiet" type="button" onClick={() => void listed.refresh()}>Retry</button>
            </div>
          ) : !listed.data ? (
            <div className="sf-muted sf-small">Loading projects…</div>
          ) : !project ? (
            <div className="sf-hub-note">Add a local project folder from the sidebar to open the Studio in it.</div>
          ) : (
            <>
              <label className="sf-hub-project">
                <span className="sf-muted">Project</span>
                <select aria-label="Project" value={project.id} onChange={event => choose(event.target.value)}>
                  {salesforceProjects.length > 0 && otherProjects.length > 0 ? (
                    <>
                      <optgroup label="Salesforce projects">{salesforceProjects.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</optgroup>
                      <optgroup label="Other projects">{otherProjects.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</optgroup>
                    </>
                  ) : projects.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
                <span className="sf-muted sf-small" data-testid="salesforce-hub-target">
                  {target ? <>Target <strong>{target}</strong></> : 'Uses the shared default org'}
                  {!project.dxProject && ' · drafts only, no DX project'}
                </span>
              </label>
              <div className="sf-hub-actions">
                <button className="sf-btn primary" type="button" onClick={() => open('agentforce')}><Bot aria-hidden="true" />Open Studio</button>
                {canOpenWindow && (
                  <button className="sf-btn" type="button" onClick={() => void openWindow()}><AppWindow aria-hidden="true" />Open in own window</button>
                )}
              </div>
              {windowError && <div className="sf-hub-note" role="status">{windowError}</div>}
            </>
          )}
        </section>

        <h3>Tools</h3>
        <div className="sf-hub-tiles">
          {EXPERIENCES.map(({ view, title, description, Icon }) => (
            <button className="sf-hub-tile" type="button" key={view} disabled={!project} onClick={() => open(view)}>
              <span className="sf-hub-tile-icon"><Icon aria-hidden="true" /></span>
              <strong>{title}</strong>
              <span className="sf-muted sf-small">{description}</span>
            </button>
          ))}
        </div>

        {recentRows.length > 0 && (
          <>
            <h3>Recent agents</h3>
            <ul className="sf-hub-recent" aria-label="Recent agents">
              {recentRows.map(row => (
                <li key={`${row.projectId}:${row.path}`}>
                  <button type="button" title={row.path} onClick={() => openRecent(row)}>
                    <FileCode aria-hidden="true" />
                    <span className="sf-grow">
                      <strong>{fileName(row.path)}</strong>
                      <span className="sf-muted sf-small"> · {names.get(row.projectId)} · {ago(row.openedAt, Date.now())}</span>
                    </span>
                    <span className="sf-muted sf-small">Open</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <h3>Connected orgs</h3>
        <p className="sf-muted sf-small">The shared default applies to projects without their own target.</p>
        <OrgPicker pluginId={props.pluginId} />
      </div>
    </SalesforcePanelFrame>
  );
}
