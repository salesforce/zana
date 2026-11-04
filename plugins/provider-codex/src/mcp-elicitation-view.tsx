// Adapted from BB's MCP elicitation contract under MIT; see docs/third-party/BB-LICENSE.
import { useId, useRef, useState } from "react";
import type { PluginPendingInteractionProps } from "@zana-ai/zcc-plugin-sdk/app";
import {
  codexMcpElicitationSchema,
  validateCodexMcpFormContent,
  type CodexMcpElicitationResponse,
  type CodexMcpFormField,
} from "./mcp-elicitation.js";
type Draft = string | boolean | string[];
const styles = `
.codex-mcp-elicitation{display:grid;gap:12px;min-width:0;color:var(--text-primary);font-size:13px}
.codex-mcp-elicitation p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.codex-mcp-elicitation .mcp-muted{color:var(--text-muted)}
.codex-mcp-elicitation .mcp-warning{padding:10px;border:1px solid var(--danger,#bd6767);border-radius:6px;background:color-mix(in srgb,var(--danger,#bd6767) 12%,transparent)}
.codex-mcp-elicitation fieldset{border:0;margin:0;padding:0;display:grid;gap:12px;min-width:0}
.codex-mcp-elicitation .mcp-field{display:grid;gap:6px;min-width:0}
.codex-mcp-elicitation input:not([type=radio]):not([type=checkbox]),.codex-mcp-elicitation select{box-sizing:border-box;width:100%;min-width:0;background:var(--bg-base);color:inherit;border:1px solid var(--border);border-radius:5px;padding:8px;font:inherit}
.codex-mcp-elicitation label{display:flex;align-items:center;gap:7px}
.codex-mcp-elicitation legend{padding:0;font-weight:600}
.codex-mcp-elicitation button,.codex-mcp-elicitation .mcp-link{border:1px solid var(--border);border-radius:5px;padding:6px 10px;background:var(--bg-raised);color:inherit;font:inherit;cursor:pointer}
.codex-mcp-elicitation button:disabled{opacity:.5;cursor:default}
.codex-mcp-elicitation button:focus-visible,.codex-mcp-elicitation input:focus-visible,.codex-mcp-elicitation select:focus-visible{outline:2px solid var(--accent,#8aa8ff);outline-offset:2px}
.codex-mcp-elicitation footer{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;position:sticky;bottom:0;padding-top:10px;background:var(--bg-base)}
.codex-mcp-elicitation .mcp-primary{background:var(--accent,#5874ba);color:var(--accent-contrast,#fff)}
.codex-mcp-elicitation [role=alert]{color:var(--danger,#e89494)}
.codex-mcp-elicitation dl{margin:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:6px}
.codex-mcp-elicitation dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.codex-mcp-elicitation code{overflow-wrap:anywhere}
`;
export function CodexMcpField({
  field,
  value,
  error,
  disabled,
  onChange,
}: {
  field: CodexMcpFormField;
  value: Draft | undefined;
  error?: string;
  disabled: boolean;
  onChange(value: Draft | undefined): void;
}) {
  const id = useId();
  const describedBy = `${id}-description ${id}-error`;
  return (
    <div className="mcp-field">
      <label htmlFor={id} id={`${id}-label`}>
        <strong>{field.title}</strong>
        {!field.required && <span className="mcp-muted">Optional</span>}
      </label>
      <p id={`${id}-description`} className="mcp-muted">
        {field.description}
      </p>
      {field.kind === "boolean" || field.kind === "enum" ? (
        <select
          id={id}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={!!error}
          value={
            value === undefined
              ? ""
              : field.kind === "boolean"
                ? String(value)
                : String(
                    field.options.findIndex((option) => option.value === value),
                  )
          }
          onChange={(event) =>
            onChange(
              event.target.value === ""
                ? undefined
                : field.kind === "boolean"
                  ? event.target.value === "true"
                  : field.options[Number(event.target.value)]!.value,
            )
          }
        >
          <option value="">Choose…</option>
          {field.kind === "boolean" ? (
            <>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </>
          ) : (
            field.options.map((option, index) => (
              <option key={option.value} value={index}>
                {option.label}
              </option>
            ))
          )}
        </select>
      ) : field.kind === "multi_enum" ? (
        <fieldset
          id={id}
          disabled={disabled}
          aria-labelledby={`${id}-label`}
          aria-describedby={describedBy}
          aria-invalid={!!error}
        >
          {field.options.map((option) => (
            <label key={option.value}>
              <input
                type="checkbox"
                checked={Array.isArray(value) && value.includes(option.value)}
                onChange={(event) => {
                  const selected = Array.isArray(value) ? value : [];
                  onChange(
                    event.target.checked
                      ? [...selected, option.value]
                      : selected.filter((entry) => entry !== option.value),
                  );
                }}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
      ) : (
        <input
          id={id}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={!!error}
          type={
            field.kind === "string" && field.format === "email"
              ? "email"
              : field.kind === "string" && field.format === "date"
                ? "date"
                : "text"
          }
          inputMode={
            field.kind === "number"
              ? "decimal"
              : field.kind === "integer"
                ? "numeric"
                : field.kind === "string" && field.format === "uri"
                  ? "url"
                  : undefined
          }
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {!field.required && value !== undefined && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(undefined)}
          aria-label={`Clear ${field.title}`}
        >
          Clear
        </button>
      )}
      <p id={`${id}-error`} role={error ? "alert" : undefined}>
        {error}
      </p>
    </div>
  );
}
export function CodexMcpElicitationView({
  interaction,
  submit,
  cancel,
}: PluginPendingInteractionProps) {
  const parsed = codexMcpElicitationSchema.safeParse(interaction.payload);
  const payload = parsed.success ? parsed.data : null;
  const [drafts, setDrafts] = useState<Map<string, Draft>>(
    () =>
      new Map(
        payload?.kind === "form"
          ? payload.fields.flatMap((field) =>
              field.defaultValue === null
                ? []
                : [
                    [
                      field.name,
                      typeof field.defaultValue === "number"
                        ? String(field.defaultValue)
                        : field.defaultValue,
                    ] as [string, Draft],
                  ],
            )
          : [],
      ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [urlOpened, setUrlOpened] = useState(false);
  const perform = async (operation: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch {
      setError(
        "Could not send this response. Try again or cancel the request.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const respond = (response: CodexMcpElicitationResponse) =>
    void perform(() => submit(response));
  const submitForm = () => {
    if (pending.current || payload?.kind !== "form") return;
    const content = Object.fromEntries(
      payload.fields.flatMap<[string, Draft | number]>((field) => {
        const value = drafts.get(field.name);
        if (value === undefined) return [];
        if (field.kind === "number" || field.kind === "integer")
          return typeof value === "string" && value.trim() === ""
            ? []
            : [[field.name, Number(value)]];
        return [[field.name, value]];
      }),
    );
    const result = validateCodexMcpFormContent(payload.fields, content);
    if (!result.success) {
      setErrors(result.errors);
      setError(result.formError);
      return;
    }
    setErrors({});
    respond({ action: "accept", content: result.data });
  };
  return (
    <form
      className="codex-mcp-elicitation"
      aria-busy={busy}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submitForm();
      }}
    >
      <style>{styles}</style>
      {payload ? (
        <>
          <p className="mcp-muted">
            Requested by MCP server <code>{payload.serverName}</code>
          </p>
          {payload.kind === "computer_use" &&
            (payload.riskLevel === "high" || payload.warning) && (
              <div className="mcp-warning">
                {payload.riskLevel === "high" && <strong>High risk</strong>}
                <p>{payload.warning}</p>
              </div>
            )}
          {payload.kind === "computer_use" ? (
            <div>
              <strong>{payload.app.name} · Computer Use</strong>
              <p className="mcp-muted">{payload.app.id}</p>
            </div>
          ) : (
            payload.message !== interaction.title && <p>{payload.message}</p>
          )}
          {payload.kind === "form" && (
            <fieldset disabled={busy} aria-label="Form fields">
              {payload.fields.map((field) => (
                <CodexMcpField
                  key={field.name}
                  field={field}
                  value={drafts.get(field.name)}
                  error={errors[field.name]}
                  disabled={busy}
                  onChange={(value) => {
                    setDrafts((current) => {
                      const next = new Map(current);
                      if (value === undefined) next.delete(field.name);
                      else next.set(field.name, value);
                      return next;
                    });
                    setErrors((current) => {
                      const next = { ...current };
                      delete next[field.name];
                      return next;
                    });
                  }}
                />
              ))}
            </fieldset>
          )}
          {payload.kind === "url" && (
            <>
              <p>
                Open the requested page. Opening the link does not confirm
                sign-in.
              </p>
              <code>{payload.url}</code>
            </>
          )}
          {payload.kind === "tool_approval" && (
            <>
              <strong>{payload.toolName}</strong>
              <p className="mcp-muted">{payload.toolDescription}</p>
              {payload.params.length > 0 ? (
                <dl aria-label="Tool arguments">
                  {payload.params.map((param) => (
                    <div key={param.name} style={{ display: "contents" }}>
                      <dt>{param.label}</dt>
                      <dd>{param.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p>No arguments</p>
              )}
              {payload.omittedParamCount > 0 && (
                <p className="mcp-muted">
                  {payload.omittedParamCount} more arguments not shown
                </p>
              )}
            </>
          )}
          {payload.kind === "unsupported" && <p>{payload.reason}</p>}
          <footer>
            <button
              type="button"
              disabled={busy}
              onClick={() => respond({ action: "decline" })}
            >
              Decline
            </button>
            {(payload.kind === "computer_use" ||
              payload.kind === "tool_approval") && (
              <>
                {payload.scopes.includes("always") && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      respond({ action: "accept", persist: "always" })
                    }
                  >
                    Always allow
                  </button>
                )}
                {payload.scopes.includes("session") && (
                  <button
                    type="button"
                    className="mcp-primary"
                    disabled={busy}
                    onClick={() =>
                      respond({ action: "accept", persist: "session" })
                    }
                  >
                    Allow for this session
                  </button>
                )}
                {payload.kind === "tool_approval" && (
                  <button
                    type="button"
                    className="mcp-primary"
                    disabled={busy}
                    onClick={() => respond({ action: "accept" })}
                  >
                    Allow
                  </button>
                )}
              </>
            )}
            {payload.kind === "form" && (
              <button type="submit" className="mcp-primary" disabled={busy}>
                {payload.fields.length === 0 ? "Accept" : "Submit response"}
              </button>
            )}
            {payload.kind === "url" && (
              <button
                type="button"
                className="mcp-primary"
                disabled={busy}
                onClick={() => {
                  if (pending.current) return;
                  if (!urlOpened) {
                    try {
                      globalThis.open(
                        payload.url,
                        "_blank",
                        "noopener,noreferrer",
                      );
                      setUrlOpened(true);
                    } catch {
                      setError(
                        "Could not open this link. Try again or decline the request.",
                      );
                      return;
                    }
                  }
                  respond({ action: "accept" });
                }}
              >
                {urlOpened
                  ? "Retry response"
                  : `Open ${new URL(payload.url).host}`}
              </button>
            )}
          </footer>
        </>
      ) : (
        <p role="alert">This request could not be displayed.</p>
      )}
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Sending response…</p>}
      {(!payload || error) && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void perform(cancel)}
        >
          Cancel request
        </button>
      )}
    </form>
  );
}
