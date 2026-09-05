import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { callPluginRpc, useZccContext } from '@zana-ai/zcc-plugin-sdk/app';
import { parseAgentforcePanelApiName, parseAgentforcePanelPath } from './agentforce-panel-params.js';
import type { PlaygroundFileRef } from './playground-bridge.js';
import {
  appendPreviewTurn,
  normalizePreviewMode,
  previewEndDisabled,
  previewErrorMessage,
  previewSendDisabled,
  previewStartDisabled,
  type PreviewMode,
  type PreviewTurn
} from './agentforce-preview-logic.js';
import { AGENTFORCE_PANEL_STYLES } from './AgentScriptPanel.js';
import { OrgPicker } from './OrgPicker.js';

const PLUGIN_ID = 'salesforce';
const PANEL_ROOT: CSSProperties = { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' };

type PreviewResult = {
  ok?: boolean;
  error?: string;
  code?: string;
  data?: { sessionId?: string | null; response?: string; utterance?: string };
};

function rpcProject(projectId: string | null | undefined, extra?: Record<string, unknown>) {
  return projectId ? { projectId, ...extra } : extra ?? {};
}

export function AgentforcePreviewPanel(props: {
  pluginId: string;
  threadId?: string;
  projectId?: string;
  params?: unknown;
}) {
  const pluginId = props.pluginId || PLUGIN_ID;
  const ctx = useZccContext();
  const projectId = props.projectId ?? ctx.projectId ?? undefined;
  const threadId = props.threadId ?? ctx.threadId ?? '';
  const [files, setFiles] = useState<PlaygroundFileRef[]>([]);
  const [path, setPath] = useState<string | null>(parseAgentforcePanelPath(props.params) ?? null);
  const [mode, setMode] = useState<PreviewMode>('simulate');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [utterance, setUtterance] = useState('');
  const [turns, setTurns] = useState<PreviewTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apiName = parseAgentforcePanelApiName(props.params);
  const targetPath = path || (apiName ? null : files[0]?.path ?? null);
  const hasTarget = Boolean(targetPath || apiName);

  useEffect(() => {
    let cancelled = false;
    void callPluginRpc(pluginId, 'agentFiles.list', rpcProject(projectId))
      .then((listed) => {
        if (cancelled) return;
        const next = listed as { ok?: boolean; files?: PlaygroundFileRef[] };
        if (next?.ok && Array.isArray(next.files)) setFiles(next.files);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [pluginId, projectId]);

  const callPreview = useCallback(
    async (action: 'agentPreview.start' | 'agentPreview.send' | 'agentPreview.end', extra?: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const result = (await callPluginRpc(
          pluginId,
          action,
          rpcProject(projectId, {
            threadId,
            path: targetPath || undefined,
            apiName: apiName || undefined,
            live: mode === 'live',
            ...extra
          })
        )) as PreviewResult;
        if (!result?.ok) {
          setError(previewErrorMessage(result));
          return result;
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        return { ok: false, error: message };
      } finally {
        setBusy(false);
      }
    },
    [apiName, mode, pluginId, projectId, targetPath, threadId]
  );

  const start = useCallback(async () => {
    const result = await callPreview('agentPreview.start');
    const nextSession = result?.data?.sessionId ?? null;
    if (result?.ok && nextSession) {
      setSessionId(nextSession);
      setTurns((current) =>
        appendPreviewTurn(current, {
          id: `${Date.now()}-start`,
          role: 'system',
          text: mode === 'live' ? 'Live preview started.' : 'Simulate preview started.'
        })
      );
    }
  }, [callPreview, mode]);

  const end = useCallback(async () => {
    if (!sessionId) return;
    const result = await callPreview('agentPreview.end', { sessionId });
    if (result?.ok) {
      setSessionId(null);
      setTurns((current) =>
        appendPreviewTurn(current, { id: `${Date.now()}-end`, role: 'system', text: 'Preview ended.' })
      );
    }
  }, [callPreview, sessionId]);

  const send = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      const text = utterance.trim();
      if (!sessionId || !text) return;
      setUtterance('');
      setTurns((current) => appendPreviewTurn(current, { id: `${Date.now()}-user`, role: 'user', text }));
      const result = await callPreview('agentPreview.send', { sessionId, utterance: text });
      const response = result?.data?.response?.trim();
      if (result?.ok && response) {
        setTurns((current) =>
          appendPreviewTurn(current, { id: `${Date.now()}-agent`, role: 'agent', text: response })
        );
      }
    },
    [callPreview, sessionId, utterance]
  );

  const fileLabel = useMemo(() => {
    if (targetPath) return targetPath.split('/').pop() ?? targetPath;
    return apiName || 'Select a .agent file';
  }, [apiName, targetPath]);

  return (
    <div className="sf-as" style={PANEL_ROOT} data-testid="salesforce-agentforce-preview">
      <style>{AGENTFORCE_PANEL_STYLES}</style>
      <header className="sf-as-header">
        <span className="sf-as-brand">Preview</span>
        <label className="sf-as-crumb">
          <span className="sf-as-crumb-seg">{fileLabel}</span>
          <select
            aria-label="Agentforce preview file"
            value={targetPath ?? ''}
            disabled={Boolean(sessionId)}
            onChange={(event) => setPath(event.target.value || null)}
          >
            {files.map((file) => (
              <option key={file.path} value={file.path}>
                {file.apiName}
              </option>
            ))}
          </select>
        </label>
        <span className="sf-as-spacer" />
        <OrgPicker pluginId={pluginId} compact disabled={Boolean(sessionId)} />
        <select
          className="sf-as-dialect"
          aria-label="Agentforce preview mode"
          value={mode}
          disabled={Boolean(sessionId)}
          onChange={(event) => setMode(normalizePreviewMode(event.target.value))}
        >
          <option value="simulate">Simulate</option>
          <option value="live">Live</option>
        </select>
        {sessionId ? (
          <button
            type="button"
            className="sf-as-save"
            data-testid="salesforce-agentforce-preview-end"
            disabled={previewEndDisabled(busy, sessionId)}
            onClick={() => void end()}
          >
            End
          </button>
        ) : (
          <button
            type="button"
            className="sf-as-save is-dirty"
            data-testid="salesforce-agentforce-preview-start"
            disabled={previewStartDisabled(busy, hasTarget, sessionId)}
            onClick={() => void start()}
          >
            {busy ? 'Starting…' : 'Start'}
          </button>
        )}
      </header>
      {error ? (
        <div className="sf-as-banner is-error" data-testid="salesforce-agentforce-preview-error">
          {error}
        </div>
      ) : (
        <div className="sf-as-banner">
          {mode === 'live'
            ? 'Live Test runs real org actions. Confirm before starting.'
            : 'Simulate uses mock actions. It does not mutate the org.'}
        </div>
      )}
      <div className="sf-as-body" style={{ flexDirection: 'column' }}>
        <div
          data-testid="salesforce-agentforce-preview-transcript"
          style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12, display: 'grid', gap: 8 }}
        >
          {turns.length === 0 ? (
            <p className="sf-as-empty">Start a preview, then send an utterance.</p>
          ) : (
            turns.map((turn) => (
              <p key={turn.id} data-preview-role={turn.role} style={{ margin: 0 }}>
                {turn.text}
              </p>
            ))
          )}
        </div>
        <form
          onSubmit={(event) => void send(event)}
          style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--border, #2c313a)' }}
        >
          <input
            aria-label="Agentforce preview utterance"
            data-testid="salesforce-agentforce-preview-input"
            value={utterance}
            onChange={(event) => setUtterance(event.target.value)}
            placeholder="Ask the agent…"
            disabled={!sessionId || busy}
            style={{ flex: 1, font: 'inherit', padding: '6px 8px' }}
          />
          <button
            type="submit"
            className="sf-as-save is-dirty"
            data-testid="salesforce-agentforce-preview-send"
            disabled={previewSendDisabled(busy, sessionId, utterance)}
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
