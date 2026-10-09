import { useRealtime, useZccNavigate, type PluginMessageDirectiveProps } from '@zana-ai/zcc-plugin-sdk/app';
import type { StudioComment, StudioViewState } from '../../../lib/studio-contract.js';
import { STUDIO_CHANGED_CHANNEL, STUDIO_RPC } from '../../../lib/studio-contract.js';
import { queueAgentScriptOpen } from '../agent-script-open.js';
import { AGENTFORCE_PLAYGROUND_ACTION } from '../agentforce-panel-params.js';
import { CARD_STYLES, ErrorCard, Pill, cleanAttr, parseLine, rpc, rpcFailure, useLoaded } from './card-kit.js';

interface AgentCardData {
  apiName: string;
  path: string;
  excerpt: string | null;
  lines: number;
  openComments: number | null;
  problems: number | null;
}

/** `::sf-agent{path="…" line="…"}` — a live card for an Agentforce .agent file. */
export function AgentCard({ pluginId, attributes, source, message }: PluginMessageDirectiveProps) {
  const navigate = useZccNavigate();
  const path = cleanAttr(attributes.path);
  const line = parseLine(attributes.line);
  const projectId = message.projectId;
  const scope = { ...(projectId ? { projectId } : {}), ...(message.threadId ? { threadId: message.threadId } : {}) };
  const loaded = useLoaded<AgentCardData | { error: string }>(async () => {
    if (!path) return { error: 'An agent path is required.' };
    const read = await rpc(pluginId, 'agentFiles.read', { ...scope, path });
    const failure = rpcFailure(read);
    const file = (read as { file?: { path?: string; content?: string; apiName?: string } }).file;
    if (failure || !file || typeof file.content !== 'string') return { error: failure?.message ?? 'Agent file not found.' };
    const rows = file.content.split('\n');
    const excerpt = line && line <= rows.length ? rows[line - 1]!.trim().slice(0, 160) || null : null;
    const [comments, view] = await Promise.all([
      rpc(pluginId, STUDIO_RPC.comments, { ...scope, path }).catch(() => null),
      rpc(pluginId, STUDIO_RPC.viewGet, scope).catch(() => null)
    ]);
    const list = rpcFailure(comments) ? null : (comments as { comments?: StudioComment[] } | null)?.comments;
    const state = rpcFailure(view) ? null : ((view as { state?: StudioViewState; view?: StudioViewState } | null)?.state ?? (view as { view?: StudioViewState } | null)?.view);
    const problems = state && state.path === path ? state.diagnostics.filter(item => item.severity === 'error' || item.severity === 'warning').length : null;
    return {
      apiName: file.apiName || (file.path ?? path).split('/').pop()!.replace(/\.(agent|afscript)$/i, ''),
      path: file.path ?? path,
      excerpt,
      lines: rows.length,
      openComments: Array.isArray(list) ? list.filter(comment => !comment.resolved).length : null,
      problems
    };
  }, [pluginId, path, line, projectId, message.threadId]);
  useRealtime(STUDIO_CHANGED_CHANNEL, payload => {
    const event = payload as { projectId?: string; path?: string } | null;
    if (event && (!event.projectId || !projectId || event.projectId === projectId) && (!event.path || event.path === path)) loaded.reload();
  });

  if (!path) return <ErrorCard kind="agent" message="Invalid agent link: a path is required." source={source} />;
  const data = loaded.data && !('error' in loaded.data) ? loaded.data : null;
  const failure = loaded.data && 'error' in loaded.data ? loaded.data.error : loaded.error;
  if (failure && !data) return <ErrorCard kind="agent" message={`Agent unavailable: ${failure}`} source={source} />;

  const open = () => {
    if (projectId) queueAgentScriptOpen(projectId, path);
    navigate.openThreadPanel({
      actionId: AGENTFORCE_PLAYGROUND_ACTION,
      title: 'Playground',
      params: { path, ...(line ? { line: String(line) } : {}) },
      ...(message.threadId ? { threadId: message.threadId } : {})
    });
  };
  const openStudio = () => {
    if (projectId) queueAgentScriptOpen(projectId, path);
    navigate.toProject(projectId ?? '', { tabId: 'salesforce' });
  };
  return (
    <div className="plugin-directive-card sf-dcard" data-testid="sf-card-agent">
      <style>{CARD_STYLES}</style>
      <button type="button" className="plugin-directive-card-main" disabled={!data} onClick={open} title={data ? `Open ${data.apiName} in the playground${line ? ` at line ${line}` : ''}` : undefined}>
        <span className="sf-dcard-icon" aria-hidden>AG</span>
        <span className="sf-dcard-body">
          <span className="sf-dcard-line">
            <span className="plugin-directive-card-kind">Agent</span>
            <span className="plugin-directive-card-title">{data ? data.apiName : 'Loading…'}</span>
            {line ? <Pill>line {line}</Pill> : null}
            {data?.openComments ? <Pill tone="warn">{data.openComments} comment{data.openComments === 1 ? '' : 's'}</Pill> : null}
            {data?.problems ? <Pill tone="danger">{data.problems} problem{data.problems === 1 ? '' : 's'}</Pill> : null}
          </span>
          <span className="sf-dcard-sub"><code>{path}</code>{data?.excerpt ? <> · <code>{data.excerpt}</code></> : null}</span>
        </span>
      </button>
      {data ? (
        <button type="button" className="plugin-directive-card-open" onClick={event => { event.stopPropagation(); openStudio(); }} title="Open in Studio">
          Open in Studio
        </button>
      ) : null}
    </div>
  );
}
