import { controlText, useSalesforceControl } from './useSalesforceControl.js';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Bot, PanelRight } from 'lucide-react';
import { callPluginRpc, useSettings, useZccContext, useZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
import {
  breadcrumbSegments,
  buildAgentScriptFileTree,
  defaultExpandedFolders,
  filterAgentScriptFileTree,
  type AgentScriptTreeNode
} from '../../lib/agent-script-file-tree.js';
import { AGENT_SCRIPT_EXAMPLES } from '../../lib/agent-script-model.js';
import { type AgentScriptDialect, type PublicOrgView } from '../../lib/types.js';
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
import { orgSessionLabel } from '../../lib/org-session.js';
import { fetchConnectedOrg } from './org-rpc.js';
import { AgentforceLabPanel } from './AgentforceLabPanel.js';
import { AgentforceStudioSplit } from './AgentforceStudioSplit.js';
import { AGENTFORCE_STUDIO_STYLES } from './agentforce-studio-styles.js';
import { AGENT_SCRIPT_TOOLS, AgentScriptTools, useAgentScriptTools } from './AgentScriptTools.js';
import { OrgAgentsPanel } from './OrgAgentsPanel.js';
import { AgentScriptGraphPanel } from './AgentScriptGraphPanel.js';
import { AgentforcePreviewPanel } from './AgentforcePreviewPanel.js';
import type { AgentAction } from '../../lib/agent-action-model.js';
import { AgentActionExplorer, AgentActionPanel } from './AgentActionPanel.js';
import { AGENT_ACTION_STYLES } from './agent-action-styles.js';
import { agentDraftKey, readAgentDraft, writeAgentDraft, clearAgentDraft, rememberAgentSelection, recalledAgentSelection } from './agent-script-drafts.js';
import { NewAgentDialog } from './NewAgentDialog.js';
import { SaveAgentDialog } from './SaveAgentDialog.js';
import { EmptyState, LoadingState, SalesforceState } from './components/SalesforceState.js';

const PLUGIN_ID = 'salesforce';
const PANEL_ROOT: CSSProperties = { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' };
export const AGENTFORCE_PANEL_STYLES = `
.sf-as { --sf-as-surface: var(--bg-panel); --sf-as-elevated: var(--bg-panel, #22262e); --sf-as-sunken: #14161b; --sf-as-border: var(--border, #2c313a); --sf-as-text: var(--text-primary); --sf-as-muted: var(--text-muted, #9aa1ad); --sf-as-accent: var(--accent); }
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
.sf-as-save.is-dirty { background: var(--sf-as-accent); border-color: transparent; color: var(--text-on-accent,#fff); }
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

type AgentScriptPanelProps = {
  pluginId: string;
  projectId?: string;
  subPath?: string;
  params?: unknown;
  headerActions?: ReactNode;
  orgPicker?: boolean;
};
export function AgentScriptPanel(props: AgentScriptPanelProps) {
  const context = useZccContext();
  const projectId = props.projectId ?? context.projectId ?? undefined;
  return <AgentScriptWorkspace key={projectId ?? 'shared'} {...props} projectId={projectId} />;
}
function AgentScriptWorkspace(props: AgentScriptPanelProps) {
  const navigate = useZccNavigate();
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
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [newAgentOpen, setNewAgentOpen] = useState(false);
  const [draftWarning, setDraftWarning] = useState(false);
  const draftScope = projectId ?? `root:${String(settings.values?.projectRoot ?? '')}`;
  const activeDraft = useRef('');
  const fileEpoch = useRef(0);
  const alive = useRef(true);
  const saving = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; fileEpoch.current++; }; }, []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialect: AgentScriptDialect = 'agentforce';
  const tools = useAgentScriptTools(draftScope);
  const { openTool } = tools;
  const [playgroundReady, setPlaygroundReady] = useState(false);
  const [iframeError, setIframeError] = useState(false);
  const [playgroundTimedOut, setPlaygroundTimedOut] = useState(false);
  const [source, setSource] = useState('');
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [actionTabs, setActionTabs] = useState<Array<{ action: AgentAction; origin: 'project' | 'org' }>>([]);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const selectedTab = actionTabs.find(tab => tab.action.id === selectedActionId);
  const selectedAction = selectedTab && (actions.find(action => action.id === selectedActionId) ?? selectedTab.action);
  const openAction = useCallback((action: AgentAction, origin: 'project' | 'org' = 'project') => {
    setActionTabs(tabs => tabs.some(tab => tab.action.id === action.id) ? tabs.map(tab => tab.action.id === action.id ? { ...tab, action, origin } : tab) : [...tabs.slice(-7), { action, origin }]);
    setSelectedActionId(action.id);
    openTool('actions');
  }, [openTool]);
  const revealLine = useCallback((line: number) => {
    setSelectedActionId(null);
    postToPlayground(frameRef.current, { source: PLAYGROUND_BRIDGE_SOURCE, type: 'revealLine', line });
  }, []);
  const [issues, setIssues] = useState(0);
  const [fileQuery, setFileQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [examplesOpen, setExamplesOpen] = useState(true);
  const [org, setOrg] = useState<PublicOrgView | null>(null);
  const orgEpoch = useRef(0);
  const saveEnabled = Boolean(projectId) || Boolean(status?.dxProject);

  const rpcArgs = useCallback(
    (extra?: Record<string, unknown>) =>
      projectId ? { projectId: projectId, ...extra } : extra,
    [projectId]
  );

  const refreshOrg = useCallback(async () => {
    const current = ++orgEpoch.current;
    const payload = await fetchConnectedOrg(pluginId, projectId);
    if (current !== orgEpoch.current) return null;
    const next = payload.ok ? payload.org : null;
    setOrg(next);
    postToPlayground(frameRef.current, {
      source: PLAYGROUND_BRIDGE_SOURCE,
      type: 'setOrg',
      org: next
    });
    return next;
  }, [pluginId, projectId]);

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
    void callPluginRpc(pluginId, 'status', rpcArgs())
      .then((next) => {
        if (!cancelled) setStatus((next ?? {}) as StatusPayload);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    void refreshFiles().catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    void refreshOrg().catch(() => undefined);
    return () => {
      cancelled = true;
      orgEpoch.current++;
    };
  }, [pluginId, refreshFiles, refreshOrg]);

  useEffect(() => {
    const changed = (event: Event) => {
      const changedProject = (event as CustomEvent<{ projectId?: string | null }>).detail?.projectId;
      if (changedProject && changedProject !== projectId) return;
      void refreshOrg().catch(() => undefined);
    };
    window.addEventListener('sf:context-changed', changed);
    return () => window.removeEventListener('sf:context-changed', changed);
  }, [projectId, refreshOrg]);

  useEffect(() => {
    setExpanded(new Set(defaultExpandedFolders(files, activePath)));
  }, [files, activePath]);

  const openFile = useCallback(
    async (path: string | null, nextExampleId?: string, isCurrent: () => boolean = () => true) => {
      if (!isCurrent()) return false;
      const generation = ++fileEpoch.current;
      setError(null);
      setActionTabs([]);
      setSelectedActionId(null);
      setActions([]);
      setSource('');
      setIssues(0);
      if (!path) {
        const example =
          AGENT_SCRIPT_EXAMPLES.find((row) => row.id === nextExampleId) ?? AGENT_SCRIPT_EXAMPLES[0];
        const identity = `example:${example?.id ?? 'support-bot'}`;
        activeDraft.current = agentDraftKey(draftScope, identity);
        rememberAgentSelection(draftScope, identity);
        setActivePath(null);
        setExampleId(example?.id ?? 'support-bot');
        setSha256(undefined);
        setDirty(false);
        postToPlayground(frameRef.current, {
          source: PLAYGROUND_BRIDGE_SOURCE,
          type: 'setFile',
          draftKey: activeDraft.current,
          path: null,
          content: example?.source ?? '',
          dialect,
          readOnly: false
        });
        return true;
      }
      const result = (await callPluginRpc(pluginId, 'agentFiles.read', rpcArgs({ path }))) as {
        ok?: boolean;
        error?: string;
        file?: { path: string; content: string; sha256: string };
      };
      if (generation !== fileEpoch.current || !isCurrent()) return false;
      if (!result?.ok || !result.file) {
        setError(result?.error || 'Could not read Agentforce file.');
        return false;
      }
      const identity = `file:${result.file.path}`;
      activeDraft.current = agentDraftKey(draftScope, identity);
      rememberAgentSelection(draftScope, identity);
      setActivePath(result.file.path);
      setExampleId('');
      setSha256(result.file.sha256);
      setDirty(false);
      postToPlayground(frameRef.current, {
        source: PLAYGROUND_BRIDGE_SOURCE,
        type: 'setFile',
        draftKey: activeDraft.current,
        path: result.file.path,
        content: result.file.content,
        dialect,
        readOnly: false,
        sha256: result.file.sha256
      });
      return true;
    },
    [dialect, pluginId, rpcArgs, draftScope]
  );

  useSalesforceControl({ pluginId, projectId, orgAlias: org?.alias, threadId: context.threadId ?? undefined, surface: 'agentforce', enabled: playgroundReady,
    commands: ['state', 'file.open', 'file.filter', 'panel.open', 'panel.close', 'panel.show', 'panel.hide', 'editor.reveal'],
    state: () => ({ path: activePath, dirty, issues, ready: playgroundReady, sha256, panels: tools.state, filter: fileQuery }),
    execute: async ({ command, input }) => {
      if (command === 'state') return input.includeSource === true ? { source } : {};
      if (command === 'file.open') {
        if (dirty || busy) throw Error('Save the current draft before switching files.');
        const path = controlText(input, 'path');
        await refreshFiles();
        if (!await openFile(path)) throw Error('Could not open the requested file.');
        return { path };
      }
      if (command === 'file.filter') { setFileQuery(controlText(input, 'query', 200)); openTool('files'); return; }
      if (command === 'editor.reveal') {
        if (!Number.isInteger(input.line) || Number(input.line) < 1) throw Error('Provide a positive, 1-based line.');
        revealLine(Number(input.line)); return { revealedLine: input.line };
      }
      if (command === 'panel.show' || command === 'panel.hide') { tools.setOpen(command === 'panel.show'); return; }
      const tool = AGENT_SCRIPT_TOOLS.find(row => row.id === input.tool);
      if (!tool) throw Error('Choose a known Agentforce tool.');
      if (command === 'panel.open') openTool(tool.id); else tools.close(tool.id);
    },
  });

  const save = useCallback(() => {
    postToPlayground(frameRef.current, { source: PLAYGROUND_BRIDGE_SOURCE, type: 'flushSave' });
  }, []);

  const persistFromPlayground = useCallback(
    async (path: string, content: string, key = activeDraft.current, create = false) => {
      if (!saveEnabled || !path) { setError('Open a project folder before saving.'); setBusy(false); return; }
      if (saving.current) return;
      saving.current = true;
      setBusy(true); setError(null);
      try {
        const result = await callPluginRpc(pluginId, create ? 'agentFiles.create' : 'agentFiles.write',
          rpcArgs({ path, content, ...(create ? {} : { expectedSha256: readAgentDraft(key)?.baseSha ?? sha256 }) })
        ) as { ok?: boolean; error?: string; file?: { sha256: string; path: string } };
        if (!alive.current) return;
        if (!result?.ok || !result.file) { setError(result?.error || 'Save failed.'); return; }
        const remaining = readAgentDraft(key);
        if (remaining?.content === content) clearAgentDraft(key);
        else if (remaining && !create) writeAgentDraft({ ...remaining, baseSha: result.file.sha256 });
        if (key === activeDraft.current) {
          if (create) {
            if (remaining && remaining.content !== content) writeAgentDraft({ ...remaining, key: agentDraftKey(draftScope, `file:${result.file.path}`), baseSha: result.file.sha256 });
            setSaveAsOpen(false);
            await openFile(result.file.path);
          } else {
            setSha256(result.file.sha256);
            setDirty(Boolean(remaining && remaining.content !== content));
            postToPlayground(frameRef.current, { source: PLAYGROUND_BRIDGE_SOURCE, type: 'saved', draftKey: key, content, sha256: result.file.sha256 });
          }
        }
        if (alive.current) await refreshFiles();
      } catch (err) {
        if (alive.current) setError(err instanceof Error ? err.message : String(err));
      } finally {
        saving.current = false;
        if (alive.current) setBusy(false);
      }
    },
    [pluginId, refreshFiles, rpcArgs, saveEnabled, sha256, openFile, draftScope]
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== frameRef.current?.contentWindow) return;
      if (!isPlaygroundToHost(event.data)) return;
      const message = event.data;
      if ('draftKey' in message && message.draftKey && message.draftKey !== activeDraft.current) return;
      if (message.type === 'snapshot') {
        const nextActions = message.actions ?? [];
        setSource(message.content); setIssues(message.issues); setActions(nextActions);
        setActionTabs(tabs => tabs.filter(tab => tab.action.id.startsWith('dependency:') || nextActions.some(action => action.id === tab.action.id)));
        setSelectedActionId(id => id?.startsWith('dependency:') || nextActions.some(action => action.id === id) ? id : null);
        return;
      }
      if (message.type === 'openAction') {
        const action = actions.find(row => row.id === message.id);
        if (action) openAction(action);
        return;
      }
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
          view: 'script',
          org
        });
        void refreshOrg();
        const queued = projectId ? takeQueuedAgentScriptOpen(projectId) : null;
        const last = recalledAgentSelection(draftScope);
        const file = initialPath || queued || (last?.startsWith('file:') ? last.slice(5) : null);
        void openFile(file, last?.startsWith('example:') ? last.slice(8) : undefined);
        return;
      }
      if (message.type === 'dirty') {
        setDirty(message.dirty);
        if (message.draftKey) setSha256(message.baseSha);
        setDraftWarning(message.persisted === false);
        return;
      }
      if (message.type === 'requestOpen') {
        void openFile(message.path);
        return;
      }
      if (message.type === 'persist') {
        void persistFromPlayground(message.path, message.content, message.draftKey, message.create);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [dialect, files, openFile, persistFromPlayground, projectId, initialPath, refreshOrg, saveEnabled, org, actions, openAction, draftScope]);

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
  const documentBar = (
      <div className="af-document-bar">
        <button type="button" className="icon-btn" title="Browse org agents" aria-label="Browse org agents" onClick={() => openTool('agents')}><Bot size={15} aria-hidden="true" /></button>
        <div className="sf-as-crumb" aria-label="Agentforce file">
          {crumbs.length === 0 ? <span className="sf-as-crumb-seg">Untitled</span> : null}
          {crumbs.map((seg, index) => (
            <span key={`${seg}:${index}`} className="sf-as-crumb-seg">
              {index > 0 ? ' › ' : ''}
              {seg}
            </span>
          ))}
        </div>
        <span className="af-draft-state"><i />{dirty ? 'Unsaved draft' : activePath ? 'Saved' : 'Example'}{issues ? ` · ${issues} issues` : ''}</span>
        {props.headerActions}
        {props.orgPicker !== false && <OrgPicker pluginId={pluginId} projectId={projectId} compact />}
        {orgSessionLabel(org) ? (
          <span hidden className="sf-as-crumb-seg" data-testid="salesforce-playground-org">
            {orgSessionLabel(org)}
          </span>
        ) : null}
        <button
          type="button"
          className={`sf-as-save${dirty && !saveDisabled ? ' is-dirty' : ''}`}
          data-testid="salesforce-agent-script-save"
          aria-label="Save Agentforce file"
          hidden={!activePath}
          disabled={saveDisabled}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : !activePath ? 'Example' : dirty ? 'Save' : 'Saved'}
        </button>
        <button type="button" className="sf-as-save" disabled={!saveEnabled || busy || !playgroundReady} onClick={() => { setError(null); setSaveAsOpen(true); }}>Save as…</button>
        {!tools.state.open && <button type="button" className="icon-btn" title="Show side panel" aria-label="Show side panel" aria-expanded={false} onClick={tools.toggle}><PanelRight size={14} aria-hidden="true" /></button>}
      </div>
  );

  return (
    <div className="sf-as" style={PANEL_ROOT} data-testid="salesforce-agent-script-panel">
      <style>{AGENTFORCE_PANEL_STYLES}</style>
      <style>{AGENTFORCE_STUDIO_STYLES}</style>
      <style>{AGENT_ACTION_STYLES}</style>
      {newAgentOpen && <NewAgentDialog pluginId={pluginId} projectId={projectId} onClose={() => setNewAgentOpen(false)} onCreated={async file => { await refreshFiles(); await openFile(file.path); openTool('files'); }} />}
      {saveAsOpen && <SaveAgentDialog busy={busy} error={error} onClose={() => setSaveAsOpen(false)} onSave={path => {
        setBusy(true); setError(null);
        postToPlayground(frameRef.current, { source: PLAYGROUND_BRIDGE_SOURCE, type: 'flushSave', path, create: true });
      }} />}
      {draftWarning && <div className="sf-as-banner is-error" role="alert">Local recovery is unavailable for this draft. Save it to a project file before leaving.</div>}
      {hint ? <div className="sf-as-banner">{hint}</div> : null}
      {error ? <div className="sf-as-banner is-error" role="alert">{error}</div> : null}
      <div className="sf-as-body">
        <AgentforceStudioSplit open={tools.state.open} editor={<div className="af-action-workspace">
          {documentBar}
          {playgroundFailed ? (
          <div data-testid="salesforce-agent-script-playground-error"><SalesforceState kind="error" art="code" title="Editor unavailable">{PLAYGROUND_LOAD_ERROR}</SalesforceState></div>
        ) : (
          <div className="sf-frame-stage" style={{ position: 'relative', display: 'flex', flex: 1, minHeight: 0 }}>
            {!playgroundReady && <LoadingState art="code" label="Opening your editor…" hint="Preparing Agent Script tools." />}
            <iframe
              ref={frameRef}
              title="Agentforce playground"
              src={typeof process !== 'undefined' && process.env.VITEST ? 'about:blank' : PLAYGROUND_ASSET_SRC}
              style={{ flex: 1, minHeight: 0, width: '100%', border: 0, background: 'transparent' }}
            />
          </div>
        )}
        </div>}>
          <AgentScriptTools tools={tools} render={(id, visible) => {
            if (id === 'agents') return <OrgAgentsPanel pluginId={pluginId} projectId={projectId} visible={visible} editorReady={playgroundReady} onNew={() => setNewAgentOpen(true)} localFiles={files.filter(file => file.path.includes('aiAuthoringBundles/'))} onLocalOpen={path => void openFile(path)} onPublish={path => navigate.toCompose({ initialPrompt: `Review and publish this Salesforce Agentforce draft to the selected project org as an inactive version. Diagnose and compile it first, show any issues and use sf_agent lifecycle.publish with the normal confirmation. Do not activate.\nProject: ${projectId}\nSource: ${path}`, focusPrompt: true })} onOpen={async (file, isCurrent) => { await refreshFiles(); await openFile(file.path, undefined, isCurrent); }} />;
            if (id === 'files') return (
        <aside
          className="sf-as-explorer"
          data-testid="salesforce-agent-script-explorer"
          aria-label="Agentforce files"
        >
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
                    <EmptyState compact art={fileQuery ? 'search' : 'code'} title={fileQuery ? 'No matching files' : 'No .agent files in this folder.'}
                      action={<button className="af-text-button" type="button" onClick={() => openTool('agents')}>Browse agents in your org</button>}>
                      {fileQuery ? 'Try another file name.' : 'Create a local agent or retrieve a source from your org.'}
                    </EmptyState>
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
        </aside>
            );
            if (id === 'graph') return <AgentScriptGraphPanel source={source} visible={visible} onOpenAction={id => { const action = actions.find(row => row.id === id); if (action) openAction(action); }} />;
            if (id === 'preview' || id === 'test') return <AgentforceLabPanel pluginId={pluginId} projectId={projectId} source={source} mode={id === 'preview' ? 'rehearse' : 'test'} fileLabel={activePath?.split('/').pop() ?? exampleTitle ?? 'Draft'} />;
            if (id === 'org-preview') return <AgentforcePreviewPanel pluginId={pluginId} projectId={projectId} />;
            return <div className="af-action-workspace">
          {actionTabs.length > 0 && <div className="af-related-tabs" aria-label="Open agent files">
            <div className={`af-related-tab${!selectedActionId ? ' is-active' : ''}`}><button aria-pressed={!selectedActionId} onClick={() => setSelectedActionId(null)}>All actions</button></div>
            {actionTabs.map(tab => <div className={`af-related-tab${selectedActionId === tab.action.id ? ' is-active' : ''}`} key={tab.action.id}><button title={`${tab.action.owner} · ${tab.action.target}`} aria-pressed={selectedActionId === tab.action.id} onClick={() => setSelectedActionId(tab.action.id)}>{tab.action.name}</button><button aria-label={`Close ${tab.action.name}`} onClick={() => { setActionTabs(tabs => tabs.filter(t => t.action.id !== tab.action.id)); if (selectedActionId === tab.action.id) setSelectedActionId(null); }}>×</button></div>)}
          </div>}

              {!selectedAction && <div className="af-actions-list"><h2>Actions</h2><p>Explore implementations and references in the current script.</p><AgentActionExplorer actions={actions} selected={selectedActionId ?? undefined} onOpen={openAction} />{actions.length === 0 && <EmptyState compact art="code" title="No actions in this script yet.">Add an Apex or Flow action to explore its implementation here.</EmptyState>}</div>}
          {selectedAction && <AgentActionPanel key={`${projectId}:${activePath}:${selectedAction.id}`} pluginId={pluginId} projectId={projectId} org={org} action={selectedAction} initialOrigin={selectedTab?.origin} onOriginChange={origin => setActionTabs(tabs => tabs.map(tab => tab.action.id === selectedActionId ? { ...tab, origin } : tab))} onReveal={revealLine} onOpenTarget={(target, origin) => openAction({ id: `dependency:${target}`, name: target.split('://')[1], owner: `Referenced by ${selectedAction.name}`, target, line: 1, description: '', inputs: [], outputs: [], uses: [] }, origin)} />}
            </div>;
          }} />
        </AgentforceStudioSplit>
      </div>
    </div>
  );
}

export function AgentforcePlaygroundPanel(props: {
  pluginId: string;
  threadId?: string;
  projectId?: string;
  params?: unknown;
  headerActions?: ReactNode;
  orgPicker?: boolean;
}) {
  return (
    <AgentScriptPanel
      pluginId={props.pluginId}
      projectId={props.projectId}
      params={props.params}
      headerActions={props.headerActions}
      orgPicker={props.orgPicker}
    />
  );
}
