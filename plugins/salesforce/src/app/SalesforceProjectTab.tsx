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
} from "./components/icons.js";
import { useZccContext, useZccNavigate } from "@zana-ai/zcc-plugin-sdk/app";
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

import { SalesforceTabs } from "./components/Tabs.js";

const VIEWS: Array<[WorkbenchView, string]> = [
  ["overview", "Overview"],
  ["data", "Data"],
  ["apex", "Apex & logs"],
  ["deployments", "Deployments"],
  ["agentforce", "Agentforce"],
];

export function SalesforceProjectTab(props: {
  pluginId: string;
  projectId: string;
  headerActions?: ReactNode;
}) {
  const panelId = useId();
  const navigate = useZccNavigate();
  const context = useZccContext();
  const call = useSalesforceCall(
    props.pluginId,
    props,
    context.threadId ?? undefined,
  );
  const status = useResource<WorkbenchStatus>(call, "status");
  const [view, setView] = useState<WorkbenchView>("overview");
  const [orgsOpen, setOrgsOpen] = useState(false);
  const [loginRequest, setLoginRequest] = useState(0);
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosenTarget, setChosenTarget] = useState<{ projectId: string; alias: string } | null>(null);
  const doctorGeneration = useRef(0);
  useEffect(() => {
    setDoctor(null);
    setView("overview");
    setOrgsOpen(false);
    setLoginRequest(0);
  }, [props.projectId]);
  const alias = chosenTarget?.projectId === props.projectId ? chosenTarget.alias : status.data?.selectedAlias || status.data?.defaultOrg || "";
  useEffect(() => { setChosenTarget(null); }, [props.projectId, status.data]);
  const selected = (alias: string) => setChosenTarget({ projectId: props.projectId, alias });
  useSalesforceControl({ pluginId: props.pluginId, projectId: props.projectId, orgAlias: alias || undefined, threadId: context.threadId ?? undefined, surface: 'workbench',
    commands: ['state', 'view.open'], state: () => ({ view, orgAlias: alias }),
    execute: ({ command, input }) => {
      if (command === 'state') return;
      const next = VIEWS.find(([id]) => id === input.view);
      if (!next) throw Error('Choose overview, data, apex, deployments or agentforce.');
      setView(next[0]);
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
  return (
    <section className="sf-surface sf-workbench" data-testid="salesforce-workbench">
      <style>{SALESFORCE_STYLES}</style>
      <header className="sf-workbench-toolbar">
        <SalesforceTabs<WorkbenchView>
          label="Salesforce tools"
          items={VIEWS}
          value={view}
          onChange={setView}
          panelId={panelId}
        />
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
          <div className="sf-scroll sf-content">
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
                <div style={{ marginTop: 24, height: 420 }}>
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
          <AgentforcePlaygroundPanel pluginId={props.pluginId} projectId={props.projectId} orgPicker={false} headerActions={context.threadId && <button className="sf-as-save" type="button" onClick={() => navigate.openThreadPanel({ actionId: 'playground', params: { projectId: props.projectId, orgAlias: alias } })}>Open beside agent</button>} />
        )}
      </div>
    </section>
  );
}
