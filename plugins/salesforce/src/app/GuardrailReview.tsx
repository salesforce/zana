import { useState } from 'react';
import { useZccNavigate, type PluginPendingInteractionProps } from '@zana-ai/zcc-plugin-sdk/app';
import { AGENTFORCE_PLAYGROUND_ACTION } from './agentforce-panel-params.js';
import { componentTarget, parseGuardrailPreview, type ComponentTarget, type GuardrailField } from './guardrail-preview.js';

const STYLES = `
.sf-guard { display:grid; gap:10px; min-width:0; }
.sf-guard p { margin:0; }
.sf-guard-org { display:flex; align-items:center; flex-wrap:wrap; gap:6px; }
.sf-guard-badge { display:inline-flex; align-items:center; font-size:11px; font-weight:600; line-height:18px; padding:0 7px; border-radius:999px; color:var(--text-muted); background:var(--bg-elevated); text-transform:capitalize; }
.sf-guard-badge[data-kind=sandbox], .sf-guard-badge[data-kind=scratch] { color:var(--success,#1e8e3e); background:color-mix(in srgb,var(--success,#1e8e3e) 12%,transparent); }
.sf-guard-badge[data-kind=production], .sf-guard-badge[data-kind=unknown] { color:var(--danger,#d93025); background:color-mix(in srgb,var(--danger,#d93025) 12%,transparent); }
.sf-guard-badge[data-kind=write] { color:var(--accent-gold,#b07d16); background:color-mix(in srgb,var(--accent-gold,#b07d16) 12%,transparent); }
.sf-guard-muted { color:var(--text-muted); }
.sf-guard-mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; overflow-wrap:anywhere; }
.sf-guard-grid { display:grid; grid-template-columns:max-content minmax(0,1fr); gap:5px 14px; align-items:baseline; }
.sf-guard-chip { display:inline-block; margin:0 4px 4px 0; padding:0 7px; border-radius:5px; background:var(--bg-elevated); }
.sf-guard-components { width:100%; border-collapse:collapse; }
.sf-guard-components td { padding:4px 8px 4px 0; border-top:1px solid var(--border); vertical-align:baseline; }
.sf-guard-components td:first-child { color:var(--text-muted); white-space:nowrap; width:1%; }
.sf-guard details summary { cursor:pointer; color:var(--text-muted); font-size:12px; }
.sf-guard pre { margin:6px 0 0; max-height:220px; overflow:auto; white-space:pre-wrap; }
.sf-guard-warning { padding:7px 10px; border-radius:6px; border:1px solid color-mix(in srgb,var(--danger,#d93025) 35%,transparent); background:color-mix(in srgb,var(--danger,#d93025) 8%,transparent); }
.sf-guard-link { all:unset; cursor:pointer; color:var(--accent); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; overflow-wrap:anywhere; }
.sf-guard-link:hover, .sf-guard-link:focus-visible { text-decoration:underline; }
.sf-guard-running { padding:7px 10px; border-radius:6px; color:var(--accent); background:color-mix(in srgb,var(--accent) 10%,transparent); }
.sf-guard-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:2px; }
`;

const RISKY_ORG_KINDS = new Set(['production', 'unknown']);

