import { useEffect, useId, useState } from "react";
import type { PublicOrgView } from "../../../lib/types.js";
import type {
  SalesforceResource,
  SalesforceOperation,
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
  RunSummary,
  SalesforcePanelFrame,
} from "../components/ui.js";
import { SalesforceTabs } from "../components/Tabs.js";
import { useSalesforceDraft } from "../components/drafts.js";
import { OrgPicker } from "../OrgPicker.js";

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

export function OperationsPanel(
  props: SalesforcePanelProps & { revision?: number },
) {
  const call = useSalesforceCall(props.pluginId, props, props.threadId);
  const state = useResource<{ operations: SalesforceOperation[] }>(
    call,
    "operations.list",
  );
  const [selected, setSelected] = useState(props.operationId ?? "");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void state.refresh();
  }, [props.revision, state.refresh]);
  const running = state.data?.operations.some((row) => row.state === "running");
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void state.refresh(), 2000);
    return () => clearInterval(timer);
  }, [running, state.refresh]);
  const operation =
    state.data?.operations.find((row) => row.id === selected) ??
    state.data?.operations[0];
  return (
    <div className="sf-scroll" data-testid="salesforce-operations">
      {(state.error || error) && (
        <ErrorState
          message={state.error || error!}
          retry={() => void state.refresh()}
        />
      )}
      <div className="sf-toolbar">
        <strong>Recent operations</strong>
        <span className="sf-grow" />
        <button
          className="sf-btn quiet"
          type="button"
          onClick={() => void state.refresh()}
        >
          Refresh
        </button>
      </div>
      {state.data?.operations.length ? (
        <>
          <div className="sf-content">
            {state.data.operations.map((row) => (
              <div className="sf-row" key={row.id}>
                <button
                  className="sf-link sf-row-main"
                  type="button"
                  onClick={() => setSelected(row.id)}
                >
                  {row.title}
                  <small>
                    {row.kind} · {row.org.alias}
                  </small>
                </button>
                <span
                  className={`sf-badge ${row.state === "failed" ? "sf-error" : ""}`}
                >
                  {row.state}
                </span>
              </div>
            ))}
          </div>
          {operation && (
            <RunSummary
              operation={operation}
              onAddToPrompt={props.onAddToPrompt}
              onRefresh={
                operation.jobId
                  ? () => {
                      setError(null);
                      void call("operations.report", {
                        operationId: operation.id,
                      })
                        .then(requireResult)
                        .then(() => state.refresh())
                        .catch((err) => setError(String(err)));
                    }
                  : undefined
              }
            />
          )}
        </>
      ) : (
        <EmptyState title="No operations yet">
          Test and deployment results appear here. Closing a view keeps its
          operation available.
        </EmptyState>
      )}
    </div>
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
  const [logId, setLogId] = useState(props.logId ?? "");
  const logs = useResource<{
    data?: { records?: Record<string, unknown>[]; bodyPreview?: string };
  }>(call, tab === "logs" ? "apex.logs" : null);
  const log = useResource<{ body: string; truncated?: boolean }>(
    call,
    logId ? "logs.get" : null,
    { logId },
  );
  const lwc = useResource<{ data: Array<{ name: string }> }>(
    call,
    tab === "lwc" ? "lwc.scan" : null,
  );
  async function start(kind: OperationKind) {
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
    <SalesforcePanelFrame title="Apex & logs">
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
        className="sf-scroll"
        id={panelId}
        role="tabpanel"
        aria-labelledby={`${panelId}-${tab}`}
      >
        {error && <ErrorState message={error} />}
        {tab === "logs" ? (
          <div className="sf-content">
            {logs.error && (
              <ErrorState
                message={logs.error}
                retry={() => void logs.refresh()}
              />
            )}
            {logs.busy && <LoadingState />}
            {logs.data?.data?.records?.map((row) => (
              <div className="sf-row" key={String(row.Id)}>
                <button
                  className="sf-link sf-row-main"
                  type="button"
                  onClick={() => setLogId(String(row.Id))}
                >
                  {String(row.Operation)}
                  <small>{String(row.StartTime)}</small>
                </button>
                <span className="sf-badge">{String(row.Status)}</span>
              </div>
            ))}
            {logs.data && !logs.data.data?.records?.length && (
              <EmptyState title="No debug logs returned">
                Generate a log in the org and refresh.
              </EmptyState>
            )}
            {log.error && <ErrorState message={log.error} />}
            {log.data && (
              <>
                <pre className="sf-code">{log.data.body}</pre>
                {log.data.truncated && (
                  <p className="sf-muted">
                    Showing the first 64,000 characters.
                  </p>
                )}
                {props.onAddToPrompt && (
                  <button
                    className="sf-btn"
                    type="button"
                    onClick={() =>
                      props.onAddToPrompt?.(
                        `Apex log ${logId}\n${log.data!.body.slice(0, 8000)}`,
                      )
                    }
                  >
                    Add log excerpt to prompt
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="sf-content">
            <form
              className="sf-form"
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
                    busy ||
                    !(tab === "anonymous" ? body.trim() : className.trim())
                  }
                >
                  {busy
                    ? "Starting…"
                    : tab === "anonymous"
                      ? "Review and run"
                      : "Run targeted tests"}
                </button>
              </div>
              <p className="sf-muted sf-small">
                {tab === "anonymous"
                  ? "Anonymous Apex requires approval in a thread."
                  : "Run only the selected class or component. Results remain available below."}
              </p>
            </form>
          </div>
        )}
        {tab !== "logs" && <OperationsPanel {...props} revision={revision} />}
      </div>
    </SalesforcePanelFrame>
  );
}

export function DeploymentsPanel(props: SalesforcePanelProps) {
  const draftKey = `${props.projectId ?? "global"}:${props.threadId ?? "project"}:deploy`;
  const call = useSalesforceCall(props.pluginId, props, props.threadId);
  const [components, setComponents] = useSalesforceDraft(
    `${draftKey}:components`,
  );
  const [tests, setTests] = useSalesforceDraft(`${draftKey}:tests`);
  const [type, setType] = useState("ApexClass");
  const [browseType, setBrowseType] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const metadata = useResource<{
    records: Array<{ fullName: string }>;
    truncated?: boolean;
  }>(call, browseType ? "metadata.list" : null, { metadataType: browseType });
  const selected = components
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  async function run(kind: OperationKind) {
    setBusy(true);
    setError(null);
    try {
      requireResult(
        await call("operations.start", {
          kind,
          components: selected,
          tests: tests.split(/[\s,]+/).filter(Boolean),
        }),
      );
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <SalesforcePanelFrame title="Deployments">
      <div className="sf-scroll">
        <div className="sf-content">
          <h2>Review the change. Keep the context.</h2>
          <p className="sf-muted">
            Select explicit metadata, preview the changes, then validate or
            deploy.
          </p>
          {error && <ErrorState message={error} />}
          <div className="sf-toolbar">
            <select
              className="sf-select"
              aria-label="Metadata type"
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              {[
                "ApexClass",
                "ApexTrigger",
                "LightningComponentBundle",
                "CustomObject",
                "PermissionSet",
                "Flow",
              ].map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
            <button
              className="sf-btn"
              type="button"
              disabled={metadata.busy}
              onClick={() => {
                if (browseType === type) void metadata.refresh();
                else setBrowseType(type);
              }}
            >
              Browse org metadata
            </button>
          </div>
          {metadata.error && <ErrorState message={metadata.error} />}
          {metadata.data && (
            <div className="sf-table-wrap">
              <table className="sf-table">
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>Component</th>
                  </tr>
                </thead>
                <tbody>
                  {metadata.data.records.map((row) => (
                    <tr key={row.fullName}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.fullName}`}
                          checked={selected.includes(
                            `${browseType}:${row.fullName}`,
                          )}
                          onChange={(event) => {
                            const key = `${browseType}:${row.fullName}`;
                            setComponents(
                              (event.target.checked
                                ? [...selected, key]
                                : selected.filter((value) => value !== key)
                              ).join("\n"),
                            );
                          }}
                        />
                      </td>
                      <td>{row.fullName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {metadata.data.truncated && (
                <p className="sf-muted">Showing the first 200 components.</p>
              )}
            </div>
          )}
          <div className="sf-form">
            <label>
              Selected components
              <textarea
                className="sf-input"
                placeholder="ApexClass:OrderService"
                value={components}
                onChange={(event) => setComponents(event.target.value)}
              />
            </label>
            <label>
              Targeted Apex tests
              <input
                className="sf-input"
                placeholder="OrderServiceTest"
                value={tests}
                onChange={(event) => setTests(event.target.value)}
              />
            </label>
            <div className="sf-row">
              <button
                className="sf-btn"
                type="button"
                disabled={busy || !selected.length}
                onClick={() => void run("deploy.preview")}
              >
                Preview deployment
              </button>
              <button
                className="sf-btn"
                type="button"
                disabled={busy || !selected.length || !tests.trim()}
                onClick={() => void run("deploy.validate")}
              >
                Validate
              </button>
              <button
                className="sf-btn primary"
                type="button"
                disabled={busy || !selected.length || !tests.trim()}
                onClick={() => void run("deploy.start")}
              >
                Review and deploy
              </button>
            </div>
            <details>
              <summary>Retrieve from org</summary>
              <p className="sf-muted">
                Preview shows all tracked changes and conflicts. Retrieval
                writes the selected components into this project and requires
                approval in a thread.
              </p>
              <div className="sf-row">
                <button
                  className="sf-btn"
                  type="button"
                  disabled={busy}
                  onClick={() => void run("retrieve.preview")}
                >
                  Preview tracked changes
                </button>
                <button
                  className="sf-btn"
                  type="button"
                  disabled={busy || !selected.length}
                  onClick={() => void run("retrieve.start")}
                >
                  Review and retrieve selected
                </button>
              </div>
            </details>
          </div>
        </div>
        <OperationsPanel {...props} revision={revision} />
      </div>
    </SalesforcePanelFrame>
  );
}
