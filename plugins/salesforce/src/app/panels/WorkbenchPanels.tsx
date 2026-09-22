import { useId, useState } from "react";
import type { PublicOrgView } from "../../../lib/types.js";
import type {
  SalesforceResource,
  WorkbenchStatus,
  OperationKind,
} from "../../../lib/workbench-contract.js";
import type { SoqlSObjectDescribe } from "../../../lib/soql-describe.js";
import { useSalesforceCall, requireResult } from "../components/client.js";
import { useResource } from "../components/use-resource.js";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  ObjectInspector,
  OrgBadge,
  RecordInspector,
  SalesforcePanelFrame,
} from "../components/ui.js";
import { SalesforceTabs } from "../components/Tabs.js";
import { useSalesforceDraft } from "../components/drafts.js";
import { OrgPicker } from "../OrgPicker.js";
import { DebugLogsPanel } from "./DebugLogsPanel.js";
import { OperationsPanel } from "./OperationsPanel.js";
export { OperationsPanel } from "./OperationsPanel.js";
export { DeploymentsPanel } from "./DeploymentsPanel.js";
import { needsOperationThread, operationReviewDraft } from "../operation-review.js";

export interface SalesforcePanelProps extends SalesforceResource {
  pluginId: string;
  threadId?: string;
  onAddToPrompt?(text: string): void;
}

export function OrgContextPanel(props: SalesforcePanelProps) {
  const call = useSalesforceCall(props.pluginId, props, props.threadId);
  const state = useResource<WorkbenchStatus>(call, "status");
  return (
    <SalesforcePanelFrame title="Org context">
      <div className="sf-scroll sf-content">
        {state.error && (
          <ErrorState
            message={state.error}
            retry={() => void state.refresh()}
          />
        )}
        {state.busy && !state.data && <LoadingState />}
        {state.data && (
          <>
            <h3>{state.data.projectName || "Shared Salesforce context"}</h3>
            <p className="sf-muted">
              {state.data.targetSource === "project"
                ? "Target for this project"
                : state.data.targetSource === "override"
                  ? "Pinned target for this tool"
                  : "Inherited shared target"}
            </p>
            {props.orgAlias ? (
              <p>{props.orgAlias}</p>
            ) : (
              <OrgPicker
                pluginId={props.pluginId}
                projectId={props.projectId}
                onSelect={() => void state.refresh()}
              />
            )}
            <dl className="sf-definition">
              <div>
                <dt>Project folder</dt>
                <dd>{state.data.projectRoot || "Not configured"}</dd>
              </div>
              <div>
                <dt>API version</dt>
                <dd>{state.data.apiVersion}</dd>
              </div>
              <div>
                <dt>Salesforce DX</dt>
                <dd>{state.data.dxProject ? "Detected" : "Not detected"}</dd>
              </div>
            </dl>
          </>
        )}
      </div>
    </SalesforcePanelFrame>
  );
}

export function RecordPanel(props: SalesforcePanelProps) {
  const call = useSalesforceCall(props.pluginId, props, props.threadId);
  const [objectName, setObject] = useState(props.objectName || "Account");
  const [id, setId] = useState(props.recordId || "");
  const [target, setTarget] = useState(
    props.recordId ? { objectName, recordId: props.recordId } : null,
  );
  const state = useResource<{
    record: Record<string, unknown>;
    org: PublicOrgView;
  }>(call, target ? "records.get" : null, target ?? {});
  return (
    <SalesforcePanelFrame title="Record inspector">
      <form
        className="sf-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          setTarget({ objectName, recordId: id });
        }}
      >
        <input
          className="sf-input"
          aria-label="Record object"
          value={objectName}
          onChange={(event) => setObject(event.target.value)}
        />
        <input
          className="sf-input"
          aria-label="Record id"
          placeholder="Salesforce record id"
          value={id}
          onChange={(event) => setId(event.target.value)}
        />
        <button className="sf-btn" disabled={state.busy || !id}>
          Inspect
        </button>
      </form>
      <div className="sf-scroll">
        {state.error && (
          <ErrorState
            message={state.error}
            retry={() => void state.refresh()}
          />
        )}
        {state.busy && <LoadingState />}
        {state.data ? (
          <RecordInspector
            {...state.data}
            onAddToPrompt={props.onAddToPrompt}
          />
        ) : (
          !state.busy &&
          !state.error && (
            <EmptyState title="Inspect a Salesforce record">
              Open a record from query results, or enter its object and id.
            </EmptyState>
          )
        )}
      </div>
    </SalesforcePanelFrame>
  );
}

