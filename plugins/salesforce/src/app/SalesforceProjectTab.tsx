import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  Cloud,
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
import { OrgPicker } from "./OrgPicker.js";
import { SALESFORCE_STYLES } from "./components/styles.js";
import { requireResult, useSalesforceCall } from "./components/client.js";
import { useResource } from "./components/use-resource.js";
import {
  EmptyState,
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
import { AgentforcePreviewPanel } from "./AgentforcePreviewPanel.js";

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
  const [agentTool, setAgentTool] = useState<"playground" | "preview">(
    "playground",
  );
  const [orgsOpen, setOrgsOpen] = useState(false);
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const doctorGeneration = useRef(0);
  useEffect(() => {
    setDoctor(null);
    setView("overview");
  }, [props.projectId]);
  const alias = status.data?.selectedAlias || status.data?.defaultOrg || "";
  useLayoutEffect(() => {
    doctorGeneration.current++;
    setDoctor(null);
    setChecking(false);
    setError(null);
    return () => {
      doctorGeneration.current++;
    };
  }, [props.projectId, alias]);
  const org = status.data?.orgs?.find(
    (row) => row.alias === alias || row.username === alias,
  );
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
    <section className="sf-surface" data-testid="salesforce-workbench">
      <style>{SALESFORCE_STYLES}</style>
      <header className="sf-header">
        <Cloud />
        <strong>Salesforce</strong>
        <span className="sf-muted sf-small">{status.data?.projectName}</span>
        <span className="sf-grow" />
        <OrgPicker
          pluginId={props.pluginId}
          projectId={props.projectId}
          compact
          onSelect={() => {
            setDoctor(null);
            void status.refresh();
          }}
        />
        <button
          className="sf-btn quiet"
          type="button"
          onClick={() => setOrgsOpen((value) => !value)}
          aria-expanded={orgsOpen}
        >
          Org details
        </button>
      </header>
      {orgsOpen && (
        <div
          className="sf-scroll sf-content"
          style={{ flex: "0 1 auto", maxHeight: 360 }}
        >
          <OrgPicker
            pluginId={props.pluginId}
            projectId={props.projectId}
            onSelect={() => void status.refresh()}
          />
        </div>
      )}
      <SalesforceTabs<WorkbenchView>
        label="Salesforce tools"
        items={VIEWS}
        value={view}
        onChange={setView}
        panelId={panelId}
      />
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
              <LoadingState />
            ) : (
              <>
                <h2>
                  {alias
                    ? "Ready for your next change."
                    : "Connect your Salesforce project."}
                </h2>
                <p className="sf-muted">
                  Your org, source, and development tools in one project.
                </p>
                <div className="sf-summary">
                  <CircleCheck />
                  <div className="sf-grow">
                    <strong>{alias || "Choose an org to get started"}</strong>
                    <div className="sf-muted sf-small">
                      {status.data?.dxProject
                        ? "Salesforce DX detected"
                        : "No sfdx-project.json in this project"}{" "}
                      ·{" "}
                      {status.data?.targetSource === "project"
                        ? "Project target"
                        : "Inherited shared target"}
                    </div>
                  </div>
                  <OrgBadge org={org ?? null} />
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
                {!alias && (
                  <EmptyState
                    title="Pick a connected org"
                    action={
                      <button
                        className="sf-btn primary"
                        type="button"
                        onClick={() => setOrgsOpen(true)}
                      >
                        Connect or select an org
                      </button>
                    }
                  >
                    The selected target applies to this project. Other projects
                    keep their own targets.
                  </EmptyState>
                )}
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
                        "Playground and simulated Preview",
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
                <div style={{ marginTop: 24 }}>
                  <OperationsPanel {...scoped} onAddToPrompt={investigate} />
                </div>
              </>
            )}
          </div>
        )}
        {view === "data" && (
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
          <>
            <div className="sf-toolbar">
              <button
                className="sf-btn"
                type="button"
                aria-pressed={agentTool === "playground"}
                onClick={() => setAgentTool("playground")}
              >
                Playground
              </button>
              <button
                className="sf-btn"
                type="button"
                aria-pressed={agentTool === "preview"}
                onClick={() => setAgentTool("preview")}
              >
                Preview
              </button>
              {context.threadId && (
                <button
                  className="sf-btn quiet"
                  type="button"
                  onClick={() =>
                    navigate.openThreadPanel({
                      actionId: agentTool,
                      params: { projectId: props.projectId, orgAlias: alias },
                    })
                  }
                >
                  Open beside agent
                </button>
              )}
            </div>
            {agentTool === "playground" ? (
              <AgentforcePlaygroundPanel {...props} />
            ) : (
              <AgentforcePreviewPanel {...scoped} />
            )}
          </>
        )}
      </div>
      <footer className="sf-footer">
        <span>
          {status.data?.targetSource === "project"
            ? "Project target"
            : "Shared fallback"}{" "}
          · {alias || "No org selected"}
        </span>
        <span className="sf-grow" />
        <span>{org?.kind ?? "Connection not checked"}</span>
      </footer>
    </section>
  );
}
