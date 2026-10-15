import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { callPluginRpc, useZccContext, useZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
import { PopoverPicklist } from '@zana-ai/zcc-ui/popover-picklist';
import { AGENTFORCE_PLAYGROUND_ACTION, agentforcePanelParams, parseAgentforcePanelApiName, parseAgentforcePanelPath, parseAgentforcePanelRun } from './agentforce-panel-params.js';
import { queueAgentScriptOpen } from './agent-script-open.js';
import { openInStudioWindow } from './studio-window-route.js';
import { PreviewRunReplay } from './preview/PreviewRunReplay.js';
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
import { fetchConnectedOrg } from './org-rpc.js';
import { orgSessionLabel } from '../../lib/org-session.js';
import type { PublicOrgView } from '../../lib/types.js';
import { AGENTFORCE_STUDIO_STYLES } from './agentforce-studio-styles.js';
import { Bot } from './components/icons.js';
import { callOrgPreview, type PreviewResult } from './org-preview-session.js';
import { ORG_PREVIEW_STYLES } from './org-preview-styles.js';

const PLUGIN_ID = 'salesforce';
const PANEL_ROOT: CSSProperties = { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' };

function rpcProject(projectId: string | null | undefined, extra?: Record<string, unknown>) {
  return projectId ? { projectId, ...extra } : extra ?? {};
}

export function AgentforcePreviewPanel(props: {
  pluginId: string;
  threadId?: string;
  projectId?: string;
  orgAlias?: string;
  params?: unknown;
}) {
  const pluginId = props.pluginId || PLUGIN_ID;
  const ctx = useZccContext();
  const navigate = useZccNavigate();
  const resource = props.params && typeof props.params === 'object' ? props.params as Record<string, unknown> : {};
  const pinnedOrg = props.orgAlias ?? (typeof resource.orgAlias === 'string' ? resource.orgAlias : undefined);
  const projectId = props.projectId ?? (typeof resource.projectId === 'string' ? resource.projectId : undefined) ?? ctx.projectId ?? undefined;
  const threadId = props.threadId ?? ctx.threadId ?? '';
  const [files, setFiles] = useState<PlaygroundFileRef[]>([]);
  const [path, setPath] = useState<string | null>(parseAgentforcePanelPath(props.params) ?? null);
  const [mode, setMode] = useState<PreviewMode>('simulate');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [utterance, setUtterance] = useState('');
  const [turns, setTurns] = useState<PreviewTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [org, setOrg] = useState<PublicOrgView | null>(null);
  const linkedRun = parseAgentforcePanelRun(props.params);
  const runKey = linkedRun ? `${linkedRun.runId}:${linkedRun.turn ?? ''}` : '';
  const [run, setRun] = useState(linkedRun);
  // Another card can retarget an open panel; follow it.
  useEffect(() => { setRun(parseAgentforcePanelRun(props.params)); }, [runKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const apiName = parseAgentforcePanelApiName(props.params);
  const targetPath = path || files.find(file => file.apiName === apiName)?.path || (apiName ? null : files[0]?.path ?? null);
  const hasTarget = Boolean(targetPath || apiName);
  const lifecycle = useRef<{ generation: number; simulated?: boolean; release?: () => void }>({ generation: 0 });
  useEffect(() => () => {
    lifecycle.current.generation++;
    lifecycle.current.release?.();
    lifecycle.current.release = undefined;
  }, [pluginId, projectId, threadId]);

  const refreshOrg = useCallback(async () => {
    const payload = await fetchConnectedOrg(pluginId, projectId, pinnedOrg);
    setOrg(payload.ok ? payload.org : null);
  }, [pluginId, projectId, pinnedOrg]);

  useEffect(() => {
    let cancelled = false;
    void callPluginRpc(pluginId, 'agentFiles.list', rpcProject(projectId, { purpose: 'preview' }))
      .then((listed) => {
        if (cancelled) return;
        const next = listed as { ok?: boolean; files?: PlaygroundFileRef[] };
        if (next?.ok && Array.isArray(next.files)) setFiles(next.files);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    void refreshOrg().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pluginId, projectId, refreshOrg]);

  const callPreview = useCallback(
    async (action: 'start' | 'send' | 'end', extra?: Record<string, unknown>): Promise<PreviewResult> => {
      setBusy(true);
      setError(null);
      const generation = lifecycle.current.generation;
      const simulated = action === 'start' ? mode === 'simulate' && Boolean(targetPath) : Boolean(lifecycle.current.simulated);
      const args = rpcProject(projectId, {
        threadId, orgAlias: org?.alias ?? pinnedOrg,
        path: targetPath || undefined, apiName: targetPath ? undefined : apiName || undefined,
        live: mode === 'live', ...extra
      });
      try {
        const result = await callOrgPreview(pluginId, action, args, simulated, () => generation === lifecycle.current.generation);
        if (result?.ok && action === 'start' && result.data?.sessionId) {
          const sessionId = result.data.sessionId;
          const release = () => { void callOrgPreview(pluginId, 'end', { ...args, sessionId }, simulated).catch(() => undefined); };
          // A tab can close while start is in flight. Release that late session too.
          if (generation !== lifecycle.current.generation) release();
          else { lifecycle.current.release = release; lifecycle.current.simulated = simulated; }
        }
        if (generation !== lifecycle.current.generation) return { ok: false };
        if (result?.ok && action === 'end') lifecycle.current.release = undefined;
        if (!result?.ok) {
          setError(previewErrorMessage(result));
          return result;
        }
        if (result?.ok && action === 'start' && !result.data?.sessionId) {
          const invalid = { ok: false, error: 'The preview returned no session.' };
          setError(invalid.error);
          return invalid;
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (generation === lifecycle.current.generation) setError(message);
        return { ok: false, error: message };
      } finally {
        if (generation === lifecycle.current.generation) setBusy(false);
      }
    },
    [apiName, mode, pluginId, projectId, targetPath, threadId, org?.alias, pinnedOrg]
  );

  const start = useCallback(async () => {
    setRun(null);
    const result = await callPreview('start');
    const nextSession = result?.data?.sessionId ?? null;
    if (result?.ok && nextSession) {
      setSessionId(nextSession);
      setTurns(() => {
        const started = appendPreviewTurn([], {
          id: `${Date.now()}-start`,
          role: 'system',
          text: mode === 'live' ? 'Live preview started.' : 'Simulate preview started.'
        });
        const welcome = result.data?.response?.trim();
        return welcome ? appendPreviewTurn(started, { id: `${Date.now()}-welcome`, role: 'agent', text: welcome }) : started;
      });
    }
  }, [callPreview, mode]);

  const end = useCallback(async () => {
    if (!sessionId) return;
    const result = await callPreview('end', { sessionId });
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
      if (busy || !sessionId || !text) return;
      setUtterance('');
      setTurns((current) => appendPreviewTurn(current, { id: `${Date.now()}-user`, role: 'user', text }));
      const result = await callPreview('send', { sessionId, utterance: text });
      const response = result?.data?.response?.trim();
      if (result?.ok && response) {
        setTurns((current) =>
          appendPreviewTurn(current, { id: `${Date.now()}-agent`, role: 'agent', text: response })
        );
      }
    },
    [busy, callPreview, sessionId, utterance]
  );

  const fileLabel = useMemo(() => {
    if (targetPath) return targetPath.split('/').pop() ?? targetPath;
    return apiName || 'Select a .agent file';
  }, [apiName, targetPath]);

  return (
    <div className="sf-as sf-org-preview" style={PANEL_ROOT} data-testid="salesforce-agentforce-preview">
      <style>{AGENTFORCE_PANEL_STYLES}</style>
      <style>{AGENTFORCE_STUDIO_STYLES}</style>
      <style>{ORG_PREVIEW_STYLES}</style>
      <header className="sf-as-header">
        <div className="sf-org-preview-identity">
          <span className="af-brand-mark"><Bot /></span><span className="sf-as-brand">Org preview</span>
          <PopoverPicklist
            ariaLabel="Agentforce preview file"
            className="sf-org-preview-picker"
            value={targetPath ?? ''}
            disabled={busy || Boolean(sessionId)}
            placeholder={fileLabel}
            title={targetPath ?? apiName ?? undefined}
            searchPlaceholder="Search agents…"
            emptyHint="No matching agents"
            minWidth={300}
            options={files.map(file => ({ value: file.path, label: file.apiName, description: file.path }))}
            onChange={setPath}
          />
        </div>
        <div className="sf-org-preview-controls">
          <div className="sf-org-preview-org" data-testid="salesforce-preview-org">
            {pinnedOrg ? <span className="sf-badge" title={orgSessionLabel(org) ?? pinnedOrg}>{pinnedOrg}</span> : <OrgPicker pluginId={pluginId} projectId={projectId} compact appearance="toolbar" disabled={busy || Boolean(sessionId)} onSelect={() => void refreshOrg()} />}
          </div>
          <select
            className="sf-as-dialect"
            aria-label="Agentforce preview mode"
            value={mode}
            disabled={busy || Boolean(sessionId)}
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
        </div>
      </header>
      {error ? (
        <div className="sf-as-banner is-error" data-testid="salesforce-agentforce-preview-error">
          {error}
        </div>
      ) : (
        <div className="sf-as-banner">
          {mode === 'live'
            ? `Live Test runs real actions on ${orgSessionLabel(org) ?? 'the selected org'}. Confirm before starting.`
            : 'Local bundles use simulated actions. Published agents always use live actions and require confirmation.'}
        </div>
      )}
      {run ? (
        <PreviewRunReplay
          key={`${run.runId}:${run.turn ?? ''}`}
          pluginId={pluginId}
          projectId={projectId}
          runId={run.runId}
          turn={run.turn}
          onClose={() => setRun(null)}
          onRevealSource={async (file, line) => {
            if (projectId && await openInStudioWindow({ pluginId, projectId, path: file, line, navigate })) return;
            if (projectId) queueAgentScriptOpen(projectId, file);
            navigate.openThreadPanel({ actionId: AGENTFORCE_PLAYGROUND_ACTION, title: 'Playground', params: agentforcePanelParams(file, undefined, { line }), ...(threadId ? { threadId } : {}) });
          }}
        />
      ) : <div className="sf-as-body" style={{ flexDirection: 'column' }}>
        <div
          data-testid="salesforce-agentforce-preview-transcript"
          className="af-transcript"
          role="log"
          aria-label="Org preview conversation"
          style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 20 }}
        >
          {turns.length === 0 ? (
            <div className="af-welcome"><span className="af-welcome-orbit"><Bot /></span><h3>Try your connected agent</h3><p>Start a preview, then ask a question. Local authoring bundles use simulated actions by default.</p><span className="af-welcome-tag">{fileLabel}</span></div>
          ) : (
            turns.map((turn) => (
              turn.role === 'system' ? <p key={turn.id} data-preview-role={turn.role} className="af-caption">{turn.text}</p> :
              <article key={turn.id} data-preview-role={turn.role} className={`af-message is-${turn.role}`}><div className="af-message-meta"><strong>{turn.role === 'agent' ? 'Agentforce' : 'You'}</strong></div><div className="af-message-text">{turn.text}</div></article>
            ))
          )}
        </div>
        <form
          onSubmit={(event) => void send(event)}
          className="af-composer"
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
      </div>}
    </div>
  );
}
