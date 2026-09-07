import { useEffect, useState } from 'react';
import { callPluginRpc, useZccContext, useZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
import { openAgentforcePlayground, openAgentforcePreview } from './agentforce-panel-params.js';
import { OrgPicker } from './OrgPicker.js';

type StatusPayload = {
  defaultOrg?: string;
  selectedAlias?: string | null;
  dxProject?: boolean;
  lastDoctor?: {
    org?: { alias: string; kind: string };
    cliOk?: boolean;
    cliError?: string;
    agentBundleCount?: number;
  };
};

const LIST_STYLES = `
.sf-org-list { display: grid; gap: 8px; margin: 12px 0 16px; }
.sf-org-list-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--text-muted); }
.sf-org-refresh, .sf-org-list button { font: inherit; }
.sf-org-refresh { height: 28px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: inherit; cursor: pointer; }
.sf-org-rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.sf-org-rows button { display: grid; grid-template-columns: minmax(8rem, 1fr) minmax(10rem, 1.4fr) auto auto auto; gap: 8px; width: 100%; text-align: left; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); background: transparent; color: inherit; cursor: pointer; font-size: 12px; }
.sf-org-rows button.is-selected { border-color: var(--accent, #1b96ff); background: color-mix(in srgb, var(--accent, #1b96ff) 12%, transparent); }
.sf-org-error { margin: 0; color: var(--danger); font-size: 12px; }
.sf-org-empty { margin: 0; color: var(--text-muted); font-size: 12px; }
`;

export function SalesforceProjectTab(props: { pluginId: string; projectId: string }) {
  const navigate = useZccNavigate();
  const context = useZccContext();
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void callPluginRpc(props.pluginId, 'status')
      .then((next) => {
        if (!cancelled) setStatus((next ?? {}) as StatusPayload);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [props.pluginId]);

  const last = status?.lastDoctor;
  const orgLabel = last?.org
    ? `${last.org.alias} (${last.org.kind})`
    : status?.selectedAlias || status?.defaultOrg || 'No org selected yet';

  return (
    <div style={{ padding: 16, height: '100%', boxSizing: 'border-box' }}>
      <style>{LIST_STYLES}</style>
      <h2 style={{ marginTop: 0 }}>Salesforce</h2>
      <p>{orgLabel}</p>
      <OrgPicker pluginId={props.pluginId} />
      {last?.cliOk === false ? (
        <p style={{ color: 'var(--danger)' }}>{last.cliError || 'Salesforce CLI missing'}</p>
      ) : null}
      {last && typeof last.agentBundleCount === 'number' ? (
        <p style={{ color: 'var(--text-muted)' }}>
          {last.agentBundleCount} .agent bundle{last.agentBundleCount === 1 ? '' : 's'}
        </p>
      ) : null}
      {status && !status.dxProject ? (
        <p style={{ color: 'var(--text-muted)' }}>No sfdx-project.json at the configured DX project root.</p>
      ) : null}
      {error ? <p style={{ color: 'var(--danger)' }}>{error}</p> : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            void callPluginRpc(props.pluginId, 'doctor')
              .then((report) => {
                setStatus((current) => ({ ...(current ?? {}), lastDoctor: report as StatusPayload['lastDoctor'] }));
              })
              .catch((err) => setError(err instanceof Error ? err.message : String(err)))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Running doctor…' : 'Run doctor'}
        </button>
        <button
          type="button"
          disabled={!context.threadId}
          onClick={() => {
            openAgentforcePlayground({
              openThreadPanel: (options) => navigate.openThreadPanel(options),
              projectId: props.projectId
            });
          }}
        >
          Open Playground
        </button>
        <button
          type="button"
          disabled={!context.threadId}
          onClick={() => {
            openAgentforcePreview({
              openThreadPanel: (options) => navigate.openThreadPanel(options)
            });
          }}
        >
          Open Preview
        </button>
        <button type="button" onClick={() => navigate.toProject(props.projectId, { tabId: 'soql' })}>
          Open SOQL
        </button>
      </div>
    </div>
  );
}
