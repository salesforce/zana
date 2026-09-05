import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { callPluginRpc, setPluginSettings, useSettings, useZccContext } from '@zana-ai/zcc-plugin-sdk/app';
import {
  dialectOptions,
  normalizePlaygroundView,
  PLAYGROUND_VIEWS,
  playgroundViewLabel,
  type PlaygroundView
} from '../../lib/agent-script-chrome.js';
import {
  breadcrumbSegments,
  buildAgentScriptFileTree,
  defaultExpandedFolders,
  filterAgentScriptFileTree,
  type AgentScriptTreeNode
} from '../../lib/agent-script-file-tree.js';
import { AGENT_SCRIPT_EXAMPLES } from '../../lib/agent-script-model.js';
import { normalizeAgentScriptDialect, type AgentScriptDialect } from '../../lib/types.js';
import { takeQueuedAgentScriptOpen } from './agent-script-open.js';
import { parseAgentforcePanelPath } from './agentforce-panel-params.js';
import { OrgPicker } from './OrgPicker.js';
import {
  isPlaygroundToHost,
  PLAYGROUND_ASSET_SRC,
  PLAYGROUND_BRIDGE_SOURCE,
  readDocumentTheme,
  type HostToPlayground,
  type PlaygroundFileRef
} from './playground-bridge.js';
import {
  PLAYGROUND_LOAD_ERROR,
  PLAYGROUND_READY_MS,
  playgroundHint,
  saveIsDisabled,
  shouldShowPlaygroundFailure
} from './agent-script-panel-logic.js';

