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
