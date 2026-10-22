import { useRealtime, useZccNavigate, type PluginMessageDirectiveProps } from '@zana-ai/zcc-plugin-sdk/app';
import type { StudioComment, StudioViewState } from '../../../lib/studio-contract.js';
import { STUDIO_CHANGED_CHANNEL, STUDIO_RPC, countProblems } from '../../../lib/studio-contract.js';
import { queueAgentScriptOpen } from '../agent-script-open.js';
import { routeStudioIntent } from '../studio/studio-intents.js';
import { openInStudioWindow, STUDIO_TAB_ID } from '../studio-window-route.js';
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
    const problems = state && state.path === path ? countProblems(state.diagnostics) : null;
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

  // With the Studio in its own window, both buttons open the agent there instead of a second editor here.
  const studioWindow = () => projectId ? openInStudioWindow({ pluginId, projectId, path, ...(line ? { line } : {}), navigate }) : Promise.resolve(false);
  // A click beside a Studio opens its tab; in a thread, the Agent side panel; else the Studio.
  const open = (from: Element | null) => routeStudioIntent({
    pluginId, projectId: projectId ?? null, threadId: message.threadId ?? null, from, navigate,
    intent: { kind: 'agent', path, ...(line ? { line } : {}) }
  });
  const openStudio = async () => {
    if (await studioWindow()) return;
    if (projectId) queueAgentScriptOpen(projectId, path);
    navigate.toProject(projectId ?? '', { tabId: STUDIO_TAB_ID });
  };
  return (
    <div className="plugin-directive-card sf-dcard" data-testid="sf-card-agent">
      <style>{CARD_STYLES}</style>
      <button type="button" className="plugin-directive-card-main" disabled={!data} onClick={event => void open(event.currentTarget)} title={data ? `Open ${data.apiName}${line ? ` at line ${line}` : ''}` : undefined}>
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
        <button type="button" className="plugin-directive-card-open" onClick={event => { event.stopPropagation(); void openStudio(); }} title="Open in Studio">
          Open in Studio
        </button>
      ) : null}
    </div>
  );
}
