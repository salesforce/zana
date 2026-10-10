import { useSalesforceControl, controlText } from '../useSalesforceControl.js';
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
            <EmptyState art="data" title="Inspect a Salesforce record">
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
  useSalesforceControl({ pluginId: props.pluginId, projectId: props.projectId, orgAlias: props.orgAlias, threadId: props.threadId, surface: 'apex',
    commands: ['state', 'view.open', 'form.set'], state: () => ({ tab, className, body, busy }),
    execute: ({ command, input }) => {
      if (command === 'view.open') { if (!['tests', 'logs', 'lwc', 'anonymous'].includes(String(input.tab))) throw Error('Choose tests, logs, lwc or anonymous.'); setTab(input.tab as typeof tab); }
      if (command === 'form.set') {
        if (busy || input.expectedBody !== body || input.expectedClassName !== className) throw Error('Read current form state before replacing it.');
        if (input.body !== undefined) setBody(controlText(input, 'body', 20_000));
        if (input.className !== undefined) setClass(controlText(input, 'className', 160));
      }
    },
  });

  // Anonymous Apex runs from the panel once the operator approves the resolved org and the exact code.
  const [review, setReview] = useState<{ body: string; org: Pick<PublicOrgView, "alias" | "kind" | "orgId"> } | null>(null);
  async function reviewAnonymous() {
    setBusy(true);
    setError(null);
    try {
      const { org } = requireResult<{ org?: Pick<PublicOrgView, "alias" | "kind" | "orgId"> }>(await call("apex.anonymous.target"));
      if (!org?.orgId) throw new Error("Select a connected org before running anonymous Apex.");
      setReview({ body, org });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  async function runAnonymous() {
    if (!review) return;
    setBusy(true);
    setError(null);
    try {
      requireResult(await call("apex.anonymous.run", { body: review.body, approvedOrgId: review.org.orgId }));
      setReview(null);
      setRevision((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const lwc = useResource<{ data: Array<{ name: string }> }>(
    call,
    tab === "lwc" ? "lwc.scan" : null,
  );
  async function start(kind: OperationKind) {
    setBusy(true);
    setError(null);
    try {
      requireResult(
        await call("operations.start", { kind, className, component: className }),
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
          setReview(null);
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
                if (tab === "anonymous") void reviewAnonymous();
                else void start(tab === "lwc" ? "lwc.test" : "apex.test");
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
                    onChange={(event) => { setBody(event.target.value); setReview(null); }}
                    spellCheck={false}
                    readOnly={busy && Boolean(review)}
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
              {tab === "anonymous" && review ? (
                <div className="sf-apex-review" role="group" aria-label="Approve anonymous Apex">
                  <div className="sf-apex-review-head"><strong>Run on</strong><OrgBadge org={review.org} /></div>
                  {review.org.kind !== "sandbox" && review.org.kind !== "scratch" && (
                    <p className="sf-apex-review-warning" role="alert">
                      {review.org.kind === "production"
                        ? "This is a production org. Anonymous Apex can change live data."
                        : "This org's type is unknown. Anonymous Apex can change its data."}
                    </p>
                  )}
                  <pre className="sf-apex-review-code" aria-label="Code to run">{review.body}</pre>
                  <div className="sf-control-row">
                    <button className="sf-btn primary" type="button" disabled={busy} onClick={() => void runAnonymous()}>
                      {busy ? "Running…" : `Run on ${review.org.alias}`}
                    </button>
                    <button className="sf-btn quiet" type="button" disabled={busy} onClick={() => setReview(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div>
                  <button
                    className="sf-btn primary"
                    disabled={busy || !(tab === "anonymous" ? body.trim() : className.trim())}
                  >
                    {busy
                      ? "Starting…"
                      : tab === "anonymous"
                        ? "Review and run"
                        : "Run targeted tests"}
                  </button>
                </div>
              )}
              <p className="sf-muted sf-small">
                {tab === "anonymous"
                  ? "You confirm the target org and code before it runs. Results appear in Activity."
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
