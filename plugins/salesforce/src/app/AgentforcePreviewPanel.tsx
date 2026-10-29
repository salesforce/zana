import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { callPluginRpc, useZccContext, useZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
import { PopoverPicklist } from '@zana-ai/zcc-ui/popover-picklist';
import { parseAgentforcePanelRun } from './agentforce-panel-params.js';
import { routeStudioIntent } from './studio/studio-intents.js';
import { useAgentforceTarget } from './use-agentforce-target.js';
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
import { PREVIEW_CONTEXT_STYLES, PreviewContextEditor, PreviewContextSetup, PreviewContextTabs, usePreviewContext } from './preview/PreviewContext.js';
import { getStudioRun, readWorkspaceValue, runWorkspaceRef, studioRunKey, updateStudioRun, useRunWorkspaceState, type StudioRunOwner } from './studio/run-workspaces.js';
import type { LabSnapshot } from '../../lib/agentforce-lab-contract.js';
import type { PreviewContextVariable } from '../../lib/preview-context.js';

const PLUGIN_ID = 'salesforce';
const PANEL_ROOT: CSSProperties = { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' };

function rpcProject(projectId: string | null | undefined, extra?: Record<string, unknown>) {
  return projectId ? { projectId, ...extra } : extra ?? {};
}

interface AgentforcePreviewPanelProps {
  pluginId: string;
  threadId?: string;
  tabId?: string;
  projectId?: string;
  orgAlias?: string;
  params?: unknown;
  /** Binds the panel to one agent file: the shared per-thread target and the agent picker are ignored. */
  pinnedPath?: string;
}

export function AgentforcePreviewPanel(props: AgentforcePreviewPanelProps) {
  const ctx = useZccContext();
  const resource = props.params && typeof props.params === 'object' ? props.params as Record<string, unknown> : {};
  const projectId = props.projectId ?? (typeof resource.projectId === 'string' ? resource.projectId : undefined) ?? ctx.projectId ?? undefined;
  const threadId = props.threadId ?? ctx.threadId ?? '';
  return <AgentforcePreviewWorkspace key={JSON.stringify([props.pluginId, projectId, threadId, props.pinnedPath ?? ''])} {...props} projectId={projectId} threadId={threadId} />;
}

function AgentforcePreviewWorkspace(props: AgentforcePreviewPanelProps) {
  const pluginId = props.pluginId || PLUGIN_ID;
  const navigate = useZccNavigate();
  const resource = props.params && typeof props.params === 'object' ? props.params as Record<string, unknown> : {};
  const pinnedOrg = props.orgAlias ?? (typeof resource.orgAlias === 'string' ? resource.orgAlias : undefined);
  const projectId = props.projectId;
  const threadId = props.threadId ?? '';
  const [files, setFiles] = useState<PlaygroundFileRef[]>([]);
  const pinned = props.pinnedPath || undefined;
  // Pinned: the panel's params must not rewrite the thread's shared target either.
  const { target, select } = useAgentforceTarget({ pluginId, projectId, threadId, tabId: props.tabId, surface: 'preview', params: pinned ? undefined : props.params });
  const [org, setOrg] = useState<PublicOrgView | null>(null);
  const linkedRun = parseAgentforcePanelRun(props.params);
  const runKey = linkedRun ? `${linkedRun.runId}:${linkedRun.turn ?? ''}` : '';
  const [run, setRun] = useState(linkedRun);
  // Another card can retarget an open panel; follow it.
  useEffect(() => { setRun(parseAgentforcePanelRun(props.params)); }, [runKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const apiName = pinned ? undefined : target?.apiName;
  const targetPath = pinned ?? (target?.path || files.find(file => file.apiName === apiName)?.path || (apiName ? null : files[0]?.path ?? null));
  useEffect(() => { if (!pinned && targetPath && target?.path !== targetPath) select({ path: targetPath }); }, [pinned, target?.path, targetPath, select]);
  const owner: StudioRunOwner = { pluginId, projectId, orgAlias: pinnedOrg ?? org?.alias, path: targetPath ?? apiName ?? undefined, view: 'org-preview' };
  const workspaceKey = studioRunKey(owner);
  const [mode, setMode] = useRunWorkspaceState<PreviewMode>(workspaceKey, 'mode', 'simulate');
  const [sessionId, setSessionId] = useRunWorkspaceState<string | null>(workspaceKey, 'sessionId', null);
  const [utterance, setUtterance] = useRunWorkspaceState(workspaceKey, 'utterance', '');
  const [turns, setTurns] = useRunWorkspaceState<PreviewTurn[]>(workspaceKey, 'turns', []);
  const [busy, setBusy] = useRunWorkspaceState(workspaceKey, 'busy', false);
  const [error, setError] = useState<string | null>(null);
  const hasTarget = Boolean(targetPath || apiName);
  const context = usePreviewContext({ pluginId, projectId, path: targetPath ?? undefined, apiName: apiName ?? undefined, orgAlias: pinnedOrg ?? org?.alias, scope: `${projectId ?? ''}:${targetPath ?? apiName ?? ''}:${pinnedOrg ?? org?.alias ?? ''}` });
  const epoch = runWorkspaceRef(workspaceKey, 'epoch', 0);
  const locked = runWorkspaceRef(workspaceKey, 'locked', false);
  const lifecycle = runWorkspaceRef<{ simulated?: boolean; owner?: Record<string, unknown> }>(workspaceKey, 'lifecycle', {}, true);
  useEffect(() => {
    let attached = true, pending = false;
    const refresh = async () => {
      let id = readWorkspaceValue<string | null>(workspaceKey, 'sessionId', null);
      const remembered = getStudioRun(owner);
      if (!id && remembered && ['active', 'running'].includes(remembered.status)) {
        id = remembered.runId; setSessionId(id);
        lifecycle.current = { simulated: remembered.engine !== 'live', owner: rpcProject(projectId, { threadId, orgAlias: owner.orgAlias, path: targetPath || undefined, apiName: targetPath ? undefined : apiName, live: remembered.engine === 'live', startedByUser: true }) };
      }
      if (!id || pending) return;
      pending = true;
      const requestedEpoch = epoch.current;
      try {
        const result = await callPluginRpc(pluginId, 'agentLab.get', { projectId, id, path: targetPath ?? undefined, orgAlias: owner.orgAlias }) as { ok?: boolean; data?: LabSnapshot; error?: string };
        if (!attached || epoch.current !== requestedEpoch || readWorkspaceValue(workspaceKey, 'sessionId', null) !== id) return;
        if (result?.ok && result.data) {
          const snapshot = result.data;
          setTurns(snapshot.turns.map((turn, index) => ({ id: `${id}:${index}`, role: turn.role, text: turn.text })));
          setBusy(Boolean(snapshot.busy) || locked.current);
          if (snapshot.closed || snapshot.failed) { setSessionId(null); setBusy(false); if (snapshot.failed) setError('This preview could not continue. Start a new conversation to retry.'); }
          updateStudioRun(owner, { runId: id, engine: snapshot.live ? 'live' : 'simulate', status: snapshot.closed || snapshot.failed ? 'ended' : snapshot.busy ? 'running' : 'active', turn: snapshot.turns.filter(turn => turn.role === 'user').length });
        } else if (!lifecycle.current.simulated) setBusy(false);
        else { setSessionId(null); setBusy(false); setError(result.error || 'This preview is no longer available.'); updateStudioRun(owner, { runId: id, engine: 'simulate', status: 'expired', turn: 0 }); }
      } catch { if (attached && epoch.current === requestedEpoch) setBusy(locked.current); } finally { pending = false; }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 2000);
    return () => { attached = false; clearInterval(timer); };
  }, [workspaceKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (action === 'start' || action === 'end') epoch.current++;
      const requestedEpoch = epoch.current;
      locked.current = true; setBusy(true);
      setError(null);
      const simulated = action === 'start' ? mode === 'simulate' && Boolean(targetPath) : Boolean(lifecycle.current.simulated);
      const scopeArgs = rpcProject(projectId, {
        threadId, orgAlias: org?.alias ?? pinnedOrg,
        path: targetPath || undefined, apiName: targetPath ? undefined : apiName || undefined,
        // Every call here comes from a click on Start, Send or End: that click is the approval.
        live: mode === 'live', startedByUser: true
      });
      const ownerForWorkspace: StudioRunOwner = { pluginId, projectId, orgAlias: pinnedOrg ?? org?.alias, path: targetPath ?? apiName ?? undefined, view: 'org-preview' };
      const owner = action === 'start' ? scopeArgs : lifecycle.current.owner ?? scopeArgs;
      const args = { ...owner, ...extra };
      try {
        const result = await callOrgPreview(pluginId, action, args, simulated);
        if (epoch.current !== requestedEpoch) return { ok: false };
        if (result?.ok && action === 'start' && result.data?.sessionId) {
          const sessionId = result.data.sessionId;
          lifecycle.current = { simulated, owner };
          updateStudioRun({ pluginId, projectId, orgAlias: pinnedOrg ?? org?.alias, path: targetPath ?? apiName ?? undefined, view: 'org-preview' }, { runId: sessionId, engine: simulated ? 'simulate' : 'live', status: 'active', turn: 0 });
        }
        if (result?.ok && action === 'end') {
          lifecycle.current = {};
          const remembered = getStudioRun(ownerForWorkspace);
          if (remembered) updateStudioRun(ownerForWorkspace, { runId: remembered.runId, engine: remembered.engine, status: 'ended', turn: remembered.turn });
        }
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
        if (epoch.current === requestedEpoch) setError(message);
        return { ok: false, error: message };
      } finally {
        if (epoch.current === requestedEpoch) { locked.current = false; setBusy(false); }
      }
    },
    [apiName, mode, pluginId, projectId, targetPath, threadId, org?.alias, pinnedOrg]
  );

  const start = async (contextVariables: PreviewContextVariable[] = context.values) => {
    const contextPreset = context.presetIdentity;
    setRun(null);
    if (sessionId) {
      const ended = await callPreview('end', { sessionId });
      if (!ended.ok) return;
      setSessionId(null);
    }
    const result = await callPreview('start', contextVariables.length ? { contextVariables } : undefined);
    const nextSession = result?.data?.sessionId ?? null;
    if (result?.ok && nextSession) {
      setSessionId(nextSession);
      context.markApplied(contextVariables, contextPreset); context.setSetup(false); context.setTab('conversation');
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
  };

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
          current.at(-1)?.role === 'agent' && current.at(-1)?.text === response ? current : appendPreviewTurn(current, { id: `${Date.now()}-agent`, role: 'agent', text: response })
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
    <div className="sf-as sf-org-preview" style={PANEL_ROOT} data-testid="salesforce-agentforce-preview" data-run-id={sessionId ?? undefined}>
      <style>{AGENTFORCE_PANEL_STYLES}</style>
      <style>{AGENTFORCE_STUDIO_STYLES}</style>
      <style>{ORG_PREVIEW_STYLES}</style>
      <style>{PREVIEW_CONTEXT_STYLES}</style>
      <header className="sf-as-header">
        <div className="sf-org-preview-identity">
          <span className="af-brand-mark"><Bot /></span><span className="sf-as-brand">Org preview</span>
          {pinned ? <span className="sf-org-preview-picker" data-testid="salesforce-preview-pinned" title={pinned}>{fileLabel}</span> : <PopoverPicklist
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
            onChange={path => select({ path })}
          />}
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
              disabled={previewStartDisabled(busy || context.loading, hasTarget, sessionId)}
              onClick={() => context.fields.length || context.count || context.discoveryError ? context.setSetup(true) : void start()}
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
      <PreviewContextTabs context={context} />
      {context.tab === 'context' && <div className="sf-context-panel" id={`${context.id}-context-panel`} role="tabpanel" aria-labelledby={`${context.id}-context`}><PreviewContextEditor context={context} running={Boolean(sessionId)} onRestart={() => context.setSetup(true)} /></div>}
      <div className="sf-context-conversation" id={`${context.id}-conversation-panel`} role="tabpanel" aria-labelledby={`${context.id}-conversation`} hidden={context.tab !== 'conversation'}>
      {run ? (
        <PreviewRunReplay
          key={`${run.runId}:${run.turn ?? ''}`}
          pluginId={pluginId}
          projectId={projectId}
          runId={run.runId}
          turn={run.turn}
          onClose={() => setRun(null)}
          onRevealSource={async (file, line) => {
            await routeStudioIntent({ pluginId, projectId: projectId ?? null, threadId: threadId || null, from: document.activeElement, navigate, intent: { kind: 'agent', path: file, line } });
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
      {context.setup && <PreviewContextSetup context={context} error={error} busy={busy} running={Boolean(sessionId)} onClose={() => context.setSetup(false)} onStart={() => void start()} />}
    </div>
  );
}