export function GuardrailReview(props: PluginPendingInteractionProps) {
  const payload =
    props.interaction.payload && typeof props.interaction.payload === 'object'
      ? (props.interaction.payload as Record<string, string>)
      : {};
  const preview = payload.preview ? parseGuardrailPreview(String(payload.preview)) : null;
  const orgKind = payload.orgKind || 'unknown';
  const navigate = useZccNavigate();
  const [allowed, setAllowed] = useState(false);
  const openTarget = (target: ComponentTarget) => {
    const threadId = props.interaction.threadId;
    navigate.openThreadPanel({
      actionId: AGENTFORCE_PLAYGROUND_ACTION,
      title: target.kind === 'agent' ? 'Playground' : target.kind === 'flow' ? 'Flow map' : 'Apex (read-only)',
      params:
        target.kind === 'agent'
          ? { path: target.path }
          : { apiName: target.apiName, tool: 'actions', ...(target.kind === 'apex' ? { readOnly: '1' } : {}) },
      ...(threadId ? { threadId } : {})
    });
  };
  return (
    <div className="sf-guard" data-testid="salesforce-guardrail">
      <style>{STYLES}</style>
      {payload.orgAlias ? (
        <div className="sf-guard-org">
          <span className="sf-guard-badge" data-kind={orgKind}>{orgKind}</span>
          {payload.kind === 'org.write' ? <span className="sf-guard-badge" data-kind="write">Write</span> : null}
          <strong>{payload.orgAlias}</strong>
          {payload.orgId ? <span className="sf-guard-muted sf-guard-mono">{payload.orgId}</span> : null}
        </div>
      ) : null}
      <p className="sf-guard-muted">{payload.summary || 'Confirm this Salesforce action.'}</p>
      {preview?.warning ? (
        <p className="sf-guard-warning" role="alert">
          {preview.warning}
        </p>
      ) : null}
      {preview ? (
        <>
          {preview.fields.some(field => field.kind !== 'components') ? (
            <div className="sf-guard-grid">
              {preview.fields.filter(field => field.kind !== 'components').map(field => (
                <FieldRow key={field.key} field={field} />
              ))}
            </div>
          ) : null}
          {preview.fields.map(field => (field.kind === 'components' ? <ComponentTable key={field.key} field={field} onOpen={openTarget} /> : null))}
          <details>
            <summary>Raw payload</summary>
            <pre className="sf-guard-mono">{preview.raw}</pre>
          </details>
        </>
      ) : payload.preview ? (
        <pre className="sf-guard-mono">{String(payload.preview)}</pre>
      ) : null}
      {allowed ? (
        <p className="sf-guard-running" role="status" data-testid="salesforce-guardrail-running">
          Running… the agent will post the operation card.
        </p>
      ) : (
        <div className="sf-guard-actions">
          <button
            type="button"
            className={RISKY_ORG_KINDS.has(orgKind) ? 'btn danger' : 'btn primary'}
            onClick={() => {
              setAllowed(true);
              void props.submit({ approved: true });
            }}
          >
            Allow this action
          </button>
          <button type="button" className="btn" onClick={() => void props.cancel()}>
            Deny
          </button>
        </div>
      )}
    </div>
  );
}

function FieldRow({ field }: { field: Exclude<GuardrailField, { kind: 'components' }> }) {
  return (
    <>
      <span className="sf-guard-muted">{field.label}</span>
      {field.kind === 'list' ? (
        <span>
          {field.value.map((item, index) => (
            <span key={index} className="sf-guard-chip sf-guard-mono">{item}</span>
          ))}
          {field.more ? <span className="sf-guard-muted">+{field.more} more</span> : null}
        </span>
      ) : (
        <span className="sf-guard-mono">{field.value}</span>
      )}
    </>
  );
}

function ComponentTable({ field, onOpen }: { field: Extract<GuardrailField, { kind: 'components' }>; onOpen: (target: ComponentTarget) => void }) {
  return (
    <div>
      <p className="sf-guard-muted">
        {field.label} ({field.value.length + field.more})
      </p>
      <table className="sf-guard-components">
        <tbody>
          {field.value.map((component, index) => {
            const target = componentTarget(component);
            return (
              <tr key={index} title={component.path}>
                <td>{component.type}</td>
                <td className="sf-guard-mono">
                  {target ? (
                    <button type="button" className="sf-guard-link" onClick={() => onOpen(target)} title={target.kind === 'apex' ? 'View source (read-only)' : target.kind === 'flow' ? 'Open flow map' : 'Open in playground'}>
                      {component.name}
                    </button>
                  ) : (
                    component.name
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {field.more ? <p className="sf-guard-muted">+{field.more} more not shown</p> : null}
    </div>
  );
}