export function ObjectPanel(props: SalesforcePanelProps) {
  const call = useSalesforceCall(props.pluginId, props, props.threadId);
  const [name, setName] = useState(props.objectName || "Account");
  const [selected, setSelected] = useState(name);
  const state = useResource<{ describe: SoqlSObjectDescribe }>(
    call,
    "soql.describeSObject",
    { sobject: selected },
  );
  return (
    <SalesforcePanelFrame title="Object inspector">
      <form
        className="sf-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          setSelected(name);
        }}
      >
        <input
          className="sf-input"
          aria-label="Object API name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button className="sf-btn" disabled={!name || state.busy}>
          Inspect
        </button>
      </form>
      <div className="sf-scroll">
        {state.error && (
          <ErrorState
            message={state.error}
            retry={() => void state.refresh()}
          />
        )}
        {state.busy && <LoadingState />}
        {state.data && <ObjectInspector describe={state.data.describe} />}
      </div>
    </SalesforcePanelFrame>
  );
}

export function ApexPanel(props: SalesforcePanelProps) {
  const panelId = useId();
  const draftKey = `${props.projectId ?? "global"}:${props.threadId ?? "project"}:apex`;
  const call = useSalesforceCall(props.pluginId, props, props.threadId);
  const [tab, setTab] = useState<"tests" | "logs" | "lwc" | "anonymous">(
    props.logId ? "logs" : "tests",
  );
  const [className, setClass] = useSalesforceDraft(`${draftKey}:class`);
  const [body, setBody] = useSalesforceDraft(`${draftKey}:body`);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lwc = useResource<{ data: Array<{ name: string }> }>(
    call,
    tab === "lwc" ? "lwc.scan" : null,
  );
  async function start(kind: OperationKind) {
    if (!props.threadId && needsOperationThread(kind)) {
      props.onAddToPrompt?.(operationReviewDraft(kind, props.orgAlias, { body }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      requireResult(
        await call("operations.start", {
          kind,
          className,
          body,
          component: className,
        }),
      );
      setRevision((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <SalesforcePanelFrame>
      <SalesforceTabs
        label="Code tools"
        panelId={panelId}
        value={tab}
        onChange={(value) => {
          setTab(value);
          setError(null);
        }}
        items={[
          ["tests", "Tests"],
          ["logs", "Debug logs"],
          ["lwc", "LWC"],
          ["anonymous", "Anonymous Apex"],
        ]}
      />
      <div
        className="sf-apex-content"
        id={panelId}
        role="tabpanel"
        aria-labelledby={`${panelId}-${tab}`}
      >
        {error && <ErrorState message={error} />}
        {tab === "logs" ? <DebugLogsPanel {...props} /> : (
          <div className="sf-workspace sf-apex-workspace">
          <div className="sf-workspace-config">
            <div className="sf-workspace-heading"><div><span className="sf-eyebrow">{tab === 'anonymous' ? 'Apex execution' : 'Targeted testing'}</span><h2>{tab === 'anonymous' ? 'Run anonymous Apex' : tab === 'lwc' ? 'Test a component' : 'Run Apex tests'}</h2></div></div>
            <div className="sf-target-strip"><span>Target org</span><strong>{props.orgAlias || 'Project default'}</strong></div>
            <form
              className="sf-form sf-apex-form"
              onSubmit={(event) => {
                event.preventDefault();
                void start(
                  tab === "anonymous"
                    ? "apex.anonymous"
                    : tab === "lwc"
                      ? "lwc.test"
                      : "apex.test",
                );
              }}
            >
              <label>
                {tab === "anonymous"
                  ? "Anonymous Apex"
                  : tab === "lwc"
                    ? "LWC component"
                    : "Apex test class"}
                {tab === "anonymous" ? (
                  <textarea
                    className="sf-input"
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    spellCheck={false}
                  />
                ) : (
                  <input
                    className="sf-input"
                    placeholder={
                      tab === "lwc" ? "orderSummary" : "OrderServiceTest"
                    }
                    value={className}
                    onChange={(event) => setClass(event.target.value)}
                    list={tab === "lwc" ? "sf-lwc-options" : undefined}
                  />
                )}
              </label>
              {lwc.error && <ErrorState message={lwc.error} />}
              <datalist id="sf-lwc-options">
                {lwc.data?.data.map((row) => (
                  <option key={row.name} value={row.name} />
                ))}
              </datalist>
              <div>
                <button
                  className="sf-btn primary"
                  disabled={
                    busy || (tab === "anonymous" && !props.threadId && !props.onAddToPrompt) ||
                    !(tab === "anonymous" ? body.trim() : className.trim())
                  }
                >
                  {busy
                    ? "Starting…"
                    : tab === "anonymous"
                      ? props.threadId ? "Review and run" : "Continue in a thread"
                      : "Run targeted tests"}
                </button>
              </div>
              <p className="sf-muted sf-small">
                {tab === "anonymous"
                  ? "Anonymous Apex requires approval in a thread. Your code and selected org will be carried into the review."
                  : "Run only the selected class or component. Results stay in this panel's history."}
              </p>
            </form>
          </div>
          <OperationsPanel {...props} revision={revision} scope="apex" />
          </div>
        )}
      </div>
    </SalesforcePanelFrame>
  );
}