const PLUGIN_ID = 'salesforce';
const PANEL_ROOT: CSSProperties = { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' };
export const AGENTFORCE_PANEL_STYLES = `
.sf-as { --sf-as-surface: var(--bg, #1a1d23); --sf-as-elevated: var(--bg-panel, #22262e); --sf-as-sunken: #14161b; --sf-as-border: var(--border, #2c313a); --sf-as-text: var(--text, #e6e8ec); --sf-as-muted: var(--text-muted, #9aa1ad); --sf-as-accent: #1b96ff; }
.sf-as-header { display: flex; align-items: center; gap: 12px; height: 48px; padding: 0 16px; flex-shrink: 0; background: var(--sf-as-elevated); border-bottom: 1px solid var(--sf-as-border); color: var(--sf-as-text); }
.sf-as-brand { font-size: 13px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; }
.sf-as-crumb { display: flex; align-items: center; gap: 6px; min-width: 0; color: var(--sf-as-muted); font-size: 13px; }
.sf-as-crumb-seg { color: var(--sf-as-muted); white-space: nowrap; }
.sf-as-crumb-seg:last-child { color: var(--sf-as-text); overflow: hidden; text-overflow: ellipsis; }
.sf-as-tabs { display: flex; gap: 2px; margin-left: 8px; padding: 2px; border-radius: 999px; border: 1px solid var(--sf-as-border); background: var(--sf-as-sunken); }
.sf-as-tab { display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: 999px; padding: 4px 12px; font-size: 12px; font-weight: 500; color: var(--sf-as-muted); background: transparent; cursor: pointer; }
.sf-as-tab.is-active { color: var(--sf-as-text); background: var(--sf-as-elevated); box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 0 0 1px var(--sf-as-border); }
.sf-as-spacer { flex: 1; }
.sf-as-dialect { font: inherit; font-size: 11px; font-weight: 500; color: var(--sf-as-muted); background: transparent; border: 0; }
.sf-org-picker { font: inherit; font-size: 11px; font-weight: 500; color: var(--sf-as-muted); background: transparent; border: 1px solid var(--sf-as-border); border-radius: 6px; height: 28px; max-width: 240px; padding: 0 6px; }
.sf-as-save { height: 28px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--sf-as-border); background: transparent; color: var(--sf-as-muted); font-size: 12px; font-weight: 600; cursor: pointer; }
.sf-as-save.is-dirty { background: var(--sf-as-accent); border-color: transparent; color: #061121; }
.sf-as-save:disabled { opacity: .45; cursor: default; }
.sf-as-banner { padding: 6px 16px; font-size: 12px; color: var(--sf-as-muted); border-bottom: 1px solid var(--sf-as-border); }
.sf-as-banner.is-error { color: var(--danger, #ff8a8a); }
.sf-as-body { display: flex; flex: 1; min-height: 0; }
.sf-as-explorer { width: 240px; flex-shrink: 0; display: flex; flex-direction: column; background: var(--sf-as-sunken); border-right: 1px solid var(--sf-as-border); color: var(--sf-as-text); }
.sf-as-explorer.is-collapsed { width: 36px; }
.sf-as-explorer-head { display: flex; align-items: center; gap: 6px; padding: 8px 8px 6px; }
.sf-as-explorer-title { font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--sf-as-muted); flex: 1; }
.sf-as-explorer-toggle, .sf-as-tree-btn { border: 0; background: transparent; color: inherit; cursor: pointer; }
.sf-as-explorer-toggle { width: 22px; height: 22px; border-radius: 6px; color: var(--sf-as-muted); }
.sf-as-explorer-search { margin: 0 8px 8px; font: inherit; font-size: 12px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--sf-as-border); background: var(--sf-as-elevated); color: var(--sf-as-text); }
.sf-as-explorer-scroll { flex: 1; min-height: 0; overflow: auto; padding: 0 6px 10px; }
.sf-as-section { margin-bottom: 8px; }
.sf-as-section-label { font-size: 10px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--sf-as-muted); padding: 4px 6px; }
.sf-as-tree-btn { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; border-radius: 6px; padding: 4px 6px; font-size: 12px; color: var(--sf-as-text); }
.sf-as-tree-btn:hover { background: var(--sf-as-elevated); }
.sf-as-tree-btn.is-active { background: color-mix(in srgb, var(--sf-as-accent) 18%, transparent); box-shadow: inset 2px 0 0 var(--sf-as-accent); }
.sf-as-tree-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sf-as-tree-meta { margin-left: auto; font-size: 10px; color: var(--sf-as-muted); }
.sf-as-empty { padding: 8px 10px; font-size: 12px; color: var(--sf-as-muted); }
.sf-as-stage { flex: 1; min-width: 0; min-height: 0; display: flex; }
`;

type StatusPayload = {
  projectRoot?: string;
  dxProject?: boolean;
  agentScriptDialect?: AgentScriptDialect;
  defaultOrg?: string;
};

function postToPlayground(frame: HTMLIFrameElement | null, message: HostToPlayground): void {
  try {
    frame?.contentWindow?.postMessage(message, window.location.origin);
  } catch {
    // iframe may still be about:blank (tests) or not yet same-origin
  }
}

function FileTree({
  nodes,
  depth,
  expanded,
  activePath,
  onToggle,
  onOpen
}: {
  nodes: AgentScriptTreeNode[];
  depth: number;
  expanded: ReadonlySet<string>;
  activePath: string | null;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === 'folder') {
          const open = expanded.has(node.path);
          return (
            <div key={node.path} className="sf-as-tree-folder">
              <button
                type="button"
                className="sf-as-tree-btn"
                style={{ paddingLeft: 6 + depth * 12 }}
                aria-expanded={open}
                onClick={() => onToggle(node.path)}
              >
                <span aria-hidden="true">{open ? '▾' : '▸'}</span>
                <span className="sf-as-tree-name">{node.name}</span>
              </button>
              {open ? (
                <FileTree
                  nodes={node.children}
                  depth={depth + 1}
                  expanded={expanded}
                  activePath={activePath}
                  onToggle={onToggle}
                  onOpen={onOpen}
                />
              ) : null}
            </div>
          );
        }
        return (
          <button
            key={node.path}
            type="button"
            className={`sf-as-tree-btn${activePath === node.path ? ' is-active' : ''}`}
            style={{ paddingLeft: 6 + depth * 12 }}
            data-testid={`salesforce-agent-script-file:${node.path}`}
            aria-current={activePath === node.path ? 'true' : undefined}
            onClick={() => onOpen(node.path)}
          >
            <span className="sf-as-tree-name">{node.apiName}</span>
            <span className="sf-as-tree-meta">{node.lines}</span>
          </button>
        );
      })}
    </>
  );
}

