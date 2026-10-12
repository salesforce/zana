import { useSalesforceControl } from './useSalesforceControl.js';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Settings2, Plus } from 'lucide-react';
import {
  Database,
  FlaskConical,
  Package,
  Bot,
  ArrowUpRight,
  CircleCheck,
  Home,
} from "./components/icons.js";
import { useWindowTitle, useZccContext, useZccNavigate, type ZccWindowTitle } from "@zana-ai/zcc-plugin-sdk/app";
import type {
  WorkbenchStatus,
  WorkbenchView,
} from "../../lib/workbench-contract.js";
import type { DoctorReport } from "../../lib/types.js";
import { orgReadiness } from "./org-readiness.js";
import { SalesforceState } from "./components/SalesforceState.js";
import { OrgPicker } from "./OrgPicker.js";
import { SALESFORCE_STYLES } from "./components/styles.js";
import { requireResult, useSalesforceCall } from "./components/client.js";
import { useResource } from "./components/use-resource.js";
import {
  ErrorState,
  LoadingState,
  OrgBadge,
} from "./components/ui.js";
import { SoqlExplorerPanel } from "./soql/SoqlExplorerPanel.js";
import {
  ApexPanel,
  DeploymentsPanel,
  OperationsPanel,
} from "./panels/WorkbenchPanels.js";
import { AgentforcePlaygroundPanel } from "./AgentScriptPanel.js";
import { parseAgentforcePanelFocus, type StudioFocus } from "./agentforce-panel-params.js";

import { SalesforceTabs } from "./components/Tabs.js";
import { useContextChangeRelay } from './context-sync.js';

const VIEWS: Array<[WorkbenchView, string]> = [
  ["overview", "Overview"],
  ["data", "Data"],
  ["apex", "Apex & logs"],
  ["deployments", "Deployments"],
  ["agentforce", "Agentforce"],
];

/** The Studio window's activity bar: Agentforce first, short labels under icons. */
const STUDIO_VIEWS: Array<[WorkbenchView, string]> = [
  ["agentforce", "Agents"],
  ["data", "Data"],
  ["apex", "Apex"],
  ["deployments", "Deploy"],
  ["overview", "Home"],
];
const STUDIO_ICONS = { agentforce: Bot, data: Database, apex: FlaskConical, deployments: Package, overview: Home };

const VIEW_IDS = VIEWS.map(([id]) => id);
/** The Studio window keeps its own last view, so detaching does not move the main tab. */
const viewKey = (projectId: string, studio = false) => `salesforce:${studio ? "studio-window" : "project-tab"}:${projectId}`;
/**
 * The view last used in this project (untrusted storage: unknown values fall
 * back to Overview, or to Agentforce in the Studio window).
 */
export function readProjectView(projectId: string, studio = false): WorkbenchView {
  const fallback: WorkbenchView = studio ? "agentforce" : "overview";
  try {
    const stored = localStorage.getItem(viewKey(projectId, studio));
    return VIEW_IDS.find(id => id === stored) ?? fallback;
  } catch { return fallback; }
}

/**
 * The Studio window's title: the open agent or the view, the org, and a badge when the org is
 * production or of unknown kind, so a risky window reads as one in the OS window list too.
 */
export function studioWindowTitle(input: { view: WorkbenchView; agentPath: string | null; alias: string; orgKind?: string }): ZccWindowTitle {
  const agent = input.view === "agentforce" && input.agentPath ? input.agentPath.split("/").pop()?.replace(/\.agent$/i, "") : "";
  const title = input.view === "agentforce"
    ? agent ? `Agentforce · ${agent}` : "Agentforce"
    : `Salesforce · ${STUDIO_VIEWS.find(([id]) => id === input.view)?.[1] ?? "Home"}`;
  const risk: Pick<ZccWindowTitle, "badge" | "tone"> | null = input.orgKind === "production" ? { badge: "Production", tone: "danger" }
    : input.orgKind === "unknown" ? { badge: "Unknown org", tone: "warning" } : null;
  return { title, ...(input.alias ? { detail: input.alias } : {}), ...(input.alias && risk ? risk : {}) };
}

