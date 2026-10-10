import { useSalesforceControl } from './useSalesforceControl.js';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Bot, Cloud, Code, FlaskConical, Files, MessageSquare, Network, Play, Search, Sparkles, Zap } from 'lucide-react';
import { callPluginRpc, useRealtime, useSettings, useZccContext, useZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
import { type AgentScriptDialect, type PublicOrgView } from '../../lib/types.js';
import {
  STUDIO_CHANGED_CHANNEL,
  STUDIO_RPC,
  type ExplorerNode,
  type ProposalOutcome,
  type ProposeEditInput,
  type StudioComment,
  type StudioDiagnostic,
  type StudioEngine,
  type StudioTool
} from '../../lib/studio-contract.js';
import { takeQueuedAgentScriptOpen } from './agent-script-open.js';
import { focusKey, parseAgentforcePanelFocus, type StudioFocus } from './agentforce-panel-params.js';
import { OrgPicker } from './OrgPicker.js';
import { AgentScriptDocumentBar } from './AgentScriptDocumentBar.js';
import {
  PLAYGROUND_ASSET_SRC,
  readDocumentTheme,
  type PlaygroundFileRef
} from './playground-bridge.js';
import { usePlaygroundBridge } from './studio/usePlaygroundBridge.js';
import { createStudioCommandExecutor } from './studio/studio-commands.js';
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
import { AgentScriptTools, useAgentScriptTools, type AgentScriptTool } from './AgentScriptTools.js';
import { OrgAgentsPanel } from './OrgAgentsPanel.js';
import type { RetrievedOrgAgent } from '../../lib/org-agent-contract.js';
import { AgentScriptGraphPanel } from './AgentScriptGraphPanel.js';
import { AgentforcePreviewPanel } from './AgentforcePreviewPanel.js';
import type { AgentAction } from '../../lib/agent-action-model.js';
import { AgentActionExplorer, AgentActionPanel } from './AgentActionPanel.js';
import { AGENT_ACTION_STYLES } from './agent-action-styles.js';
import { agentDraftKey, readAgentDraft, writeAgentDraft, clearAgentDraft, rememberAgentSelection, recalledAgentSelection } from './agent-script-drafts.js';
import { NewAgentDialog } from './NewAgentDialog.js';
import { SaveAgentDialog } from './SaveAgentDialog.js';
import { EmptyState, LoadingState, SalesforceState } from './components/SalesforceState.js';
import { PreviewWorkbench, type PreviewCommand } from './preview/PreviewWorkbench.js';
import { OperationsPanel } from './panels/OperationsPanel.js';
import { AssistantRail } from './studio/AssistantRail.js';
import { ContextStrip } from './studio/ContextStrip.js';
import { CommentsPane } from './studio/CommentsPane.js';
import { useStudioView } from './studio/useStudioView.js';
import { StudioShell } from './studio/StudioShell.js';
import { Explorer } from './studio/Explorer.js';
import { EditorTabs } from './studio/EditorTabs.js';
import { LightningTypeView } from './studio/LightningTypeView.js';
import { BottomPanel, type BottomTab } from './studio/BottomPanel.js';
import { ProblemsPanel } from './studio/ProblemsPanel.js';
import { ToolStrip, type StripItem } from './studio/ToolStrip.js';
import type { QuickOpenItem } from './studio/QuickOpen.js';
import { layoutForTier, useWidthTier } from './studio/useWidthTier.js';
import { useStudioLayout, type CompactTool, type EditorTab } from './studio/studio-layout.js';
import { applyProposalEdits } from './studio/proposal-edits.js';
import { BottomTests, BottomTrace } from './studio/BottomPanes.js';
import { STUDIO_TOKENS } from './studio/studio-tokens.js';
import { useSuites, withSuiteBadges } from './studio/useSuites.js';

const PLUGIN_ID = 'salesforce';
const PANEL_ROOT: CSSProperties = { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' };
export const AGENTFORCE_PANEL_STYLES = `
${STUDIO_TOKENS}.sf-as-header { display: flex; align-items: center; gap: 12px; height: 48px; padding: 0 16px; flex-shrink: 0; background: var(--sf-elevated); border-bottom: 1px solid var(--sf-border); color: var(--sf-text); }
.sf-as-brand { font-size: 13px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; }
.sf-as-crumb { display: flex; align-items: center; gap: 6px; min-width: 0; color: var(--sf-muted); font-size: 13px; }
.sf-as-crumb-seg { color: var(--sf-muted); white-space: nowrap; }
.sf-as-crumb-seg:last-child { color: var(--sf-text); overflow: hidden; text-overflow: ellipsis; }
.sf-as-tabs { display: flex; gap: 2px; margin-left: 8px; padding: 2px; border-radius: 999px; border: 1px solid var(--sf-border); background: var(--sf-sunken); }
.sf-as-tab { display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: 999px; padding: 4px 12px; font-size: 12px; font-weight: 500; color: var(--sf-muted); background: transparent; cursor: pointer; }
.sf-as-tab.is-active { color: var(--sf-text); background: var(--sf-elevated); box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 0 0 1px var(--sf-border); }
.sf-as-spacer { flex: 1; }
.sf-as-dialect { font: inherit; font-size: 11px; font-weight: 500; color: var(--sf-muted); background: transparent; border: 0; }
.sf-org-picker { font: inherit; font-size: 11px; font-weight: 500; color: var(--sf-muted); background: transparent; border: 1px solid var(--sf-border); border-radius: 6px; height: 28px; max-width: 240px; padding: 0 6px; }
.sf-as-save { height: 28px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--sf-border); background: transparent; color: var(--sf-muted); font-size: 12px; font-weight: 600; cursor: pointer; }
.sf-as-save.is-dirty { background: var(--sf-accent); border-color: transparent; color: var(--sf-on-accent); }
.sf-as-save:disabled { opacity: .45; cursor: default; }
.sf-as-banner { padding: 6px 16px; font-size: 12px; color: var(--sf-muted); border-bottom: 1px solid var(--sf-border); }
.sf-as-banner.is-error { color: var(--sf-danger); }
.sf-as-body { display: flex; flex: 1; min-height: 0; }
.sf-as-explorer { width: 240px; flex-shrink: 0; display: flex; flex-direction: column; background: var(--sf-sunken); border-right: 1px solid var(--sf-border); color: var(--sf-text); }
.sf-as-explorer.is-collapsed { width: 36px; }
.sf-as-explorer-head { display: flex; align-items: center; gap: 6px; padding: 8px 8px 6px; }
.sf-as-explorer-title { font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--sf-muted); flex: 1; }
.sf-as-explorer-toggle, .sf-as-tree-btn { border: 0; background: transparent; color: inherit; cursor: pointer; }
.sf-as-explorer-toggle { width: 22px; height: 22px; border-radius: 6px; color: var(--sf-muted); }
.sf-as-explorer-search { margin: 0 8px 8px; font: inherit; font-size: 12px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--sf-border); background: var(--sf-elevated); color: var(--sf-text); }
.sf-as-explorer-scroll { flex: 1; min-height: 0; overflow: auto; padding: 0 6px 10px; }
.sf-as-section { margin-bottom: 8px; }
.sf-as-section-label { font-size: 10px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--sf-muted); padding: 4px 6px; }
.sf-as-tree-btn { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; border-radius: 6px; padding: 4px 6px; font-size: 12px; color: var(--sf-text); }
.sf-as-tree-btn:hover { background: var(--sf-elevated); }
.sf-as-tree-btn.is-active { background: color-mix(in srgb, var(--sf-accent) 18%, transparent); box-shadow: inset 2px 0 0 var(--sf-accent); }
.sf-as-tree-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sf-as-tree-meta { margin-left: auto; font-size: 10px; color: var(--sf-muted); }
.sf-as-empty { padding: 8px 10px; font-size: 12px; color: var(--sf-muted); }
.sf-as-stage { flex: 1; min-width: 0; min-height: 0; display: flex; }
`;

type StatusPayload = {
  projectRoot?: string;
  dxProject?: boolean;
  agentScriptDialect?: AgentScriptDialect;
  defaultOrg?: string;
};

const TOOL_ICON: Record<CompactTool, ReactNode> = {
  code: <Code size={16} aria-hidden="true" />, agents: <Bot size={16} aria-hidden="true" />, files: <Files size={16} aria-hidden="true" />,
  graph: <Network size={16} aria-hidden="true" />, preview: <Play size={16} aria-hidden="true" />, test: <FlaskConical size={16} aria-hidden="true" />,
  actions: <Zap size={16} aria-hidden="true" />, 'org-preview': <Cloud size={16} aria-hidden="true" />,
  assistant: <Sparkles size={16} aria-hidden="true" />, comments: <MessageSquare size={16} aria-hidden="true" />
};
const TOOL_TITLE: Record<CompactTool, string> = {
  code: 'Code', agents: 'Agents', files: 'Files', graph: 'Graph', preview: 'Preview', test: 'Tests', actions: 'Actions',
  'org-preview': 'Org preview', assistant: 'Assistant', comments: 'Comments'
};
/** Tools offered by the compact strip, in order. Files (QuickOpen) and Assistant (ContextStrip) are intentionally absent. */
const COMPACT_TOOLS: readonly CompactTool[] = ['code', 'agents', 'graph', 'preview', 'test', 'actions', 'comments', 'org-preview'];
const HIDDEN_COMPACT: readonly AgentScriptTool[] = ['files', 'assistant'];
const HIDDEN_WIDE: readonly AgentScriptTool[] = ['files'];
const NO_HIDDEN: readonly AgentScriptTool[] = [];
const stripItem = (id: CompactTool, badge?: number): StripItem => ({ id, title: TOOL_TITLE[id], icon: TOOL_ICON[id], ...(badge ? { badge } : {}) });
const STUDIO_TOOL_FOR: Record<string, StudioTool | null> = { test: 'tests', files: 'code', 'org-preview': null, new: null };
const TARGET_PATTERN = /^(apex|flow):\/\/([A-Za-z][A-Za-z0-9_.]*)$/;
const basename = (path: string) => path.split('/').pop() ?? path;
const targetAction = (target: string, owner: string): AgentAction => ({ id: `dependency:${target}`, name: target.split('://')[1] ?? target, owner, target, line: 1, description: '', inputs: [], outputs: [], uses: [] });
const SAVE_DEBOUNCE_MS = 150;

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
  const focus = parseAgentforcePanelFocus(props.params);
  const focusSignature = focusKey(focus);
  const initialPath = focus.path ?? props.subPath ?? null;
  const settings = useSettings();
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [files, setFiles] = useState<PlaygroundFileRef[]>([]);
  const [explorerNodes, setExplorerNodes] = useState<ExplorerNode[]>([]);
  const [activePath, setActivePath] = useState<string | null>(initialPath || null);
  const [sha256, setSha256] = useState<string | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [newAgentOpen, setNewAgentOpen] = useState(false);
  const [draftWarning, setDraftWarning] = useState(false);
  const draftScope = projectId ?? `root:${String(settings.values?.projectRoot ?? '')}`;
  const activeDraft = useRef('');
  const { frameRef, send, handlers: bridgeHandlers } = usePlaygroundBridge(activeDraft);
  const fileEpoch = useRef(0);
  const alive = useRef(true);
  const saving = useRef(false);
  const lastSave = useRef(0);
  const pendingProposals = useRef(new Map<string, (outcome: ProposalOutcome) => void>());
  const settleProposals = useCallback((note: string) => {
    for (const [proposalId, resolve] of pendingProposals.current) {
      resolve({ outcome: 'rejected', acceptedHunks: 0, rejectedHunks: 0, note });
      send.clearProposal(proposalId);
    }
    pendingProposals.current.clear();
  }, [send]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; fileEpoch.current++; settleProposals('The editor was closed before the proposal was resolved.'); };
  }, [settleProposals]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialect: AgentScriptDialect = 'agentforce';
  const tools = useAgentScriptTools(draftScope);
  const [tierRef, tier] = useWidthTier();
  const layout = layoutForTier(tier);
  const compact = layout === 'compact';
  const wide = layout === 'wide';
  const studioLayout = useStudioLayout(draftScope);
  const { state: studio, patch, openTab, selectTab, closeTab } = studioLayout;
  const [quickOpen, setQuickOpen] = useState(false);
  const suites = useSuites(pluginId, projectId);
  const [playgroundReady, setPlaygroundReady] = useState(false);
  const [iframeError, setIframeError] = useState(false);
  const [playgroundTimedOut, setPlaygroundTimedOut] = useState(false);
  const [source, setSource] = useState('');
  const [diagnostics, setDiagnostics] = useState<StudioDiagnostic[]>([]);
  const [cursor, setCursor] = useState<{ line: number; column: number } | undefined>(undefined);
  const [selection, setSelection] = useState<{ startLine: number; endLine: number; text: string } | undefined>(undefined);
  const [comments, setComments] = useState<StudioComment[]>([]);
  // Bumped on every successful file read so comments reload even when the same path is reopened.
  const [fileLoads, setFileLoads] = useState(0);
  const [addComment, setAddComment] = useState<{ line: number; endLine: number; quote: string } | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [fixBusy, setFixBusy] = useState(false);
  const [previewEngine, setPreviewEngine] = useState<StudioEngine>('rehearse');
  const [previewCommand, setPreviewCommand] = useState<PreviewCommand | null>(null);
  // Monotonic, so a command issued after one was handled and dropped never reuses its seq.
  const previewSeq = useRef(0);
  const previewCommandHandled = useCallback((seq: number) => setPreviewCommand(current => current?.seq === seq ? null : current), []);
  const [lastRun, setLastRun] = useState<{ runId: string; engine: StudioEngine; turn: number } | null>(null);
  const [graphFocus, setGraphFocus] = useState<{ node: string | null; seq: number }>({ node: null, seq: 0 });
  const [editorCompactOverride, setEditorCompactOverride] = useState<boolean | null>(null);
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [actionTabs, setActionTabs] = useState<Array<{ action: AgentAction; origin: 'project' | 'org' }>>([]);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const selectedTab = actionTabs.find(tab => tab.action.id === selectedActionId);
  const selectedAction = selectedTab && (actions.find(action => action.id === selectedActionId) ?? selectedTab.action);
  const [issues, setIssues] = useState(0);
  const [fileQuery, setFileQuery] = useState('');
  const [org, setOrg] = useState<PublicOrgView | null>(null);
  const orgEpoch = useRef(0);
  const saveEnabled = Boolean(projectId) || Boolean(status?.dxProject);
  const activePathRef = useRef(activePath);
  const targetTabActive = useRef(false);
  activePathRef.current = activePath;
  const shaRef = useRef(sha256);
  shaRef.current = sha256;
  const sourceRef = useRef(source);
  sourceRef.current = source;

  // Compact shows exactly one tool; hidden tools fall back to the editor.
  const compactTool: CompactTool = HIDDEN_COMPACT.includes(studio.tool as AgentScriptTool) ? 'code' : studio.tool;
  const hiddenTools = compact ? HIDDEN_COMPACT : wide ? HIDDEN_WIDE : NO_HIDDEN;
  const currentTool: CompactTool = compact
    ? compactTool
    : tools.state.open && tools.state.active !== 'new' && !hiddenTools.includes(tools.state.active) ? tools.state.active : 'code';

  const openTool = useCallback((id: AgentScriptTool) => {
    if (id === 'files' && layout !== 'legacy') {
      if (layout === 'wide') patch({ explorerOpen: true });
      else patch({ tool: 'code' });
      return;
    }
    tools.openTool(id);
    patch({ tool: id });
  }, [layout, patch, tools.openTool]);
  const closeTool = useCallback((id: AgentScriptTool) => {
    tools.close(id);
    if (studio.tool === id) patch({ tool: 'code' });
  }, [patch, studio.tool, tools.close]);
  const setToolsOpen = useCallback((open: boolean) => {
    tools.setOpen(open);
    if (compact) patch({ tool: open && tools.state.active !== 'new' && !HIDDEN_COMPACT.includes(tools.state.active) ? tools.state.active : 'code' });
  }, [compact, patch, tools.setOpen, tools.state.active]);
  // The compact strip drives the shared tool state so each tool keeps its own panel.
  useEffect(() => {
    if (compact && compactTool !== 'code' && tools.state.active !== compactTool) tools.openTool(compactTool);
  }, [compact, compactTool, tools.state.active, tools.openTool]);

  // Every "browse org agents" entry point lands in the Agents tool with its search focused;
  // naming an agent (explorer row) also retrieves and opens it. The panel takes each request once.
  const agentsSeq = useRef(0);
  const [agentsFocus, setAgentsFocus] = useState<{ name?: string; seq: number } | null>(null);
  const browseAgents = useCallback((name?: string) => {
    agentsSeq.current += 1;
    setAgentsFocus({ ...(name ? { name } : {}), seq: agentsSeq.current });
    openTool('agents');
  }, [openTool]);
  const agentsFocusHandled = useCallback((seq: number) => setAgentsFocus(current => current?.seq === seq ? null : current), []);

  const openAction = useCallback((action: AgentAction, origin: 'project' | 'org' = 'project') => {
    setActionTabs(tabs => tabs.some(tab => tab.action.id === action.id) ? tabs.map(tab => tab.action.id === action.id ? { ...tab, action, origin } : tab) : [...tabs.slice(-7), { action, origin }]);
    setSelectedActionId(action.id);
    openTool('actions');
  }, [openTool]);
  const revealLine = useCallback((line: number) => {
    setSelectedActionId(null);
    if (compact) patch({ tool: 'code' });
    send.revealLine(line);
  }, [compact, patch, send]);

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
    send.setOrg(next);
    return next;
  }, [pluginId, projectId, send]);

  // Only the latest listing lands: an org switch must not be overwritten by a slower, older answer.
  const explorerSeq = useRef(0);
  const refreshExplorer = useCallback(async () => {
    const seq = ++explorerSeq.current;
    try {
      const result = (await callPluginRpc(pluginId, STUDIO_RPC.explorer, rpcArgs())) as { ok?: boolean; nodes?: ExplorerNode[] };
      if (alive.current && seq === explorerSeq.current && result?.ok !== false && Array.isArray(result?.nodes)) setExplorerNodes(result.nodes);
    } catch { /* the explorer sections are an enhancement over the file tree */ }
  }, [pluginId, rpcArgs]);

  const refreshFiles = useCallback(async () => {
    const listed = (await callPluginRpc(pluginId, 'agentFiles.list', rpcArgs())) as {
      ok?: boolean;
      files?: PlaygroundFileRef[];
      error?: string;
    };
    if (listed?.ok && Array.isArray(listed.files)) setFiles(listed.files);
    void refreshExplorer();
  }, [pluginId, rpcArgs, refreshExplorer]);

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
      // The explorer's org agents belong to the org that just changed.
      void refreshExplorer();
    };
    window.addEventListener('sf:context-changed', changed);
    return () => window.removeEventListener('sf:context-changed', changed);
  }, [projectId, refreshOrg, refreshExplorer]);

  const openFile = useCallback(
    async (path: string | null, isCurrent: () => boolean = () => true) => {
      if (!isCurrent()) return false;
      const generation = ++fileEpoch.current;
      setError(null);
      setActionTabs([]);
      setSelectedActionId(null);
      setActions([]);
      setSource('');
      setIssues(0);
      setDiagnostics([]);
      setCursor(undefined);
      setSelection(undefined);
      setComments([]);
      settleProposals('The file changed before the proposal was resolved.');
      // No file: the editor stays empty behind the "open an agent" state.
      if (!path) {
        activeDraft.current = '';
        setActivePath(null);
        setSha256(undefined);
        setDirty(false);
        // A Lightning Type, Apex or Flow tab stays in front: only an agent tab belongs to the closed file.
        if (!targetTabActive.current) patch({ activeTab: null, ...(compact ? { tool: 'code' as const } : {}) });
        send.setFile({
          draftKey: activeDraft.current,
          path: null,
          content: '',
          dialect,
          readOnly: true
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
      setSha256(result.file.sha256);
      setDirty(false);
      openTab({ id: `agent:${result.file.path}`, kind: 'agent', label: basename(result.file.path), path: result.file.path });
      if (compact) patch({ tool: 'code' });
      send.setFile({
        draftKey: activeDraft.current,
        path: result.file.path,
        content: result.file.content,
        dialect,
        readOnly: false,
        sha256: result.file.sha256
      });
      setFileLoads(count => count + 1);
      return true;
    },
    [compact, dialect, openTab, patch, pluginId, rpcArgs, draftScope, send, settleProposals]
  );

  // A retrieval opens its file seconds after the click: read the live editor, not the click-time render.
  const openFileRef = useRef(openFile);
  openFileRef.current = openFile;
  const unrecoverableDraft = useRef(false);
  unrecoverableDraft.current = dirty && draftWarning;
  const openRetrieved = useCallback(async (file: RetrievedOrgAgent, isCurrent: () => boolean) => {
    await refreshFiles();
    // Switching now would discard a draft with no local recovery; the retrieved file waits under Local agents.
    if (unrecoverableDraft.current) throw Error(`${basename(file.path)} is in your project. Save your current draft, then open it from Local agents.`);
    await openFileRef.current(file.path, isCurrent);
  }, [refreshFiles]);

  const openTarget = useCallback((kind: 'apex' | 'flow', apiName: string, path?: string) => {
    openTab({ id: `${kind}:${apiName}`, kind, label: apiName, target: `${kind}://${apiName}`, ...(path ? { path } : {}) });
    if (compact) patch({ tool: 'code' });
  }, [compact, openTab, patch]);

  // Agent tabs follow selection: choosing another file's tab opens that file.
  const activeEditorTab = studio.tabs.find(tab => tab.id === studio.activeTab) ?? null;
  targetTabActive.current = activeEditorTab !== null && activeEditorTab.kind !== 'agent';
  useEffect(() => {
    if (!playgroundReady || !activeEditorTab || activeEditorTab.kind !== 'agent' || !activeEditorTab.path) return;
    if (activeEditorTab.path !== activePathRef.current) void openFile(activeEditorTab.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playgroundReady, studio.activeTab]);

  const loadComments = useCallback(async () => {
    const path = activePathRef.current;
    if (!projectId || !path) { setComments([]); return; }
    try {
      const result = (await callPluginRpc(pluginId, STUDIO_RPC.comments, { projectId, path, includeResolved: true, content: sourceRef.current || undefined })) as { ok?: boolean; comments?: StudioComment[] };
      if (alive.current && activePathRef.current === path && result?.ok !== false && Array.isArray(result?.comments)) setComments(result.comments);
    } catch { /* comments are optional */ }
  }, [pluginId, projectId]);
  useEffect(() => { void loadComments(); }, [loadComments, activePath, fileLoads]);
  useRealtime(STUDIO_CHANGED_CHANNEL, payload => {
    const changed = payload as { projectId?: string; path?: string; kind?: string } | null;
    if (changed?.kind === 'comments' && (!changed.projectId || changed.projectId === projectId)) void loadComments();
  });
  useEffect(() => { if (playgroundReady) send.setComments(comments); }, [comments, playgroundReady, send]);

  const editorCompact = editorCompactOverride ?? !wide;
  useEffect(() => { if (playgroundReady) send.setLayout(editorCompact); }, [editorCompact, playgroundReady, send]);

  // Panel params from chat cards and guardrail rows: reveal a line, or open a dependency in the Actions tool.
  const pendingFocus = useRef<StudioFocus | null>(Object.keys(focus).length ? focus : null);
  const firstFocus = useRef(true);
  useEffect(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    const next = parseAgentforcePanelFocus(props.params);
    if (!Object.keys(next).length) return;
    pendingFocus.current = next;
    if (playgroundReady && next.path && next.path !== activePathRef.current) void openFile(next.path);
    else setFocusTick(tick => tick + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSignature]);
  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || !playgroundReady) return;
    if (pending.path && pending.path !== activePath) return;
    pendingFocus.current = null;
    if (pending.apiName) {
      const kind = pending.readOnly ? 'apex' : 'flow';
      openAction(targetAction(`${kind}://${pending.apiName}`, 'Opened from chat'));
    } else if (pending.line) revealLine(pending.line);
    if (pending.tool && !pending.apiName) openTool(pending.tool);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playgroundReady, activePath, sha256, focusTick]);

  const askAgent = useCallback(async (action?: string, extra?: Record<string, unknown>) => {
    const path = activePathRef.current;
    if (!path) return;
    const result = (await callPluginRpc(pluginId, STUDIO_RPC.askAgent, { ...rpcArgs({ path, ...(action ? { action } : {}), ...extra }) })) as { ok?: boolean; error?: string } | null;
    if (result?.ok === false) throw new Error(result.error || 'Could not start the agent.');
  }, [pluginId, rpcArgs]);
  const fixWithAgent = useCallback(async () => {
    setFixBusy(true); setError(null);
    try { await askAgent('fix-problems', { diagnostics: diagnostics.slice(0, 50) }); }
    catch (err) { if (alive.current) setError(err instanceof Error ? err.message : String(err)); }
    finally { if (alive.current) setFixBusy(false); }
  }, [askAgent, diagnostics]);

  const save = useCallback(() => {
    const now = Date.now();
    if (now - lastSave.current < SAVE_DEBOUNCE_MS || busy) return;
    lastSave.current = now;
    if (!activePath) {
      if (saveEnabled && playgroundReady) { setError(null); setSaveAsOpen(true); }
      return;
    }
    send.flushSave();
  }, [activePath, busy, playgroundReady, saveEnabled, send]);

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
            send.saved({ draftKey: key, content, sha256: result.file.sha256 });
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
    [pluginId, refreshFiles, rpcArgs, saveEnabled, sha256, openFile, draftScope, send]
  );

  const executeCommand = createStudioCommandExecutor({
    getSource: () => source,
    isBusyOrDirty: () => dirty || busy,
    refreshFiles,
    openFile: path => openFile(path),
    setFileQuery,
    revealLine,
    tools: { openTool, close: closeTool, setOpen: setToolsOpen },
    proposeEdit: {
      current: () => ({ path: activePathRef.current, sha256: shaRef.current }),
      start: (input: ProposeEditInput, proposalId: string) => new Promise<ProposalOutcome>((resolve, reject) => {
        try {
          const content = input.content ?? applyProposalEdits(sourceRef.current, input.edits ?? []);
          pendingProposals.current.set(proposalId, resolve);
          if (compact) patch({ tool: 'code' });
          send.proposeEdit({ proposalId, content, summary: input.summary, actor: 'Agent' });
        } catch (err) { reject(err); }
      })
    },
    preview: {
      start: ({ engine }) => {
        if (engine) setPreviewEngine(engine);
        openTool('preview');
        setPreviewCommand({ seq: ++previewSeq.current, type: 'start', engine });
      },
      send: ({ text, engine }) => {
        if (engine) setPreviewEngine(engine);
        openTool('preview');
        setPreviewCommand({ seq: ++previewSeq.current, type: 'send', text, engine });
      }
    },
    traceFocus: () => {
      if (wide) patch({ bottomOpen: true, bottomTab: 'trace' }); else openTool('preview');
    },
    graphFocus: node => { setGraphFocus(current => ({ node, seq: current.seq + 1 })); openTool('graph'); },
    layoutSet: setEditorCompactOverride
  });

  useSalesforceControl({ pluginId, projectId, orgAlias: org?.alias, threadId: context.threadId ?? undefined, surface: 'agentforce', enabled: playgroundReady,
    commands: ['state', 'file.open', 'file.filter', 'panel.open', 'panel.close', 'panel.show', 'panel.hide', 'editor.reveal', 'editor.proposeEdit', 'preview.start', 'preview.send', 'trace.focus', 'graph.focus', 'layout.set'],
    state: () => ({ path: activePath, dirty, issues, ready: playgroundReady, sha256, panels: tools.state, filter: fileQuery, layout, tool: currentTool, tabs: studio.tabs.map(tab => tab.id) }),
    execute: executeCommand,
  });

  bridgeHandlers.current = {
    onSnapshot: message => {
      const nextActions = message.actions ?? [];
      setSource(message.content); setIssues(message.issues); setActions(nextActions);
      setDiagnostics(message.diagnostics ?? []);
      setActionTabs(tabs => tabs.filter(tab => tab.action.id.startsWith('dependency:') || nextActions.some(action => action.id === tab.action.id)));
      setSelectedActionId(id => id?.startsWith('dependency:') || nextActions.some(action => action.id === id) ? id : null);
    },
    onOpenAction: id => {
      const action = actions.find(row => row.id === id);
      if (action) openAction(action);
    },
    onReady: () => {
      setPlaygroundReady(true);
      setIframeError(false);
      setPlaygroundTimedOut(false);
      send.init({
        dialect,
        theme: readDocumentTheme(),
        examples: [],
        files,
        saveEnabled,
        view: 'script',
        org
      });
      void refreshOrg();
      const queued = projectId ? takeQueuedAgentScriptOpen(projectId) : null;
      const last = recalledAgentSelection(draftScope);
      const tabPath = activeEditorTab?.kind === 'agent' ? activeEditorTab.path : undefined;
      // A remount onto a type or target tab keeps it in front; its agent tab reopens when selected.
      const recalled = targetTabActive.current ? null : last?.startsWith('file:') ? last.slice(5) : null;
      const file = initialPath || queued || tabPath || recalled;
      void openFile(file);
    },
    onDirty: message => {
      setDirty(message.dirty);
      if (message.draftKey) setSha256(message.baseSha);
      setDraftWarning(message.persisted === false);
    },
    onRequestOpen: path => { void openFile(path); },
    onPersist: message => { void persistFromPlayground(message.path, message.content, message.draftKey, message.create); },
    onSaveRequest: save,
    onCursor: message => {
      setCursor(current => current?.line === message.line && current.column === message.column ? current : { line: message.line, column: message.column });
      setSelection(message.selection);
    },
    onProposalResolved: message => {
      const resolve = pendingProposals.current.get(message.proposalId);
      pendingProposals.current.delete(message.proposalId);
      setSource(message.content);
      if (message.outcome !== 'rejected') setDirty(true);
      resolve?.({
        outcome: message.outcome, acceptedHunks: message.acceptedHunks, rejectedHunks: message.rejectedHunks,
        ...(message.sha256 ? { sha256: message.sha256 } : {}), ...(message.note ? { note: message.note } : {})
      });
    },
    onCommentAction: message => {
      if (message.kind === 'add') { setCommentBody(''); setAddComment({ line: message.line, endLine: message.endLine, quote: message.quote }); }
      else openTool('comments');
    },
    onAskSelection: message => {
      if (message.action === 'preview-topic') { openTool('preview'); return; }
      void askAgent(message.action).catch(err => { if (alive.current) setError(err instanceof Error ? err.message : String(err)); });
    }
  };

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

  // The wide rail starts with the Assistant, once per project.
  useEffect(() => {
    if (!wide || studio.railSeeded) return;
    patch({ railSeeded: true });
    if (!tools.state.tabs.includes('assistant')) tools.openTool('assistant');
  }, [wide, studio.railSeeded, patch, tools.state.tabs, tools.openTool]);

  const { view, setShare } = useStudioView({
    pluginId, projectId, threadId: context.threadId,
    input: {
      surface: 'studio', path: activePath, ...(sha256 ? { sha256 } : {}), dirty,
      ...(cursor ? { cursor } : {}), ...(selection ? { selection } : {}),
      tool: STUDIO_TOOL_FOR[currentTool] === undefined ? (currentTool as StudioTool) : STUDIO_TOOL_FOR[currentTool],
      ...(lastRun ? { lastRun: { runId: lastRun.runId, engine: lastRun.engine, turn: lastRun.turn } } : {}),
      diagnostics, ...(org?.alias ? { orgAlias: org.alias } : {})
    }
  });

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
  const composeFor = (instruction: string) => navigate.toCompose({ initialPrompt: `${instruction}\nProject: ${projectId}\nSource: ${activePath}`, focusPrompt: true });
  const quickItems = useMemo<QuickOpenItem[]>(() => [
    ...files.map(file => ({ id: `file:${file.path}`, label: file.apiName || basename(file.path), detail: file.path, kind: 'agent' })),
    ...explorerNodes.flatMap((node, index) => node.kind === 'agent' || node.kind === 'prompt' ? [] : [{ id: `node:${index}`, label: node.apiName, detail: node.path ?? node.usedBy?.[0], kind: node.kind === 'lightning-type' ? 'type' : node.kind }])
  ], [files, explorerNodes]);
  const openNode = useCallback((node: ExplorerNode) => {
    if (node.kind === 'agent' && node.path) void openFile(node.path);
    else if (node.kind === 'apex' || node.kind === 'flow') openTarget(node.kind, node.apiName, node.path);
    else if (node.kind === 'lightning-type') { openTab({ id: `type:${node.apiName}`, kind: 'type', label: node.apiName, target: node.apiName, ...(node.path ? { path: node.path } : {}) }); if (compact) patch({ tool: 'code' }); }
    else if (node.kind === 'scenario') openTool('test');
    else if (node.kind === 'org-agent') browseAgents(node.apiName);
  }, [browseAgents, compact, openFile, openTab, openTarget, openTool, patch]);
  const pickQuick = (item: QuickOpenItem) => {
    setQuickOpen(false);
    if (item.id.startsWith('file:')) void openFile(item.id.slice(5));
    else if (item.id.startsWith('node:')) { const node = explorerNodes[Number(item.id.slice(5))]; if (node) openNode(node); }
  };

  const documentBar = (
      <>
        <AgentScriptDocumentBar path={activePath} dirty={dirty} busy={busy} issues={issues}
          saveDisabled={saveDisabled} saveAsDisabled={!saveEnabled || busy || !playgroundReady || !activePath} panelOpen={tools.state.open}
          headerActions={props.headerActions}
          orgPicker={props.orgPicker !== false && <OrgPicker pluginId={pluginId} projectId={projectId} compact />}
          onBrowse={() => browseAgents()} onSave={() => void save()}
          onSaveAs={() => { setError(null); setSaveAsOpen(true); }} onShowPanel={tools.toggle}
          {...(layout === 'legacy' ? {} : {
            shortcutHint: wide, hidePanelToggle: compact,
            onQuickOpen: () => setQuickOpen(true),
            onCompile: () => composeFor('Diagnose and compile this Salesforce Agentforce draft with sf_agent, show any issues, and do not publish or activate it.'),
            onPublish: () => composeFor('Review and publish this Salesforce Agentforce draft to the selected project org as an inactive version. Diagnose and compile it first, show any issues and use sf_agent lifecycle.publish with the normal confirmation. Do not activate.')
          })} />
        {orgSessionLabel(org) ? (
          <span hidden className="sf-as-crumb-seg" data-testid="salesforce-playground-org">
            {orgSessionLabel(org)}
          </span>
        ) : null}
      </>
  );

  const showTargetTab = layout !== 'legacy' && activeEditorTab !== null && activeEditorTab.kind !== 'agent';
  const targetTabView = showTargetTab && activeEditorTab ? (
    <div className="sf-etab-view" data-testid="studio-target-view">
      {activeEditorTab.kind === 'type'
        ? <LightningTypeView key={`${projectId}:${activeEditorTab.id}`} pluginId={pluginId} projectId={projectId} typeRef={activeEditorTab.target ?? activeEditorTab.label}
          usedBy={explorerNodes.find(node => node.kind === 'lightning-type' && node.apiName === (activeEditorTab.target ?? activeEditorTab.label))?.usedBy}
          onOpenAgent={path => void openFile(path)} />
        : <AgentActionPanel key={`${projectId}:${activeEditorTab.id}`} pluginId={pluginId} projectId={projectId} org={org}
        action={targetAction(activeEditorTab.target ?? `${activeEditorTab.kind}://${activeEditorTab.label}`, activeEditorTab.kind === 'apex' ? 'Apex (read-only)' : 'Flow')}
        onReveal={() => undefined}
        onOpenTarget={target => { const match = TARGET_PATTERN.exec(target); if (match) openTarget(match[1] as 'apex' | 'flow', match[2]); }} />}
    </div>
  ) : false;

  const problemsCount = diagnostics.length;
  const tabs = layout === 'legacy' ? false : (
    <EditorTabs tabs={studio.tabs} active={studio.activeTab} dirtyId={dirty && activePath ? `agent:${activePath}` : null} problems={problemsCount}
      onSelect={selectTab} onClose={closeTab} />
  );

  const bottomActive: BottomTab = compact ? 'problems' : studio.bottomTab;
  const bottom = layout !== 'legacy' && (wide || compactTool === 'code') ? (
    <BottomPanel open={studio.bottomOpen} active={bottomActive} problems={problemsCount} compact={compact}
      onToggle={() => patch({ bottomOpen: !studio.bottomOpen })} onSelect={tab => patch({ bottomTab: tab, bottomOpen: true })}
      render={(tab, visible) => {
        if (tab === 'problems') return <ProblemsPanel path={activePath} diagnostics={diagnostics} compact={compact} busy={fixBusy}
          onReveal={line => revealLine(line)} onFixWithAgent={() => void fixWithAgent()} />;
        if (tab === 'trace') return <BottomTrace pluginId={pluginId} path={activePath} run={lastRun} visible={visible} onOpenPreview={() => openTool('preview')}
          onRevealSource={(path, line) => { if (path === activePathRef.current) revealLine(line); else void openFile(path).then(opened => { if (opened) revealLine(line); }); }} />;
        if (tab === 'output') return visible ? <OperationsPanel pluginId={pluginId} projectId={projectId} orgAlias={org?.alias} threadId={context.threadId ?? undefined} /> : null;
        return <BottomTests suites={suites} onOpenTests={() => openTool('test')} />;
      }} />
  ) : false;

  const toggleSection = useCallback((id: string) => patch({
    collapsedSections: studio.collapsedSections.includes(id) ? studio.collapsedSections.filter(row => row !== id) : [...studio.collapsedSections, id]
  }), [patch, studio.collapsedSections]);
  const badgedNodes = useMemo(() => withSuiteBadges(explorerNodes, suites), [explorerNodes, suites]);
  const explorerNode = (
    <Explorer files={files} nodes={badgedNodes} activePath={activePath} dirtyPath={dirty ? activePath : null}
      query={fileQuery} onQuery={setFileQuery} onOpenFile={path => void openFile(path)}
      onOpenNode={openNode} onBrowseOrg={() => browseAgents()}
      collapsed={studio.collapsedSections} onToggleSection={toggleSection} onHide={wide ? () => patch({ explorerOpen: false }) : undefined} />
  );

  const top = compact ? (
    <>
      <ToolStrip orientation="horizontal" label="Studio tools" iconsOnly={tier === 0} active={compactTool}
        items={COMPACT_TOOLS.map(id => stripItem(id, id === 'code' ? problemsCount : undefined))} onSelect={id => { patch({ tool: id as CompactTool }); }} />
      <ContextStrip view={view} compact onShareChange={setShare} />
    </>
  ) : false;
  const activity = wide ? (
    <ToolStrip orientation="vertical" label="Studio activity" active={studio.explorerOpen ? 'files' : null}
      items={[stripItem('files'), stripItem('agents'), { id: 'search', title: 'Go to file', icon: <Search size={16} aria-hidden="true" /> }]}
      onSelect={id => { if (id === 'files') patch({ explorerOpen: !studio.explorerOpen }); else if (id === 'agents') browseAgents(); else setQuickOpen(true); }} />
  ) : false;

  const splitMode = compact ? (compactTool === 'code' ? 'editor' : 'panel') : 'split';
  const splitOpen = compact ? compactTool !== 'code' : tools.state.open;

  return (
    <div className="sf-as" ref={tierRef} style={PANEL_ROOT} data-testid="salesforce-agent-script-panel">
      <style>{AGENTFORCE_PANEL_STYLES}</style>
      <style>{AGENTFORCE_STUDIO_STYLES}</style>
      <style>{AGENT_ACTION_STYLES}</style>
      {newAgentOpen && <NewAgentDialog pluginId={pluginId} projectId={projectId} onClose={() => setNewAgentOpen(false)} onCreated={async file => { await refreshFiles(); await openFile(file.path); openTool('files'); }} />}
      {saveAsOpen && <SaveAgentDialog busy={busy} error={error} onClose={() => setSaveAsOpen(false)} onSave={path => {
        setBusy(true); setError(null);
        send.flushSave({ path, create: true });
      }} />}
      {draftWarning && <div className="sf-as-banner is-error" role="alert">Local recovery is unavailable for this draft. Save it to a project file before leaving.</div>}
      {hint ? <div className="sf-as-banner">{hint}</div> : null}
      {error ? <div className="sf-as-banner is-error" role="alert">{error}</div> : null}
      {addComment && <form className="sf-comment-form" aria-label="Add comment" onSubmit={event => {
        event.preventDefault();
        const body = commentBody.trim();
        const path = activePath;
        if (!body || !path || !projectId) return;
        const target = addComment;
        setAddComment(null);
        void Promise.resolve(callPluginRpc(pluginId, STUDIO_RPC.commentAdd, { projectId, path, line: target.line, endLine: target.endLine, quote: target.quote, body, content: sourceRef.current }))
          .then(result => { const failure = result as { ok?: boolean; error?: string } | null; if (failure?.ok === false && alive.current) setError(failure.error || 'Could not add the comment.'); void loadComments(); })
          .catch(err => { if (alive.current) setError(err instanceof Error ? err.message : String(err)); });
      }}>
        <label>Comment on line{addComment.endLine > addComment.line ? `s ${addComment.line}-${addComment.endLine}` : ` ${addComment.line}`}
          <textarea value={commentBody} autoFocus rows={2} maxLength={2000} onChange={event => setCommentBody(event.target.value)} />
        </label>
        <button type="submit" className="sf-btn-small" disabled={!commentBody.trim() || !activePath || !projectId}>Add comment</button>
        <button type="button" className="sf-btn-small" onClick={() => setAddComment(null)}>Cancel</button>
      </form>}
      <StudioShell layout={layout} tier={tier} top={top} activity={activity} explorer={wide && studio.explorerOpen ? explorerNode : false}
        quickOpen={quickOpen} quickItems={quickItems} onQuickOpenChange={setQuickOpen} onQuickPick={pickQuick} onSave={save}
        onToggleExplorer={wide ? () => patch({ explorerOpen: !studio.explorerOpen }) : undefined}>
        <div className="sf-main-col">
        <AgentforceStudioSplit open={splitOpen} mode={splitMode} storageKey={`salesforce:studio:split:${draftScope}`} editor={<div className="af-action-workspace">
          {tabs}
          {documentBar}
          {targetTabView}
          {playgroundFailed ? (
          <div data-testid="salesforce-agent-script-playground-error"><SalesforceState kind="error" art="code" title="Editor unavailable">{PLAYGROUND_LOAD_ERROR}</SalesforceState></div>
        ) : (
          <div className="sf-frame-stage" style={{ position: 'relative', display: showTargetTab ? 'none' : 'flex', flex: 1, minHeight: 0 }}>
            {!playgroundReady && <LoadingState art="code" label="Opening your editor…" hint="Preparing Agent Script tools." />}
            {playgroundReady && !activePath && <div className="sf-as-no-file" data-testid="salesforce-agent-script-no-file">
              <EmptyState art="code" title="Open an agent" action={<>
                <button type="button" className="sf-as-save" onClick={() => setNewAgentOpen(true)}>Create an agent</button>
                <button type="button" className="sf-as-save" onClick={() => browseAgents()}>Open org agents</button>
                {files.length > 0 && <button type="button" className="sf-as-save" onClick={() => setQuickOpen(true)}>Go to file</button>}
              </>}>
                {files.length > 0 ? 'Pick an .agent file from the explorer, or create a new one.' : 'This project has no .agent files yet. Create one, or retrieve an agent from the org.'}
              </EmptyState>
            </div>}
            <iframe
              ref={frameRef}
              title="Agentforce playground"
              src={typeof process !== 'undefined' && process.env.VITEST ? 'about:blank' : PLAYGROUND_ASSET_SRC}
              style={{ flex: 1, minHeight: 0, width: '100%', border: 0, background: 'transparent' }}
            />
          </div>
        )}
        </div>}>
          <AgentScriptTools tools={tools} hiddenTools={hiddenTools} chrome={!compact} open={compact ? splitOpen : undefined} render={(id, visible) => {
            if (id === 'agents') return <OrgAgentsPanel pluginId={pluginId} projectId={projectId} visible={visible} editorReady={playgroundReady} focus={agentsFocus} onFocusHandled={agentsFocusHandled} onNew={() => setNewAgentOpen(true)} localFiles={files.filter(file => file.path.includes('aiAuthoringBundles/'))} onLocalOpen={path => void openFile(path)} onPublish={path => navigate.toCompose({ initialPrompt: `Review and publish this Salesforce Agentforce draft to the selected project org as an inactive version. Diagnose and compile it first, show any issues and use sf_agent lifecycle.publish with the normal confirmation. Do not activate.\nProject: ${projectId}\nSource: ${path}`, focusPrompt: true })} onOpen={openRetrieved} />;
            if (id === 'files') return layout === 'legacy' ? explorerNode : null;
            if (id === 'assistant') return compact ? null : <AssistantRail pluginId={pluginId} projectId={projectId} path={activePath} view={view} onShareChange={setShare} />;
            if (id === 'comments') return <CommentsPane pluginId={pluginId} projectId={projectId} path={activePath} comments={comments}
              onReveal={revealLine}
              onResolve={(commentId, note) => { void Promise.resolve(callPluginRpc(pluginId, STUDIO_RPC.commentResolve, { projectId, id: commentId, note })).then(() => loadComments()).catch(err => { if (alive.current) setError(err instanceof Error ? err.message : String(err)); }); }}
              onAddressWithAgent={() => { void askAgent('address-comments').catch(err => { if (alive.current) setError(err instanceof Error ? err.message : String(err)); }); }} />;
            if (id === 'graph') return <AgentScriptGraphPanel source={source} visible={visible} compact={compact} focusNode={graphFocus.node} focusSeq={graphFocus.seq} onOpenAction={id => { const action = actions.find(row => row.id === id); if (action) openAction(action); }} />;
            if (id === 'preview') return <PreviewWorkbench pluginId={pluginId} projectId={projectId} source={source} fileLabel={activePath?.split('/').pop() ?? 'Draft'}
              engine={previewEngine} onEngineChange={setPreviewEngine} path={activePath ?? undefined} orgAlias={org?.alias} threadId={context.threadId ?? undefined}
              onRunChange={setLastRun} command={previewCommand} onCommandHandled={previewCommandHandled} dirty={dirty}
              onRevealSource={(path, line) => { if (path === activePathRef.current) revealLine(line); else void openFile(path).then(opened => { if (opened) revealLine(line); }); }} />;
            if (id === 'test') return <AgentforceLabPanel pluginId={pluginId} projectId={projectId} source={source} mode="test" fileLabel={activePath?.split('/').pop() ?? 'Draft'} />;
            if (id === 'org-preview') return <AgentforcePreviewPanel pluginId={pluginId} projectId={projectId} />;
            return <div className="af-action-workspace">
          {actionTabs.length > 0 && <div className="af-related-tabs" aria-label="Open agent files">
            <div className={`af-related-tab${!selectedActionId ? ' is-active' : ''}`}><button aria-pressed={!selectedActionId} onClick={() => setSelectedActionId(null)}>All actions</button></div>
            {actionTabs.map(tab => <div className={`af-related-tab${selectedActionId === tab.action.id ? ' is-active' : ''}`} key={tab.action.id}><button title={`${tab.action.owner} · ${tab.action.target}`} aria-pressed={selectedActionId === tab.action.id} onClick={() => setSelectedActionId(tab.action.id)}>{tab.action.name}</button><button aria-label={`Close ${tab.action.name}`} onClick={() => { setActionTabs(tabs => tabs.filter(t => t.action.id !== tab.action.id)); if (selectedActionId === tab.action.id) setSelectedActionId(null); }}>×</button></div>)}
          </div>}

              {!selectedAction && <div className="af-actions-list"><h2>Actions</h2><p>Explore implementations and references in the current script.</p><AgentActionExplorer actions={actions} selected={selectedActionId ?? undefined} onOpen={openAction} />{actions.length === 0 && <EmptyState compact art="code" title="No actions in this script yet.">Add an Apex or Flow action to explore its implementation here.</EmptyState>}</div>}
          {selectedAction && <AgentActionPanel key={`${projectId}:${activePath}:${selectedAction.id}`} pluginId={pluginId} projectId={projectId} org={org} action={selectedAction} initialOrigin={selectedTab?.origin} onOriginChange={origin => setActionTabs(tabs => tabs.map(tab => tab.action.id === selectedActionId ? { ...tab, origin } : tab))} onReveal={revealLine} onOpenTarget={(target, origin) => openAction(targetAction(target, `Referenced by ${selectedAction.name}`), origin)} />}
            </div>;
          }} />
        </AgentforceStudioSplit>
        {bottom}
        </div>
      </StudioShell>
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
