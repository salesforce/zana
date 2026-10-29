import { useSalesforceControl } from './useSalesforceControl.js';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Settings2, Plus, CloudDownload, ChevronDown } from 'lucide-react';
import {
  Database,
  FlaskConical,
  Package,
  Bot,
  ArrowUpRight,
  CircleCheck,
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
import { OrgSyncDialog } from "./OrgSyncDialog.js";
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

import { SALESFORCE_SECTIONS, SalesforceSectionLauncher } from './SalesforceSectionLauncher.js';
import { openSalesforceTools } from './salesforce-tools-link.js';
import { useContextChangeRelay } from './context-sync.js';
import { recordRecentAgent } from './recent-agents.js';
import { studioAgentResource } from './studio-window-route.js';
import { projectViewStorageKey, readProjectView, rememberProjectView } from './project-view.js';

export { readProjectView } from './project-view.js';

const VIEWS: Array<[WorkbenchView, string]> = SALESFORCE_SECTIONS.map(({ id, label }) => [id, label]);

/** The Studio window is Agentforce only: general Salesforce tools live in the main window's tab. */
const STUDIO_ONLY: WorkbenchView = "agentforce";
const STUDIO_REFUSAL = "The Studio window shows Agentforce only; use the Salesforce tab in the main window.";
const DETACHED_REFUSAL = "Agentforce Studio is open in its own window; use view.open there, or bring it back to this tab.";

/**
 * The Studio window's title: the open agent and the org, and a badge when the org is
 * production or of unknown kind, so a risky window reads as one in the OS window list too.
 */
export function studioWindowTitle(input: { agentPath: string | null; alias: string; orgKind?: string }): ZccWindowTitle {
  const agent = input.agentPath ? input.agentPath.split("/").pop()?.replace(/\.agent$/i, "") : "";
  const title = agent ? `Agentforce · ${agent}` : "Agentforce";
  const risk: Pick<ZccWindowTitle, "badge" | "tone"> | null = input.orgKind === "production" ? { badge: "Production", tone: "danger" }
    : input.orgKind === "unknown" ? { badge: "Unknown org", tone: "warning" } : null;
  return { title, ...(input.alias ? { detail: input.alias } : {}), ...(input.alias && risk ? risk : {}) };
}

/** Set by the detached card: the Studio runs in its own window, so this tab keeps only the general tools. */
export interface DetachedStudioHost {
  /** Notice shown above the tools (what is open, Show window, Bring back). */
  notice: ReactNode;
  /** Brings the Studio window forward. */
  focusWindow(): void;
}

export function SalesforceProjectTab(props: {
  pluginId: string;
  projectId: string;
  headerActions?: ReactNode;
  detached?: DetachedStudioHost;
}) {
  useContextChangeRelay();
  const panelId = useId();
  const navigate = useZccNavigate();
  const context = useZccContext();
  const studio = context.surface === "plugin-view";
  const resourceId = studioAgentResource(context.resourceId);
  const call = useSalesforceCall(
    props.pluginId,
    props,
    context.threadId ?? undefined,
  );
  const status = useResource<WorkbenchStatus>(call, "status");
  const detached = props.detached;
  // The Studio window shows Agentforce only; a detached tab hides it (the Studio window has it).
  const views = studio ? VIEWS.filter(([id]) => id === STUDIO_ONLY) : detached ? VIEWS.filter(([id]) => id !== STUDIO_ONLY) : VIEWS;
  const fit = (stored: WorkbenchView): WorkbenchView => views.some(([id]) => id === stored) ? stored : views[0][0];
  const [viewState, setViewState] = useState<WorkbenchView>(() => readProjectView(props.projectId, studio));
  const view = fit(viewState);
  const [navigationTarget, setNavigationTarget] = useState<HTMLDivElement | null>(null);
  // Keep visited Studio sessions mounted while using the general tools. Runs, drafts and iframe survive.
  const [agentforceProject, setAgentforceProject] = useState<string | null>(() => view === 'agentforce' ? props.projectId : null);
  useEffect(() => { if (view === 'agentforce') setAgentforceProject(props.projectId); }, [view, props.projectId]);
  useEffect(() => {
    if (studio) return;
    const changed = (event: StorageEvent) => {
      if (event.key === projectViewStorageKey(props.projectId)) setViewState(readProjectView(props.projectId));
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [studio, props.projectId]);
  // An agent opened from a card in another window; cleared on leaving Agents so a later visit restores the last file.
  const [agentFocus, setAgentFocus] = useState<StudioFocus | null>(() => resourceId ? { path: resourceId } : null);
  const focusSeq = useRef(0);
  useEffect(() => {
    if (resourceId) { setViewState('agentforce'); setAgentFocus({ path: resourceId, nonce: ++focusSeq.current }); }
  }, [resourceId, context.resourceRequestId]);
  const setView = (next: WorkbenchView) => {
    setViewState(next);
    if (next !== "agentforce") setAgentFocus(null);
    if (!studio) rememberProjectView(props.projectId, next, studio);
  };
  const [orgsOpen, setOrgsOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [loginRequest, setLoginRequest] = useState(0);
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosenTarget, setChosenTarget] = useState<{ projectId: string; alias: string } | null>(null);
  const doctorGeneration = useRef(0);
  useEffect(() => {
    setDoctor(null);
    setViewState(readProjectView(props.projectId, studio));
    setAgentFocus(resourceId ? { path: resourceId } : null);
    setOrgsOpen(false);
    setSyncOpen(false);
    setLoginRequest(0);
  }, [props.projectId, studio]);
  const alias = chosenTarget?.projectId === props.projectId ? chosenTarget.alias : status.data?.selectedAlias || status.data?.defaultOrg || "";
  useEffect(() => { setChosenTarget(null); }, [props.projectId, status.data]);
  const selected = (alias: string) => setChosenTarget({ projectId: props.projectId, alias });
  useSalesforceControl({ pluginId: props.pluginId, projectId: props.projectId, orgAlias: alias || undefined, threadId: context.threadId ?? undefined, surface: 'workbench',
    commands: ['state', 'view.open'], state: () => ({ view, orgAlias: alias, ...(studio && resourceId ? { resourceId, path: resourceId } : {}) }),
    execute: ({ command, input, user }) => {
      if (command === 'state') return;
      const next = VIEWS.find(([id]) => id === input.view);
      if (!next) throw Error('Choose overview, data, apex, deployments or agentforce.');
      if (studio && next[0] !== STUDIO_ONLY) throw Error(STUDIO_REFUSAL);
      if (detached && next[0] === STUDIO_ONLY) throw Error(DETACHED_REFUSAL);
      if (input.path === undefined && input.line === undefined) { setView(next[0]); return; }
      // Only the person's own card may open a file here; a thread uses file.open, which the Studio holds while they type.
      if (!user) throw Error('Open the file with file.open on the agentforce view.');
      const focus = parseAgentforcePanelFocus({ path: input.path, line: input.line });
      if (next[0] !== 'agentforce' || !focus.path) throw Error('Provide an agent path for the agentforce view.');
      if (studio && resourceId && studioAgentResource(focus.path) !== resourceId) throw Error('This window belongs to another AgentScript. Open that agent in its own window.');
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
  const [agentPath, setAgentPathState] = useState<string | null>(null);
  // The Salesforce hub lists agents opened here so it can reopen them.
  const setAgentPath = useCallback((path: string | null) => {
    setAgentPathState(path);
    if (path) recordRecentAgent(props.projectId, path);
  }, [props.projectId]);
  // An org the CLI no longer lists is of unknown kind, so it gets the warning too.
  useWindowTitle(studio ? studioWindowTitle({ agentPath, alias, orgKind: org?.kind ?? (status.data ? "unknown" : undefined) }) : null);
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
  const refreshConnection = async () => {
    // The org roster is cached until sign-in; drop it so orgs added or removed from a terminal show up.
    await call('orgs', { refresh: true }).catch(() => undefined);
    window.dispatchEvent(new CustomEvent('sf:context-changed', { detail: { projectId: props.projectId } }));
  };
  const connectionGuidance = <SalesforceState compact kind={readiness.kind === 'unavailable' ? 'error' : 'empty'} title={readiness.title}
    action={<>
      <button className="sf-btn primary" type="button" onClick={() => setLoginRequest(value => value + 1)}>Sign in to an org</button>
      <button className="sf-btn" type="button" onClick={() => setOrgsOpen(true)}>Choose an existing org</button>
      <button className="sf-btn quiet" type="button" disabled={status.busy} onClick={() => void refreshConnection()}>Check again</button>
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
  const orgActions = <>
    <button type="button" className="icon-btn sf-section-org-summary" aria-label="Choose Salesforce org" onClick={() => setOrgsOpen(true)}>
      <span>{alias || 'Choose an org'}</span><ChevronDown size={13} aria-hidden="true" />
    </button>
          <button
            className="icon-btn"
            type="button"
            title={alias ? "Fetch latest from org" : "Choose an org to fetch from"}
            aria-label="Fetch latest from org"
            disabled={!alias}
            onClick={() => setSyncOpen(true)}
          >
            <CloudDownload size={15} aria-hidden="true" /><span className="sf-org-action-label">Fetch latest</span>
          </button>
          <button
            className="icon-btn"
            type="button"
            title="Connect org"
            aria-label="Connect org"
            onClick={() => setLoginRequest(value => value + 1)}
          >
            <Plus size={15} aria-hidden="true" /><span className="sf-org-action-label">Connect org</span>
          </button>
          <button
            className="icon-btn"
            type="button"
            title="Org details"
            aria-label="Org details"
            onClick={() => setOrgsOpen(value => !value)}
            aria-expanded={Boolean(orgsOpen)}
          >
            <Settings2 size={15} aria-hidden="true" /><span className="sf-org-action-label">Org details</span>
          </button>
  </>;
  const workbench = (
    <>
      <header className="sf-workbench-toolbar">
        <SalesforceSectionLauncher value={view} actions={orgActions}
          external={studio ? VIEWS.filter(([id]) => id !== STUDIO_ONLY).map(([id]) => id) : []}
          onSelect={next => {
            if (studio && next !== STUDIO_ONLY) openSalesforceTools(navigate, props.projectId, next);
            else if (detached && next === STUDIO_ONLY) detached.focusWindow();
            else setView(next);
          }} />
        <div ref={setNavigationTarget} className="sf-workbench-agent-tabs" hidden={view !== 'agentforce'} data-testid="salesforce-navigation-tabs" />
        {view !== 'agentforce' && <span className="sf-workbench-section-detail">{SALESFORCE_SECTIONS.find(section => section.id === view)!.detail}</span>}
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
          <div className="sf-workbench-org-actions">{orgActions}</div>
          {props.headerActions}
        </div>
      </header>
      {syncOpen && alias && (
        <OrgSyncDialog
          key={`${props.projectId}:${alias}`}
          call={call}
          rememberKey={`salesforce:sync-pick:${props.projectId}`}
          onClose={() => setSyncOpen(false)}
        />
      )}
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
        role="region"
        aria-label={VIEWS.find(([id]) => id === view)![1]}
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
                      onClick={() => (id === "agentforce" && detached ? detached.focusWindow() : setView(id))}
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
        {(view === 'agentforce' || agentforceProject === props.projectId) && !detached && (
          <div className="sf-workbench-studio" hidden={view !== 'agentforce'}>
            <AgentforcePlaygroundPanel pluginId={props.pluginId} projectId={props.projectId} params={agentFocus ?? undefined} orgPicker={false} navigationTarget={navigationTarget} onActivePath={setAgentPath} />
          </div>
        )}
      </div>
    </>
  );
  // The Studio window is the Agentforce Studio alone; the main window tab carries the tools.
  return (
    <section className={studio ? "sf-surface sf-workbench sf-studio-window" : "sf-surface sf-workbench"} data-testid="salesforce-workbench" data-surface={studio ? "studio-window" : undefined}>
      <style>{SALESFORCE_STYLES}</style>
      {detached?.notice}
      {studio ? <div className="sf-studio-main">{workbench}</div> : workbench}
    </section>
  );
}
