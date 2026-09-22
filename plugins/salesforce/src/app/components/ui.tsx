import { useState, type ReactNode } from "react";
import type { PublicOrgView, PublicListedOrg } from "../../../lib/types.js";
import type { SoqlSObjectDescribe } from "../../../lib/soql-describe.js";
import type { SalesforceOperation } from "../../../lib/workbench-contract.js";
import { SALESFORCE_STYLES } from "./styles.js";
import { OperationResults } from "./OperationResults.js";
import { OPERATION_LABELS, displayTime } from '../panels/workbench-presentation.js';

export function SalesforcePanelFrame({
  title,
  actions,
  children,
  footer,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="sf-surface">
      <style>{SALESFORCE_STYLES}</style>
      {title && (
        <header className="sf-header">
          <strong>{title}</strong>
          <span className="sf-grow" />
          {actions}
        </header>
      )}
      {children}
      {footer && <footer className="sf-footer">{footer}</footer>}
    </section>
  );
}
export function OrgBadge({
  org,
}: {
  org: Pick<PublicOrgView, "alias" | "kind"> | null;
}) {
  return org ? (
    <span className="sf-badge" data-kind={org.kind}>
      {org.alias} · {org.kind}
    </span>
  ) : (
    <span className="sf-badge">No org selected</span>
  );
}
export function OrgSwitcher({
  orgs,
  value,
  disabled,
  onChange,
}: {
  orgs: PublicListedOrg[];
  value: string;
  disabled?: boolean;
  onChange(alias: string): void;
}) {
  return (
    <select
      className="sf-org-picker"
      aria-label="Salesforce org"
      data-testid="salesforce-org-picker"
      value={value}
      disabled={disabled || !orgs.length}
      onChange={(event) => onChange(event.target.value)}
    >
      {!value && (
        <option value="">
          {orgs.length ? "Choose an org" : "No connected orgs"}
        </option>
      )}
      {value && !orgs.some((org) => (org.alias || org.username) === value) && (
        <option value={value}>{value} (not in connected list)</option>
      )}
      {orgs.map((org) => (
        <option
          key={org.alias || org.username}
          value={org.alias || org.username}
        >
          {org.alias || org.username} ({org.kind})
        </option>
      ))}
    </select>
  );
}
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="sf-empty">
      <strong>{title}</strong>
      {children && <div>{children}</div>}
      {action}
    </div>
  );
}
export function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="sf-notice" role="alert">
      {message}{" "}
      {retry && (
        <button className="sf-btn quiet" type="button" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
export function LoadingState({
  label = "Loading Salesforce…",
}: {
  label?: string;
}) {
  return (
    <div className="sf-empty" role="status">
      {label}
    </div>
  );
}

export function RecordInspector({
  record,
  org,
  onAddToPrompt,
}: {
  record: Record<string, unknown>;
  org?: Pick<PublicOrgView, "alias" | "kind">;
  onAddToPrompt?(text: string): void;
}) {
  const [search, setSearch] = useState("");
  const fields = Object.entries(record).filter(
    ([key]) =>
      key !== "attributes" && key.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="sf-inspector">
      <h3>{String(record.Name ?? record.Id ?? "Record")}</h3>
      {org && <OrgBadge org={org} />}
      <p className="sf-muted sf-small">Read only · {fields.length} fields</p>
      <input
        className="sf-input"
        aria-label="Find record field"
        placeholder="Find a field…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <dl className="sf-definition">
        {fields.map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>
              {value == null
                ? "—"
                : typeof value === "object"
                  ? JSON.stringify(value)
                  : String(value)}
            </dd>
          </div>
        ))}
      </dl>
      {onAddToPrompt && (
        <button
          className="sf-btn"
          type="button"
          onClick={() =>
            onAddToPrompt(
              `${org?.alias ?? "Salesforce"} record ${record.Id ?? ""}:\n${JSON.stringify(Object.fromEntries(fields), null, 2).slice(0, 8000)}`,
            )
          }
        >
          Add displayed fields to prompt
        </button>
      )}
    </div>
  );
}
export function ObjectInspector({
  describe,
  onSelectField,
}: {
  describe: SoqlSObjectDescribe;
  onSelectField?(name: string): void;
}) {
  const [search, setSearch] = useState("");
  return (
    <div className="sf-inspector">
      <h3>{describe.label || describe.name}</h3>
      <p className="sf-muted sf-small">
        {describe.name} · {describe.fields.length} fields
      </p>
      <input
        className="sf-input"
        aria-label="Find object field"
        placeholder="Find a field…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="sf-table-wrap">
        <table className="sf-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {describe.fields
              .filter((field) =>
                `${field.name} ${field.label}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((field) => (
                <tr key={field.name}>
                  <td>
                    {onSelectField ? (
                      <button
                        type="button"
                        className="sf-link"
                        onClick={() => onSelectField(field.name)}
                      >
                        {field.name}
                      </button>
                    ) : (
                      field.name
                    )}
                  </td>
                  <td>
                    {field.type}
                    {field.referenceTo.length
                      ? ` → ${field.referenceTo.join(", ")}`
                      : ""}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
export function RunSummary({
  operation,
  onRefresh,
  onAddToPrompt,
  refreshBusy,
}: {
  operation: SalesforceOperation;
  onRefresh?(): void;
  onAddToPrompt?(text: string): void;
  refreshBusy?: boolean;
}) {
  return (
    <div className="sf-inspector sf-run-summary">
      <div className="sf-run-heading"><span className="sf-eyebrow">{OPERATION_LABELS[operation.kind]}</span><span className="sf-grow" />
      <span
        className={`sf-badge ${operation.state === "failed" ? "sf-error" : operation.state === "succeeded" ? "sf-success" : ""}`}
      >
        {operation.state}
      </span>
      </div>
      <h3>{operation.title}</h3>
      <OrgBadge org={operation.org} />
      <span className="sf-muted sf-small"> · {displayTime(operation.at)}</span>
      <p>{operation.summary}</p>
      {operation.jobId && (
        <p className="sf-small sf-muted">Job {operation.jobId}</p>
      )}
      <div className="sf-toolbar">
        {onRefresh && (
          <button className="sf-btn" type="button" disabled={refreshBusy} onClick={onRefresh}>
            {refreshBusy ? 'Refreshing…' : 'Refresh report'}
          </button>
        )}
        {onAddToPrompt && (
          <button
            className="sf-btn"
            type="button"
            onClick={() =>
              onAddToPrompt(
                `${operation.kind} · ${operation.org.alias}\n${operation.summary ?? ""}\n${JSON.stringify(operation.data, null, 2)?.slice(0, 8000) ?? ""}`,
              )
            }
          >
            Add result to prompt
          </button>
        )}
      </div>
      <OperationResults
        key={operation.id}
        operation={operation}
        onAddToPrompt={onAddToPrompt}
      />
    </div>
  );
}