export function AgentScriptPanel(props: {
  pluginId: string;
  projectId?: string;
  subPath?: string;
  params?: unknown;
}) {
  const pluginId = props.pluginId || PLUGIN_ID;
  const context = useZccContext();
  const projectId = props.projectId ?? context.projectId ?? undefined;
  const initialPath = parseAgentforcePanelPath(props.params) ?? props.subPath ?? null;
  const settings = useSettings();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [files, setFiles] = useState<PlaygroundFileRef[]>([]);
  const [activePath, setActivePath] = useState<string | null>(initialPath || null);
  const [exampleId, setExampleId] = useState(AGENT_SCRIPT_EXAMPLES[0]?.id ?? 'support-bot');
  const [sha256, setSha256] = useState<string | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialectOverride, setDialectOverride] = useState<AgentScriptDialect | null>(null);
  const [playgroundReady, setPlaygroundReady] = useState(false);
  const [iframeError, setIframeError] = useState(false);
  const [playgroundTimedOut, setPlaygroundTimedOut] = useState(false);
  const [view, setView] = useState<PlaygroundView>('script');
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [fileQuery, setFileQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [examplesOpen, setExamplesOpen] = useState(true);
  const dialect =
    dialectOverride ??
    normalizeAgentScriptDialect((settings.values as Record<string, unknown> | undefined)?.agentScriptDialect);
  const saveEnabled = Boolean(projectId) || Boolean(status?.dxProject);

  const rpcArgs = useCallback(
    (extra?: Record<string, unknown>) =>
      projectId ? { projectId: projectId, ...extra } : extra,
    [projectId]
  );

  const refreshFiles = useCallback(async () => {
    const listed = (await callPluginRpc(pluginId, 'agentFiles.list', rpcArgs())) as {
      ok?: boolean;
      files?: PlaygroundFileRef[];
      error?: string;
    };
    if (listed?.ok && Array.isArray(listed.files)) setFiles(listed.files);
  }, [pluginId, rpcArgs]);

  useEffect(() => {
    let cancelled = false;
    void callPluginRpc(pluginId, 'status')
      .then((next) => {
        if (!cancelled) setStatus((next ?? {}) as StatusPayload);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    void refreshFiles().catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
    };
  }, [pluginId, refreshFiles]);

  useEffect(() => {
    setExpanded(new Set(defaultExpandedFolders(files, activePath)));
  }, [files, activePath]);

  const openFile = useCallback(
    async (path: string | null, nextExampleId?: string) => {
      setError(null);
      if (!path) {
        const example =
          AGENT_SCRIPT_EXAMPLES.find((row) => row.id === nextExampleId) ?? AGENT_SCRIPT_EXAMPLES[0];
        setActivePath(null);
        setExampleId(example?.id ?? 'support-bot');
        setSha256(undefined);
        setDirty(false);
        postToPlayground(frameRef.current, {
          source: PLAYGROUND_BRIDGE_SOURCE,
          type: 'setFile',
          path: null,
          content: example?.source ?? '',
          dialect: example?.dialect ?? dialect,
          readOnly: false
        });
        return;
      }
      const result = (await callPluginRpc(pluginId, 'agentFiles.read', rpcArgs({ path }))) as {
        ok?: boolean;
        error?: string;
        file?: { path: string; content: string; sha256: string };
      };
      if (!result?.ok || !result.file) {
        setError(result?.error || 'Could not read Agentforce file.');
        return;
      }
      setActivePath(result.file.path);
      setExampleId('');
      setSha256(result.file.sha256);
      setDirty(false);
      postToPlayground(frameRef.current, {
        source: PLAYGROUND_BRIDGE_SOURCE,
        type: 'setFile',
        path: result.file.path,
        content: result.file.content,
        dialect,
        readOnly: false,
        sha256: result.file.sha256
      });
    },
    [dialect, pluginId, rpcArgs]
  );

  const save = useCallback(() => {
    postToPlayground(frameRef.current, { source: PLAYGROUND_BRIDGE_SOURCE, type: 'flushSave' });
  }, []);

  const persistFromPlayground = useCallback(
    async (path: string, content: string) => {
      if (!saveEnabled || !path) {
        setError('Open a project folder before saving.');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const result = (await callPluginRpc(
          pluginId,
          'agentFiles.write',
          rpcArgs({ path, content, expectedSha256: sha256 })
        )) as { ok?: boolean; error?: string; file?: { sha256: string; path: string } };
        if (!result?.ok || !result.file) {
          setError(result?.error || 'Save failed.');
          return;
        }
        setSha256(result.file.sha256);
        setDirty(false);
        postToPlayground(frameRef.current, {
          source: PLAYGROUND_BRIDGE_SOURCE,
          type: 'saved',
          sha256: result.file.sha256
        });
        await refreshFiles();
      } finally {
        setBusy(false);
      }
    },
    [pluginId, refreshFiles, rpcArgs, saveEnabled, sha256]
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!isPlaygroundToHost(event.data)) return;
      const message = event.data;
      if (message.type === 'ready') {
        setPlaygroundReady(true);
        setIframeError(false);
        setPlaygroundTimedOut(false);
        postToPlayground(frameRef.current, {
          source: PLAYGROUND_BRIDGE_SOURCE,
          type: 'init',
          dialect,
          theme: readDocumentTheme(),
          examples: AGENT_SCRIPT_EXAMPLES,
          files,
          saveEnabled,
          view
        });
        const queued = projectId ? takeQueuedAgentScriptOpen(projectId) : null;
        void openFile(initialPath || queued || null);
        return;
      }
      if (message.type === 'dirty') {
        setDirty(message.dirty);
        return;
      }
      if (message.type === 'requestOpen') {
        void openFile(message.path);
        return;
      }
      if (message.type === 'persist') {
        void persistFromPlayground(message.path, message.content);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [dialect, files, openFile, persistFromPlayground, projectId, initialPath, saveEnabled, view]);

  useEffect(() => {
    if (!projectId || !playgroundReady) return;
    const queued = takeQueuedAgentScriptOpen(projectId);
    if (queued) void openFile(queued);
  }, [openFile, playgroundReady, projectId]);

  useEffect(() => {
    if (typeof process !== 'undefined' && process.env.VITEST) return;
    if (playgroundReady || iframeError) return;
    const timer = window.setTimeout(() => setPlaygroundTimedOut(true), PLAYGROUND_READY_MS);
    return () => window.clearTimeout(timer);
  }, [playgroundReady, iframeError]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onError = () => setIframeError(true);
    frame.addEventListener('error', onError);
    return () => frame.removeEventListener('error', onError);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      postToPlayground(frameRef.current, {
        source: PLAYGROUND_BRIDGE_SOURCE,
        type: 'setTheme',
        theme: readDocumentTheme()
      });
    });
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const tree = useMemo(
    () => filterAgentScriptFileTree(buildAgentScriptFileTree(files), fileQuery),
    [fileQuery, files]
  );
  const exampleTitle = AGENT_SCRIPT_EXAMPLES.find((row) => row.id === exampleId)?.title;
  const crumbs = breadcrumbSegments(activePath, exampleTitle);
  const hint = useMemo(
    () => playgroundHint(Boolean(status), status?.dxProject, Boolean(projectId)),
    [projectId, status]
  );
  const playgroundFailed = shouldShowPlaygroundFailure({
    ready: playgroundReady,
    iframeError,
    timedOut: playgroundTimedOut
  });
  const saveDisabled = saveIsDisabled(saveEnabled, activePath, busy);

  return (
    <div className="sf-as" style={PANEL_ROOT} data-testid="salesforce-agent-script-panel">
      <style>{AGENTFORCE_PANEL_STYLES}</style>
      <header className="sf-as-header">
        <span className="sf-as-brand">Playground</span>
        <div className="sf-as-crumb" aria-label="Agentforce file">
          {crumbs.length === 0 ? <span className="sf-as-crumb-seg">Untitled</span> : null}
          {crumbs.map((seg, index) => (
            <span key={`${seg}:${index}`} className="sf-as-crumb-seg">
              {index > 0 ? ' › ' : ''}
              {seg}
            </span>
          ))}
        </div>
        <nav className="sf-as-tabs" aria-label="Agentforce view">
          {PLAYGROUND_VIEWS.map((id) => (
            <button
              key={id}
              type="button"
              className={`sf-as-tab${view === id ? ' is-active' : ''}`}
              aria-pressed={view === id}
              onClick={() => {
                const next = normalizePlaygroundView(id);
                setView(next);
                postToPlayground(frameRef.current, {
                  source: PLAYGROUND_BRIDGE_SOURCE,
                  type: 'setView',
                  view: next
                });
              }}
            >
              {playgroundViewLabel(id)}
            </button>
          ))}
        </nav>
        <span className="sf-as-spacer" />
        <OrgPicker pluginId={pluginId} compact />
        <select
          className="sf-as-dialect"
          aria-label="Agentforce dialect"
          value={dialect}
          onChange={(event) => {
            const next = normalizeAgentScriptDialect(event.target.value);
            setDialectOverride(next);
            void setPluginSettings(pluginId, { agentScriptDialect: next }).catch(() => undefined);
            postToPlayground(frameRef.current, {
              source: PLAYGROUND_BRIDGE_SOURCE,
              type: 'setDialect',
              dialect: next
            });
          }}
        >
          {dialectOptions().map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`sf-as-save${dirty && !saveDisabled ? ' is-dirty' : ''}`}
          data-testid="salesforce-agent-script-save"
          aria-label="Save Agentforce file"
          disabled={saveDisabled}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
      </header>
      {hint ? <div className="sf-as-banner">{hint}</div> : null}
      {error ? <div className="sf-as-banner is-error">{error}</div> : null}
      <div className="sf-as-body">
        <aside
          className={`sf-as-explorer${explorerOpen ? '' : ' is-collapsed'}`}
          data-testid="salesforce-agent-script-explorer"
          aria-label="Agentforce files"
        >
          <div className="sf-as-explorer-head">
            {explorerOpen ? <span className="sf-as-explorer-title">Scripts</span> : null}
            <button
              type="button"
              className="sf-as-explorer-toggle"
              aria-label={explorerOpen ? 'Collapse file tree' : 'Expand file tree'}
              onClick={() => setExplorerOpen((open) => !open)}
            >
              {explorerOpen ? '‹' : '›'}
            </button>
          </div>
          {explorerOpen ? (
            <>
              <input
                className="sf-as-explorer-search"
                aria-label="Filter Agentforce files"
                placeholder="Filter files"
                value={fileQuery}
                onChange={(event) => setFileQuery(event.target.value)}
              />
              <div className="sf-as-explorer-scroll">
                <div className="sf-as-section">
                  <button
                    type="button"
                    className="sf-as-section-label sf-as-tree-btn"
                    aria-expanded={examplesOpen}
                    onClick={() => setExamplesOpen((open) => !open)}
                  >
                    {examplesOpen ? '▾' : '▸'} Examples
                  </button>
                  {examplesOpen
                    ? AGENT_SCRIPT_EXAMPLES.map((example) => (
                        <button
                          key={example.id}
                          type="button"
                          className={`sf-as-tree-btn${!activePath && exampleId === example.id ? ' is-active' : ''}`}
                          style={{ paddingLeft: 18 }}
                          onClick={() => void openFile(null, example.id)}
                        >
                          <span className="sf-as-tree-name">{example.title}</span>
                        </button>
                      ))
                    : null}
                </div>
                <div className="sf-as-section">
                  <div className="sf-as-section-label">Project</div>
                  {tree.length === 0 ? (
                    <p className="sf-as-empty">No .agent files in this folder.</p>
                  ) : (
                    <FileTree
                      nodes={tree}
                      depth={0}
                      expanded={expanded}
                      activePath={activePath}
                      onToggle={(path) => {
                        setExpanded((current) => {
                          const next = new Set(current);
                          if (next.has(path)) next.delete(path);
                          else next.add(path);
                          return next;
                        });
                      }}
                      onOpen={(path) => void openFile(path)}
                    />
                  )}
                </div>
              </div>
            </>
          ) : null}
        </aside>
        {playgroundFailed ? (
          <p data-testid="salesforce-agent-script-playground-error" style={{ color: 'var(--danger, #c00)', padding: 16 }}>
            {PLAYGROUND_LOAD_ERROR}
          </p>
        ) : (
          <div className="sf-as-stage">
            <iframe
              ref={frameRef}
              title="Agentforce playground"
              src={typeof process !== 'undefined' && process.env.VITEST ? 'about:blank' : PLAYGROUND_ASSET_SRC}
              style={{ flex: 1, minHeight: 0, width: '100%', border: 0, background: 'transparent' }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function AgentforcePlaygroundPanel(props: {
  pluginId: string;
  threadId?: string;
  projectId?: string;
  params?: unknown;
}) {
  return (
    <AgentScriptPanel
      pluginId={props.pluginId}
      projectId={props.projectId}
      params={props.params}
    />
  );
}