export function SalesforceProjectTab(props: {
  pluginId: string;
  projectId: string;
  headerActions?: ReactNode;
}) {
  useContextChangeRelay();
  const panelId = useId();
  const navigate = useZccNavigate();
  const context = useZccContext();
  const studio = context.surface === "plugin-view";
  const call = useSalesforceCall(
    props.pluginId,
    props,
    context.threadId ?? undefined,
  );
  const status = useResource<WorkbenchStatus>(call, "status");
  const [view, setViewState] = useState<WorkbenchView>(() => readProjectView(props.projectId, studio));
  // An agent opened from a card in another window; cleared on leaving Agents so a later visit restores the last file.
  const [agentFocus, setAgentFocus] = useState<StudioFocus | null>(null);
  const focusSeq = useRef(0);
  const setView = (next: WorkbenchView) => {
    setViewState(next);
    if (next !== "agentforce") setAgentFocus(null);
    try { localStorage.setItem(viewKey(props.projectId, studio), next); } catch { /* optional */ }
  };
  const [orgsOpen, setOrgsOpen] = useState(false);
  const [loginRequest, setLoginRequest] = useState(0);
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosenTarget, setChosenTarget] = useState<{ projectId: string; alias: string } | null>(null);
  const doctorGeneration = useRef(0);
  useEffect(() => {
    setDoctor(null);
    setViewState(readProjectView(props.projectId, studio));
    setAgentFocus(null);
    setOrgsOpen(false);
    setLoginRequest(0);
  }, [props.projectId, studio]);
  const alias = chosenTarget?.projectId === props.projectId ? chosenTarget.alias : status.data?.selectedAlias || status.data?.defaultOrg || "";
  useEffect(() => { setChosenTarget(null); }, [props.projectId, status.data]);
  const selected = (alias: string) => setChosenTarget({ projectId: props.projectId, alias });
  useSalesforceControl({ pluginId: props.pluginId, projectId: props.projectId, orgAlias: alias || undefined, threadId: context.threadId ?? undefined, surface: 'workbench',
    commands: ['state', 'view.open'], state: () => ({ view, orgAlias: alias }),
    execute: ({ command, input, user }) => {
      if (command === 'state') return;
      const next = VIEWS.find(([id]) => id === input.view);
      if (!next) throw Error('Choose overview, data, apex, deployments or agentforce.');
      if (input.path === undefined && input.line === undefined) { setView(next[0]); return; }
      // Only the person's own card may open a file here; a thread uses file.open, which the Studio holds while they type.
      if (!user) throw Error('Open the file with file.open on the agentforce view.');
      const focus = parseAgentforcePanelFocus({ path: input.path, line: input.line });
      if (next[0] !== 'agentforce' || !focus.path) throw Error('Provide an agent path for the agentforce view.');
      setView(next[0]);
      setAgentFocus({ path: focus.path, ...(focus.line ? { line: focus.line } : {}), nonce: ++focusSeq.current });
    },
  });
  useLayoutEffect(() => {
    doctorGeneration.current++;
    setDoctor(null);
    setChecking(false);
    setError(null);
    return () => {
      doctorGeneration.current++;
    };
  }, [props.projectId, alias]);
  const readiness = orgReadiness(status.data ? { ...status.data, selectedAlias: alias, defaultOrg: alias } : null, doctor);
  const org = status.data?.orgs?.find(
    (row) => row.alias === alias || row.username === alias,
  );
  const [agentPath, setAgentPath] = useState<string | null>(null);
  // An org the CLI no longer lists is of unknown kind, so it gets the warning too.
  useWindowTitle(studio ? studioWindowTitle({ view, agentPath, alias, orgKind: org?.kind ?? (status.data ? "unknown" : undefined) }) : null);
  useEffect(() => {
    const changed = (event: Event) => {
      const projectId = (event as CustomEvent<{ projectId?: string }>).detail?.projectId;
      if (projectId && projectId !== props.projectId) return;
      doctorGeneration.current++;
      setDoctor(null);
      setChecking(false);
      setError(null);
      void status.refresh();
    };
    window.addEventListener('sf:context-changed', changed);
    return () => window.removeEventListener('sf:context-changed', changed);
  }, [props.projectId, status.refresh]);
  const refreshConnection = () => window.dispatchEvent(new CustomEvent('sf:context-changed', { detail: { projectId: props.projectId } }));
  const connectionGuidance = <SalesforceState compact kind={readiness.kind === 'unavailable' ? 'error' : 'empty'} title={readiness.title}
    action={<>
      <button className="sf-btn primary" type="button" onClick={() => setLoginRequest(value => value + 1)}>Sign in to an org</button>
      <button className="sf-btn" type="button" onClick={() => setOrgsOpen(true)}>Choose an existing org</button>
      <button className="sf-btn quiet" type="button" disabled={status.busy} onClick={refreshConnection}>Check again</button>
    </>}>
    <p>{readiness.detail}</p>
    <p>The target applies to this project. Other projects keep their own targets.</p>
  </SalesforceState>;
  const scoped = {
    ...props,
    orgAlias: alias || undefined,
    threadId: context.threadId ?? undefined,
  };
  const investigate = (text: string) =>
    navigate.toCompose({
      initialPrompt: `Salesforce project: ${status.data?.projectName || props.projectId}\nTarget org: ${alias || "not selected"}\n\n${text}`,
      focusPrompt: true,
    });
  async function check() {
    const generation = ++doctorGeneration.current;
    setChecking(true);
    setError(null);
    try {
      const result = requireResult<DoctorReport>(await call("doctor"));
      if (generation === doctorGeneration.current) setDoctor(result);
    } catch (failure) {
      if (generation === doctorGeneration.current)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (generation === doctorGeneration.current) setChecking(false);
    }
  }
  const tabs = (
    <SalesforceTabs<WorkbenchView>
      label="Salesforce tools"
      items={studio ? STUDIO_VIEWS : VIEWS}
      icons={studio ? STUDIO_ICONS : undefined}
      orientation={studio ? "vertical" : "horizontal"}
      value={view}
      onChange={setView}
      panelId={panelId}
    />
  );
  const workbench = (
    <>
      <header className="sf-workbench-toolbar">
        {studio ? (
          <span className="sf-studio-heading">
            {STUDIO_VIEWS.find(([id]) => id === view)?.[1]}
            {status.data?.projectName && <span className="sf-muted"> · {status.data.projectName}</span>}
          </span>
        ) : tabs}
        <div className="sf-workbench-org">
          <OrgPicker
            pluginId={props.pluginId}
            projectId={props.projectId}
            compact
            appearance="toolbar"
            key={props.projectId}
            loginRequest={loginRequest}
            onSelect={selected}
          />
          <div className="sf-workbench-org-actions">
          <button
            className="icon-btn"
            type="button"
            title="Connect org"
            aria-label="Connect org"
            onClick={() => setLoginRequest(value => value + 1)}
          >
            <Plus size={15} aria-hidden="true" />
          </button>
          <button
            className="icon-btn"
            type="button"
            title="Org details"
            aria-label="Org details"
            onClick={() => setOrgsOpen(value => !value)}
            aria-expanded={Boolean(orgsOpen)}
          >
            <Settings2 size={15} aria-hidden="true" />
          </button>
          </div>
          {props.headerActions}
        </div>
      </header>
      {orgsOpen && (
        <div
          className="sf-scroll sf-content"
          style={{ flex: "0 1 auto", maxHeight: 360 }}
        >
          <OrgPicker
            key={props.projectId}
            pluginId={props.pluginId}
            projectId={props.projectId}
            hideConnect
            onSelect={selected}
          />
        </div>
      )}
      {(status.error || error) && (
        <ErrorState
          message={status.error || error!}
          retry={() => void status.refresh()}
        />
      )}
      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={`${panelId}-${view}`}
        className="sf-scroll"
        style={{ display: "flex", flexDirection: "column" }}
      >
        {view === "overview" && (
          <div className="sf-scroll sf-content sf-overview">
            {status.busy && !status.data ? (
              <LoadingState hint="Preparing your project tools." />
            ) : status.error ? null : (
              <>
                <h2>
                  {readiness.kind === 'selected'
                    ? "Ready for your next change."
                    : "Start building locally."}
                </h2>
                <p className="sf-muted">
                  Your org, source, and development tools in one project.
                </p>
                <div className="sf-summary">
                  <CircleCheck />
                  <div className="sf-grow">
                    <strong>Local authoring ready</strong>
                    <div className="sf-muted sf-small">
                      {status.data?.dxProject
                        ? "Salesforce DX detected"
                        : "Agentforce drafts stay in this project"}
                      {alias && <> · {alias} · {status.data?.targetSource === "project" ? "Project target" : "Default target"}</>}
                    </div>
                  </div>
                  {org && <OrgBadge org={org} />}
                  <button
                    className="sf-btn"
                    type="button"
                    disabled={checking}
                    onClick={() => void check()}
                  >
                    {checking ? "Checking…" : "Check project"}
                  </button>
                </div>
                {doctor && (
                  <div className="sf-notice" role="status">
                    {doctor.cliOk
                      ? "Salesforce CLI available"
                      : doctor.cliError || "Salesforce CLI unavailable"}{" "}
                    ·{" "}
                    {doctor.org
                      ? `${doctor.org.alias} connected`
                      : "No active org connection"}{" "}
                    · {doctor.agentBundleCount} Agentforce bundles
                  </div>
                )}
                {readiness.kind !== 'selected' && connectionGuidance}
                <div className="sf-tasks">
                  {(
                    [
                      [
                        "data",
                        "Explore data",
                        "Objects, fields, SOQL, and records",
                        Database,
                      ],
                      [
                        "apex",
                        "Test and investigate",
                        "Apex tests, debug logs, and LWC",
                        FlaskConical,
                      ],
                      [
                        "deployments",
                        "Review a deployment",
                        "Selected metadata and operation history",
                        Package,
                      ],
                      [
                        "agentforce",
                        "Build an agent",
                        "Create and edit local Agentforce drafts",
                        Bot,
                      ],
                    ] as const
                  ).map(([id, title, description, Icon]) => (
                    <button
                      className="sf-task"
                      type="button"
                      key={id}
                      onClick={() => setView(id)}
                    >
                      <Icon />
                      <span>
                        {title}
                        <small>{description}</small>
                      </span>
                      <ArrowUpRight />
                    </button>
                  ))}
                </div>
                <div className="sf-overview-activity">
                  <OperationsPanel {...scoped} onAddToPrompt={investigate} />
                </div>
              </>
            )}
          </div>
        )}
        {view === "data" && status.busy && !status.data && <LoadingState label="Checking org connections…" />}
        {view !== "overview" && view !== "agentforce" && readiness.kind !== 'selected' && !status.busy && !status.error && connectionGuidance}
        {view === "data" && readiness.kind === 'selected' && (
          <SoqlExplorerPanel
            key={`${props.projectId}:${alias}`}
            {...scoped}
            onAddToPrompt={investigate}
            onOpenRecord={
              context.threadId
                ? (recordId, objectName, orgAlias) => {
                    navigate.openThreadPanel({
                      actionId: "sf-record",
                      title: objectName,
                      params: {
                        version: 1,
                        projectId: props.projectId,
                        recordId,
                        objectName,
                        orgAlias,
                      },
                    });
                  }
                : undefined
            }
          />
        )}
        {view === "apex" && (
          <ApexPanel
            key={`${props.projectId}:${alias}`}
            {...scoped}
            onAddToPrompt={investigate}
          />
        )}
        {view === "deployments" && (
          <DeploymentsPanel
            key={`${props.projectId}:${alias}`}
            {...scoped}
            onAddToPrompt={investigate}
          />
        )}
        {view === "agentforce" && (
          <AgentforcePlaygroundPanel pluginId={props.pluginId} projectId={props.projectId} params={agentFocus ?? undefined} orgPicker={false} onActivePath={setAgentPath} headerActions={context.threadId && <button className="sf-as-save" type="button" onClick={() => navigate.openThreadPanel({ actionId: 'playground', params: { projectId: props.projectId, orgAlias: alias } })}>Open beside agent</button>} />
        )}
      </div>
    </>
  );
  // The Studio window trades the tab strip for an activity bar beside the work.
  return (
    <section className={studio ? "sf-surface sf-workbench sf-studio-window" : "sf-surface sf-workbench"} data-testid="salesforce-workbench" data-surface={studio ? "studio-window" : undefined}>
      <style>{SALESFORCE_STYLES}</style>
      {studio ? (
        <>
          {tabs}
          <div className="sf-studio-main">{workbench}</div>
        </>
      ) : workbench}
    </section>
  );
}
