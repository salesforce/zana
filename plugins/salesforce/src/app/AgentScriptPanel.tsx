import { useSalesforceControl } from './useSalesforceControl.js';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Bot, Cloud, Code, FlaskConical, Files, MessageSquare, Network, PanelRight, Play, Rocket, Search, Zap } from 'lucide-react';
import { callPluginRpc, useRealtime, useSettings, useZccContext, useZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
import { type AgentScriptDialect, type PublicOrgView } from '../../lib/types.js';
import {
  STUDIO_CHANGED_CHANNEL,
  STUDIO_RPC,
  countProblems,
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
import { OrgSyncDialog } from './OrgSyncDialog.js';
import {
  PLAYGROUND_ASSET_SRC,
  readDocumentTheme,
  type PlaygroundFileRef
} from './playground-bridge.js';
import { usePlaygroundBridge } from './studio/usePlaygroundBridge.js';
import { compilerDiagnostic, parseCompileReply, type CompileState } from './studio/compile-result.js';
import { ReleasePane } from './studio/ReleasePane.js';
import { TestsPane } from './studio/TestsPane.js';
import { createStudioCommandExecutor } from './studio/studio-commands.js';
import { commandAuthor, holdCommand, holdReason, REVEAL_COMMANDS, type HeldReveal } from './studio/follow-gate.js';
import { FollowChip, FollowToast } from './studio/FollowControl.js';
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
import type { UiCommand } from '../../lib/workbench-control.js';
import { AgentActionExplorer, AgentActionPanel } from './AgentActionPanel.js';
import { AGENT_ACTION_STYLES } from './agent-action-styles.js';
import { agentDraftKey, readAgentDraft, writeAgentDraft, clearAgentDraft, rememberAgentSelection, recalledAgentSelection } from './agent-script-drafts.js';
import { NewAgentDialog } from './NewAgentDialog.js';
import { SaveAgentDialog } from './SaveAgentDialog.js';
import { EmptyState, LoadingState, SalesforceState } from './components/SalesforceState.js';
import { PreviewWorkbench, type PreviewCommand } from './preview/PreviewWorkbench.js';
import { OperationsPanel } from './panels/OperationsPanel.js';
import { AskAgentButton } from './studio/AskAgentButton.js';
import { isPanelTool, panelToolActionId, useStudioRegistration, useStudioToolSlots, type PanelTool } from './studio/studio-tool-bridge.js';
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
import { useContextChangeRelay } from './context-sync.js';
import { modShortcut } from './shortcut-label.js';

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
  release: <Rocket size={16} aria-hidden="true" />,
  actions: <Zap size={16} aria-hidden="true" />, 'org-preview': <Cloud size={16} aria-hidden="true" />, comments: <MessageSquare size={16} aria-hidden="true" />
};
const TOOL_TITLE: Record<CompactTool, string> = {
  code: 'Code', agents: 'Agents', files: 'Files', graph: 'Graph', preview: 'Preview', test: 'Tests', release: 'Release', actions: 'Actions',
  'org-preview': 'Org preview', comments: 'Comments'
};
/** Tools offered by the compact strip, in order. Files (QuickOpen) is intentionally absent. */
const COMPACT_TOOLS: readonly CompactTool[] = ['code', 'agents', 'graph', 'preview', 'test', 'release', 'actions', 'comments', 'org-preview'];
/** Studio can open the host side panel's tabs but not close them; the user closes them there. */
const HOST_PANEL_CLOSE = 'Studio tools are in the ZCC side panel; close or hide them from the panel.';
const HIDDEN_COMPACT: readonly AgentScriptTool[] = ['files'];
const HIDDEN_WIDE: readonly AgentScriptTool[] = ['files'];
const NO_HIDDEN: readonly AgentScriptTool[] = [];
const stripItem = (id: CompactTool, badge?: number): StripItem => ({ id, title: TOOL_TITLE[id], icon: TOOL_ICON[id], ...(badge ? { badge } : {}) });
const STUDIO_TOOL_FOR: Record<string, StudioTool | null> = { test: 'tests', release: 'deploy', files: 'code', 'org-preview': null, new: null };
const TARGET_PATTERN = /^(apex|flow):\/\/([A-Za-z][A-Za-z0-9_.]*)$/;
const basename = (path: string) => path.split('/').pop() ?? path;
const targetAction = (target: string, owner: string): AgentAction => ({ id: `dependency:${target}`, name: target.split('://')[1] ?? target, owner, target, line: 1, description: '', inputs: [], outputs: [], uses: [] });

/** The agent a dependency tab belongs to: the loaded agent when it references the target, else the first agent that does. */
export function dependencyContext(target: string, kind: string, apiName: string, nodes: ExplorerNode[], activePath: string | null, actions: AgentAction[]): { path: string; label: string; title: string } | null {
  const usedBy = nodes.find(node => node.kind === kind && node.apiName === apiName)?.usedBy ?? [];
  const calls = activePath ? actions.filter(action => action.target === target).length : 0;
  const path = activePath && (calls > 0 || usedBy.includes(activePath)) ? activePath : usedBy[0];
  if (!path) return null;
  const others = usedBy.filter(row => row !== path).length;
  const detail = path === activePath && calls ? ` · ${calls} ${calls === 1 ? 'action' : 'actions'}` : '';
  return { path, label: `${basename(path)}${detail}${others ? ` · +${others}` : ''}`, title: [path, ...usedBy.filter(row => row !== path)].join('\n') };
}
const SAVE_DEBOUNCE_MS = 150;
/** Edits reported this soon after an agent reveal come from the reveal, not the person. */
const OWN_MOVE_MS = 1000;

type AgentScriptPanelProps = {
  pluginId: string;
  projectId?: string;
  subPath?: string;
  params?: unknown;
  headerActions?: ReactNode;
  orgPicker?: boolean;
  /** The thread that owns a side panel; it wins over the focused route's thread. */
  threadId?: string;
  /** The open agent file, then null once the panel goes away. Pass a stable function. */
  onActivePath?: (path: string | null) => void;
};
/** `…/aiAuthoringBundles/Name/Name.agent` → `Name`; other files have no bundle to fetch. */
export const bundleName = (path: string | null) => path?.match(/(?:^|\/)([A-Za-z][A-Za-z0-9_]*)\/\1\.agent$/)?.[1] ?? null;

export function AgentScriptPanel(props: AgentScriptPanelProps) {
  useContextChangeRelay();
  const context = useZccContext();
  const projectId = props.projectId ?? context.projectId ?? undefined;
  return <AgentScriptWorkspace key={projectId ?? 'shared'} {...props} projectId={projectId} />;
}
function AgentScriptWorkspace(props: AgentScriptPanelProps) {
  const navigate = useZccNavigate();
  // Callbacks read the latest host navigate without changing identity with it.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const pluginId = props.pluginId || PLUGIN_ID;
  const context = useZccContext();
  const projectId = props.projectId ?? context.projectId ?? undefined;
  const threadId = props.threadId || context.threadId || undefined;
  const focus = parseAgentforcePanelFocus(props.params);
  const focusSignature = focusKey(focus);
  const initialPath = focus.path ?? props.subPath ?? null;
  const settings = useSettings();
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [files, setFiles] = useState<PlaygroundFileRef[]>([]);
  const [explorerNodes, setExplorerNodes] = useState<ExplorerNode[]>([]);
  const [orgAgentsMore, setOrgAgentsMore] = useState(false);
  const [orgAgentsNotLocal, setOrgAgentsNotLocal] = useState<number | undefined>(undefined);
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
  // The source an agent proposes while its proposal is open, so Tests can run it before it is accepted.
  const [proposalSource, setProposalSource] = useState<string | null>(null);
  const settleProposals = useCallback((note: string) => {
    for (const [proposalId, resolve] of pendingProposals.current) {
      resolve({ outcome: 'rejected', acceptedHunks: 0, rejectedHunks: 0, note });
      send.clearProposal(proposalId);
    }
    pendingProposals.current.clear();
    setProposalSource(null);
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
  // Beside the Salesforce tab the host side panel shows the tools (studio-tool-bridge); Studio still renders them.
  // A host that turns a tool down (an older or partial host) leaves Studio on its own panel
  // until the host takes the next one: each open asks the host again.
  // Not the width: a narrow window's panel covers Studio (0 px, 'legacy'), and its tabs still need Studio.
  const [hostRefused, setHostRefused] = useState(false);
  const hostCapable = context.sidePanel === true && typeof navigate.openPanelTool === 'function';
  const hostPanel = !hostRefused && hostCapable;
  const toolScope = projectId ?? '';
  useStudioRegistration(toolScope, hostPanel);
  const hostSlots = useStudioToolSlots(hostPanel ? toolScope : null);
  const hostTool = hostSlots.find(slot => slot.attached)?.tool ?? null;
  // "Show side panel" reopens the tool last shown there; the panel's New Tab lists the rest.
  const lastHostTool = useRef<PanelTool>('preview');
  if (hostTool) lastHostTool.current = hostTool;
  // A tool the host agreed to show, until its tab attaches: commands report it right away.
  const requestedHostTool = useRef<PanelTool | null>(null);
  const seenHostTool = useRef(hostTool);
  if (seenHostTool.current !== hostTool) { seenHostTool.current = hostTool; requestedHostTool.current = null; }
  // Without a host panel the compact layout swaps the editor for one tool at a time.
  const swapCompact = compact && !hostPanel;
  const studioLayout = useStudioLayout(draftScope);
  const { state: studio, patch, openTab, selectTab, closeTab, closeTabs } = studioLayout;
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
  const [previewEngine, setPreviewEngine] = useState<StudioEngine>('simulate');
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
  const onActivePath = props.onActivePath;
  useEffect(() => { onActivePath?.(activePath); }, [activePath, onActivePath]);
  useEffect(() => () => onActivePath?.(null), [onActivePath]);
  const shaRef = useRef(sha256);
  shaRef.current = sha256;
  const sourceRef = useRef(source);
  sourceRef.current = source;

  // Compact shows exactly one tool; hidden tools fall back to the editor.
  const compactTool: CompactTool = hostPanel || HIDDEN_COMPACT.includes(studio.tool as AgentScriptTool) ? 'code' : studio.tool;
  const hiddenTools = compact ? HIDDEN_COMPACT : wide ? HIDDEN_WIDE : NO_HIDDEN;
  const currentTool: CompactTool = hostPanel
    ? hostTool ?? 'code'
    : compact
    ? compactTool
    : tools.state.open && tools.state.active !== 'new' && !hiddenTools.includes(tools.state.active) ? tools.state.active : 'code';

  const openTool = useCallback((id: AgentScriptTool) => {
    if (id === 'files' && layout !== 'legacy') {
      if (layout === 'wide') patch({ explorerOpen: true });
      else patch({ tool: 'code' });
      return;
    }
    if (hostCapable && isPanelTool(id)) {
      if (navigateRef.current.openPanelTool?.({ actionId: panelToolActionId(id) })) {
        if (id !== hostTool) requestedHostTool.current = id;
        setHostRefused(false);
        return;
      }
      setHostRefused(true);
    }
    tools.openTool(id);
    patch({ tool: id });
  }, [hostCapable, hostTool, layout, patch, tools.openTool]);
  const panelShown = hostPanel ? hostTool !== null : tools.state.open;
  const showPanel = useCallback(() => {
    if (hostPanel) openTool(lastHostTool.current);
    else tools.toggle();
  }, [hostPanel, openTool, tools.toggle]);
  const closeTool = useCallback((id: AgentScriptTool) => {
    if (hostPanel && isPanelTool(id)) throw Error(HOST_PANEL_CLOSE);
    tools.close(id);
    if (studio.tool === id) patch({ tool: 'code' });
  }, [hostPanel, patch, studio.tool, tools.close]);
  const setToolsOpen = useCallback((open: boolean) => {
    if (hostPanel) {
      if (!open) throw Error(HOST_PANEL_CLOSE);
      openTool(lastHostTool.current);
      return;
    }
    tools.setOpen(open);
    if (swapCompact) patch({ tool: open && tools.state.active !== 'new' && !HIDDEN_COMPACT.includes(tools.state.active) ? tools.state.active : 'code' });
  }, [hostPanel, openTool, swapCompact, patch, tools.setOpen, tools.state.active]);
  // The compact strip drives the shared tool state so each tool keeps its own panel.
  useEffect(() => {
    if (swapCompact && compactTool !== 'code' && tools.state.active !== compactTool) tools.openTool(compactTool);
  }, [swapCompact, compactTool, tools.state.active, tools.openTool]);

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

  // The Project / Org choice carries over to every implementation view in this project.
  const actionOrigin = useRef(studio.actionOrigin);
  actionOrigin.current = studio.actionOrigin;
  const chooseActionOrigin = useCallback((origin: 'project' | 'org') => patch({ actionOrigin: origin }), [patch]);
  const openAction = useCallback((action: AgentAction, origin: 'project' | 'org' = actionOrigin.current) => {
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
      // The open agent is scanned first, so it shows its references however many agents the project has.
      const result = (await callPluginRpc(pluginId, STUDIO_RPC.explorer, rpcArgs(activePathRef.current ? { focus: activePathRef.current } : undefined))) as { ok?: boolean; nodes?: ExplorerNode[]; orgAgentsTruncated?: boolean; orgAgentsNotLocal?: number };
      if (alive.current && seq === explorerSeq.current && result?.ok !== false && Array.isArray(result?.nodes)) {
        setExplorerNodes(result.nodes);
        setOrgAgentsMore(result.orgAgentsTruncated === true);
        setOrgAgentsNotLocal(typeof result.orgAgentsNotLocal === 'number' ? result.orgAgentsNotLocal : undefined);
      }
    } catch { /* the explorer sections are an enhancement over the file tree */ }
  }, [pluginId, rpcArgs]);

  // A newly opened agent may sit past the explorer's scan window: list again with it in focus.
  useEffect(() => { if (activePath) void refreshExplorer(); }, [activePath, refreshExplorer]);

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
    // Fetch latest wrote org files into the project.
    if (changed?.kind === 'files' && (!changed.projectId || changed.projectId === projectId)) void refreshFiles().catch(() => undefined);
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
    const request = rpcArgs({ path, ...(action ? { action } : {}), ...extra });
    // Like the Ask agent menu: the side panel's composer takes the brief so the user picks the harness.
    const { openPanelAgent } = navigateRef.current;
    if (openPanelAgent) {
      const draft = (await callPluginRpc(pluginId, STUDIO_RPC.draftAgent, request)) as { ok?: boolean; error?: string; prompt?: string; title?: string } | null;
      if (draft?.ok === false) throw new Error(draft.error || 'Could not prepare the request.');
      if (draft?.prompt && openPanelAgent({ draft: { prompt: draft.prompt, view: path, ...(projectId ? { projectId } : {}) }, ...(draft.title ? { title: draft.title } : {}) })) return;
    }
    const result = (await callPluginRpc(pluginId, STUDIO_RPC.askAgent, request)) as { ok?: boolean; error?: string } | null;
    if (result?.ok === false) throw new Error(result.error || 'Could not start the agent.');
  }, [pluginId, projectId, rpcArgs]);
  // The last Compile answer, shown only for the file it was run on; a failed compile joins the problems.
  const [compileState, setCompileState] = useState<CompileState | null>(null);
  const compiled = compileState?.path === activePath ? compileState : null;
  const problems = useMemo(
    () => compiled?.status === 'failed' && compiled.code === 'compile_failed' ? [...diagnostics, compilerDiagnostic(compiled.message)] : diagnostics,
    [compiled, diagnostics]
  );
  const compile = useCallback(async () => {
    const path = activePathRef.current;
    if (!path) return;
    const sha = shaRef.current;
    setCompileState({ status: 'running', path, ...(sha ? { sha } : {}) });
    patch({ bottomOpen: true, bottomTab: 'problems' });
    let reply: unknown;
    try { reply = await callPluginRpc(pluginId, 'agentScript.compile', rpcArgs({ path, startedByUser: true, ...(threadId ? { threadId } : {}) })); }
    catch (err) { reply = { ok: false, error: err instanceof Error ? err.message : String(err) }; }
    if (!alive.current) return;
    setCompileState(current => current?.status === 'running' && current.path === path ? parseCompileReply(path, sha, reply) : current);
  }, [patch, pluginId, rpcArgs, threadId]);

  const [fetchAgent, setFetchAgent] = useState<string | null>(null);
  const syncCall = useCallback((method: string, args?: Record<string, unknown>) => callPluginRpc(pluginId, method, rpcArgs(args)), [pluginId, rpcArgs]);

  const [openingBuilder, setOpeningBuilder] = useState(false);
  const openInBuilder = useCallback(async () => {
    const path = activePathRef.current;
    if (!path) return;
    setOpeningBuilder(true); setError(null);
    try {
      const reply = await callPluginRpc(pluginId, 'agentBuilder.open', rpcArgs({ path, startedByUser: true, ...(threadId ? { threadId } : {}) })) as { ok?: boolean; error?: string } | null;
      if (reply?.ok === false) throw new Error(reply.error || 'Could not open Agentforce Builder.');
    } catch (err) { if (alive.current) setError(err instanceof Error ? err.message : String(err)); }
    finally { if (alive.current) setOpeningBuilder(false); }
  }, [pluginId, rpcArgs, threadId]);

  const fixWithAgent = useCallback(async () => {
    setFixBusy(true); setError(null);
    try { await askAgent('fix-problems', { diagnostics: problems.slice(0, 50) }); }
    catch (err) { if (alive.current) setError(err instanceof Error ? err.message : String(err)); }
    finally { if (alive.current) setFixBusy(false); }
  }, [askAgent, problems]);

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

  // Follow the driving thread without stealing the cursor: a reveal waits as a toast while the
  // person types or has paused following. Edits right after a reveal are the reveal's own.
  const [followPaused, setFollowPaused] = useState(false);
  const followPausedRef = useRef(false); followPausedRef.current = followPaused;
  const [heldReveal, setHeldReveal] = useState<HeldReveal | null>(null);
  const [driver, setDriver] = useState<string | undefined>(undefined);
  const lastEditAt = useRef(0);
  const ownMoveUntil = useRef(0);
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
          setProposalSource(content);
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

  const applyReveal = (command: UiCommand) => {
    if (REVEAL_COMMANDS.has(command.command)) ownMoveUntil.current = Date.now() + OWN_MOVE_MS;
    return executeCommand(command);
  };
  const followCommand = async (command: UiCommand) => {
    if (command.from) setDriver(commandAuthor(command));
    const reason = holdReason(command, { paused: followPausedRef.current, lastEditAt: lastEditAt.current, now: Date.now(), dirty: dirty || busy });
    if (!reason) return applyReveal(command);
    setHeldReveal(holdCommand(command, reason));
    return { held: reason };
  };
  const showHeldReveal = () => {
    const held = heldReveal;
    setHeldReveal(null);
    if (held) void applyReveal(held.command).catch(err => { if (alive.current) setError(err instanceof Error ? err.message : String(err)); });
  };

  useSalesforceControl({ pluginId, projectId, orgAlias: org?.alias, threadId, surface: 'agentforce', enabled: playgroundReady,
    commands: ['state', 'file.open', 'file.filter', 'panel.open', 'panel.close', 'panel.show', 'panel.hide', 'editor.reveal', 'editor.proposeEdit', 'preview.start', 'preview.send', 'trace.focus', 'graph.focus', 'layout.set'],
    state: () => ({ path: activePath, dirty, issues, ready: playgroundReady, sha256, panels: hostPanel ? { host: true, tabs: hostSlots.filter(slot => slot.attached).map(slot => slot.tool), kept: hostSlots.filter(slot => !slot.attached).map(slot => slot.tool), active: requestedHostTool.current ?? hostTool, open: (requestedHostTool.current ?? hostTool) !== null } : tools.state, filter: fileQuery, layout, tool: currentTool, tabs: studio.tabs.map(tab => tab.id), follow: followPaused ? 'paused' : 'on', ...(heldReveal ? { heldReveal: heldReveal.command.command } : {}) }),
    execute: followCommand,
  });

  bridgeHandlers.current = {
    onSnapshot: message => {
      const nextActions = message.actions ?? [];
      // The frame's `issues` counts every diagnostic; the document bar shows problems only.
      setSource(message.content); setIssues(message.diagnostics ? countProblems(message.diagnostics) : message.issues); setActions(nextActions);
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
      if (message.dirty && Date.now() > ownMoveUntil.current) lastEditAt.current = Date.now();
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
      if (pendingProposals.current.size === 0) setProposalSource(null);
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

  const { view, setShare } = useStudioView({
    pluginId, projectId, threadId: threadId ?? null,
    input: {
      surface: 'studio', path: activePath, ...(sha256 ? { sha256 } : {}), dirty,
      ...(cursor ? { cursor } : {}), ...(selection ? { selection } : {}),
      tool: STUDIO_TOOL_FOR[currentTool] === undefined ? (currentTool as StudioTool) : STUDIO_TOOL_FOR[currentTool],
      ...(lastRun ? { lastRun: { runId: lastRun.runId, engine: lastRun.engine, turn: lastRun.turn } } : {}),
      diagnostics: problems, ...(org?.alias ? { orgAlias: org.alias } : {})
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

  // Studio tabs own the project-wide controls, so the document bar only carries what acts on the open agent.
  const stripOwnsWorkspace = layout !== 'legacy' && studio.tabs.length > 0;
  const followChip = layout !== 'legacy' && (driver || threadId || followPaused) ? <FollowChip driver={driver ?? (threadId ? 'this thread' : undefined)} paused={followPaused} onToggle={() => setFollowPaused(paused => !paused)} /> : undefined;
  const orgPicker = props.orgPicker !== false && <OrgPicker pluginId={pluginId} projectId={projectId} compact appearance="toolbar" />;
  const askAgentMenu = <AskAgentButton pluginId={pluginId} projectId={projectId} path={activePath} view={view} onShareChange={setShare} />;
  const activeBundle = bundleName(activePath);
  const documentBar = (
      <AgentScriptDocumentBar path={activePath} dirty={dirty} busy={busy} issues={issues}
        saveDisabled={saveDisabled} saveAsDisabled={!saveEnabled || busy || !playgroundReady || !activePath} panelOpen={panelShown}
        {...(stripOwnsWorkspace ? {} : { headerActions: <>{askAgentMenu}{props.headerActions}</>, follow: followChip, orgPicker })}
        onBrowse={() => browseAgents()} onSave={() => void save()}
        onPreview={() => openTool('preview')}
        onSaveAs={() => { setError(null); setSaveAsOpen(true); }} onShowPanel={showPanel}
        {...(layout === 'legacy' ? {} : {
          shortcutHint: wide, hidePanelToggle: compact || stripOwnsWorkspace,
          ...(stripOwnsWorkspace ? {} : { onQuickOpen: () => setQuickOpen(true) }),
          onCompile: () => void compile(), compiling: compiled?.status === 'running',
          onPublish: () => openTool('release'),
          onOpenInBuilder: () => void openInBuilder(), openingBuilder,
          ...(activeBundle ? { onFetch: () => setFetchAgent(activeBundle) } : {})
        })} />
  );
  const workspaceActions = stripOwnsWorkspace ? <>
    {followChip}
    {askAgentMenu}
    {props.headerActions}
    <button type="button" className="icon-btn" title={`Go to file (${modShortcut('P')})`} aria-label="Go to file" onClick={() => setQuickOpen(true)}><Search size={15} aria-hidden="true" /></button>
    {orgPicker && <div className="af-document-org">{orgPicker}</div>}
    {!panelShown && !compact && <button type="button" className="icon-btn" title="Show side panel" aria-label="Show side panel" aria-expanded={false} onClick={showPanel}><PanelRight size={15} aria-hidden="true" /></button>}
  </> : undefined;

  const showTargetTab = layout !== 'legacy' && activeEditorTab !== null && activeEditorTab.kind !== 'agent';
  const openAgentTab = (path: string) => { if (path === activePath) selectTab(`agent:${path}`); else void openFile(path); };
  const targetTabView = showTargetTab && activeEditorTab ? (
    <div className="sf-etab-view" data-testid="studio-target-view">
      {activeEditorTab.kind === 'type'
        ? <LightningTypeView key={`${projectId}:${activeEditorTab.id}`} pluginId={pluginId} projectId={projectId} typeRef={activeEditorTab.target ?? activeEditorTab.label}
          usedBy={explorerNodes.find(node => node.kind === 'lightning-type' && node.apiName === (activeEditorTab.target ?? activeEditorTab.label))?.usedBy}
          onOpenAgent={path => void openFile(path)} />
        : (() => {
          const target = activeEditorTab.target ?? `${activeEditorTab.kind}://${activeEditorTab.label}`;
          const context = dependencyContext(target, activeEditorTab.kind, activeEditorTab.label, explorerNodes, activePath, actions);
          return <AgentActionPanel key={`${projectId}:${activeEditorTab.id}`} pluginId={pluginId} projectId={projectId} org={org}
            action={targetAction(target, '')}
            {...(context ? { context: { ...context, onOpen: () => openAgentTab(context.path) } } : {})}
            initialOrigin={studio.actionOrigin} onOriginChange={chooseActionOrigin}
            onReveal={() => undefined}
            onOpenTarget={target => { const match = TARGET_PATTERN.exec(target); if (match) openTarget(match[1] as 'apex' | 'flow', match[2]); }} />;
        })()}
    </div>
  ) : false;

  const problemsCount = countProblems(problems);
  const tabs = layout === 'legacy' ? false : (
    <EditorTabs tabs={studio.tabs} active={studio.activeTab} dirtyId={dirty && activePath ? `agent:${activePath}` : null} problems={problemsCount}
      problemsId={activePath ? `agent:${activePath}` : null} trailing={workspaceActions} onSelect={selectTab} onClose={closeTab} onCloseMany={closeTabs} />
  );

  const bottomActive: BottomTab = compact ? 'problems' : studio.bottomTab;
  const bottom = layout !== 'legacy' && (wide || compactTool === 'code') ? (
    <BottomPanel open={studio.bottomOpen} active={bottomActive} problems={problemsCount} compact={compact}
      onToggle={() => patch({ bottomOpen: !studio.bottomOpen })} onSelect={tab => patch({ bottomTab: tab, bottomOpen: true })}
      render={(tab, visible) => {
        if (tab === 'problems') return <ProblemsPanel path={activePath} diagnostics={problems} compact={compact} busy={fixBusy}
          compile={compiled} stale={Boolean(compiled && (dirty || compiled.sha !== (sha256 || undefined)))}
          onReveal={line => revealLine(line)} onFixWithAgent={() => void fixWithAgent()} />;
        if (tab === 'trace') return <BottomTrace pluginId={pluginId} path={activePath} run={lastRun} visible={visible} onOpenPreview={() => openTool('preview')}
          onRevealSource={(path, line) => { if (path === activePathRef.current) revealLine(line); else void openFile(path).then(opened => { if (opened) revealLine(line); }); }} />;
        if (tab === 'output') return visible ? <OperationsPanel pluginId={pluginId} projectId={projectId} orgAlias={org?.alias} threadId={threadId} /> : null;
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
      onOpenNode={openNode} onBrowseOrg={() => browseAgents()} orgLabel={org?.alias} orgAgentsMore={orgAgentsMore} orgAgentsNotLocal={orgAgentsNotLocal}
      collapsed={studio.collapsedSections} onToggleSection={toggleSection} onHide={wide ? () => patch({ explorerOpen: false }) : undefined} />
  );

  const top = compact ? (
    <>
      <ToolStrip orientation="horizontal" label="Studio tools" iconsOnly={tier === 0} active={hostPanel ? currentTool : compactTool}
        items={COMPACT_TOOLS.map(id => stripItem(id, id === 'code' ? problemsCount : undefined))} onSelect={id => {
          if (hostPanel) { if (id !== 'code') openTool(id as AgentScriptTool); } else patch({ tool: id as CompactTool });
        }} />
    </>
  ) : false;
  const activity = wide ? (
    <ToolStrip orientation="vertical" label="Studio activity" active={studio.explorerOpen ? 'files' : null}
      items={[stripItem('files'), stripItem('agents'), { id: 'search', title: 'Go to file', icon: <Search size={16} aria-hidden="true" /> }]}
      onSelect={id => { if (id === 'files') patch({ explorerOpen: !studio.explorerOpen }); else if (id === 'agents') browseAgents(); else setQuickOpen(true); }} />
  ) : false;

  const splitMode = hostPanel ? 'editor' : swapCompact ? (compactTool === 'code' ? 'editor' : 'panel') : 'split';
  const splitOpen = hostPanel ? false : swapCompact ? compactTool !== 'code' : tools.state.open;

  const renderTool = (id: AgentScriptTool, visible: boolean): ReactNode => {
    if (id === 'agents') return <OrgAgentsPanel pluginId={pluginId} projectId={projectId} visible={visible} editorReady={playgroundReady} focus={agentsFocus} onFocusHandled={agentsFocusHandled} onNew={() => setNewAgentOpen(true)} localFiles={files.filter(file => !file.path.startsWith('.zcc/')).map(file => ({ ...file, publishable: file.path.includes('aiAuthoringBundles/') }))} onLocalOpen={path => void openFile(path)} onPublish={path => void openFile(path).then(opened => { if (opened) openTool('release'); })} onOpen={openRetrieved} />;
    if (id === 'files') return layout === 'legacy' ? explorerNode : null;
    if (id === 'comments') return <CommentsPane pluginId={pluginId} projectId={projectId} path={activePath} comments={comments}
      onReveal={revealLine}
      onResolve={(commentId, note) => { void Promise.resolve(callPluginRpc(pluginId, STUDIO_RPC.commentResolve, { projectId, id: commentId, note })).then(() => loadComments()).catch(err => { if (alive.current) setError(err instanceof Error ? err.message : String(err)); }); }}
      onAddressWithAgent={() => { void askAgent('address-comments').catch(err => { if (alive.current) setError(err instanceof Error ? err.message : String(err)); }); }} />;
    if (id === 'graph') return <AgentScriptGraphPanel source={source} visible={visible} compact={compact} focusNode={graphFocus.node} focusSeq={graphFocus.seq} onOpenAction={id => { const action = actions.find(row => row.id === id); if (action) openAction(action); }} />;
    if (id === 'preview') return <PreviewWorkbench pluginId={pluginId} projectId={projectId} source={source} fileLabel={activePath?.split('/').pop() ?? 'Draft'}
      engine={previewEngine} onEngineChange={setPreviewEngine} path={activePath ?? undefined} orgAlias={org?.alias} threadId={threadId}
      onRunChange={setLastRun} command={previewCommand} onCommandHandled={previewCommandHandled} dirty={dirty}
      onRevealSource={(path, line) => { if (path === activePathRef.current) revealLine(line); else void openFile(path).then(opened => { if (opened) revealLine(line); }); }} />;
    if (id === 'test') return <TestsPane pluginId={pluginId} projectId={projectId} threadId={threadId} path={activePath} source={source} visible={visible} dirty={dirty}
      proposalSource={proposalSource} onAskAgent={composeFor}
      roleplay={<AgentforceLabPanel pluginId={pluginId} projectId={projectId} threadId={threadId} source={source} mode="test" fileLabel={activePath?.split('/').pop() ?? 'Draft'} />} />;
    if (id === 'org-preview') return <AgentforcePreviewPanel pluginId={pluginId} projectId={projectId} />;
    if (id === 'release') return <ReleasePane pluginId={pluginId} projectId={projectId} path={activePath} visible={visible} dirty={dirty} sha256={sha256} source={source}
      compile={compiled} compileStale={Boolean(compiled && (dirty || compiled.sha !== (sha256 || undefined)))}
      onSave={() => void save()} onCompile={() => void compile()} onAskAgent={composeFor} />;
    return <div className="af-action-workspace">
      {actionTabs.length > 0 && <div className="af-related-tabs" aria-label="Open agent files">
        <div className={`af-related-tab${!selectedActionId ? ' is-active' : ''}`}><button aria-pressed={!selectedActionId} onClick={() => setSelectedActionId(null)}>All actions</button></div>
        {actionTabs.map(tab => <div className={`af-related-tab${selectedActionId === tab.action.id ? ' is-active' : ''}`} key={tab.action.id}><button title={`${tab.action.owner} · ${tab.action.target}`} aria-pressed={selectedActionId === tab.action.id} onClick={() => setSelectedActionId(tab.action.id)}>{tab.action.name}</button><button aria-label={`Close ${tab.action.name}`} onClick={() => { setActionTabs(tabs => tabs.filter(t => t.action.id !== tab.action.id)); if (selectedActionId === tab.action.id) setSelectedActionId(null); }}>×</button></div>)}
      </div>}
      {!selectedAction && <div className="af-actions-list"><h2>Actions</h2><p>Explore implementations and references in the current script.</p><AgentActionExplorer actions={actions} selected={selectedActionId ?? undefined} onOpen={openAction} />{actions.length === 0 && <EmptyState compact art="code" title="No actions in this script yet.">Add an Apex or Flow action to explore its implementation here.</EmptyState>}</div>}
      {selectedAction && <AgentActionPanel key={`${projectId}:${activePath}:${selectedAction.id}`} pluginId={pluginId} projectId={projectId} org={org} action={selectedAction} initialOrigin={selectedTab?.origin} onOriginChange={origin => { chooseActionOrigin(origin); setActionTabs(tabs => tabs.map(tab => tab.action.id === selectedActionId ? { ...tab, origin } : tab)); }} onReveal={revealLine} onOpenTarget={(target, origin) => openAction(targetAction(target, `Referenced by ${selectedAction.name}`), origin)} />}
    </div>;
  };

  return (
    <div className="sf-as" ref={tierRef} style={PANEL_ROOT} data-testid="salesforce-agent-script-panel">
      <style>{AGENTFORCE_PANEL_STYLES}</style>
      <style>{AGENTFORCE_STUDIO_STYLES}</style>
      <style>{AGENT_ACTION_STYLES}</style>
      {newAgentOpen && <NewAgentDialog pluginId={pluginId} projectId={projectId} onClose={() => setNewAgentOpen(false)} onCreated={async file => { await refreshFiles(); await openFile(file.path); openTool('files'); }} />}
      {fetchAgent && <OrgSyncDialog call={syncCall} agent={fetchAgent} onClose={() => setFetchAgent(null)} />}
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
        explorerWidth={studio.explorerWidth} onExplorerWidth={width => patch({ explorerWidth: width })}
        quickOpen={quickOpen} quickItems={quickItems} onQuickOpenChange={setQuickOpen} onQuickPick={pickQuick} onSave={save}
        onToggleExplorer={wide ? () => patch({ explorerOpen: !studio.explorerOpen }) : undefined}>
        <div className="sf-main-col">
        <AgentforceStudioSplit open={splitOpen} mode={splitMode} storageKey={`salesforce:studio:split:${draftScope}`} editor={<div className="af-action-workspace">
          {tabs}
          {!showTargetTab && documentBar}
          {orgSessionLabel(org) ? <span hidden className="sf-as-crumb-seg" data-testid="salesforce-playground-org">{orgSessionLabel(org)}</span> : null}
          {heldReveal && <FollowToast held={heldReveal} onShow={showHeldReveal} onDismiss={() => setHeldReveal(null)} />}
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
          {hostPanel ? null : <AgentScriptTools tools={tools} hiddenTools={hiddenTools} chrome={!swapCompact} open={swapCompact ? splitOpen : undefined} render={renderTool} />}
        </AgentforceStudioSplit>
        {bottom}
        </div>
      </StudioShell>
      {/* Keyed by tab: switching tabs keeps a tool's state, a reopened tab starts it fresh. */}
      {hostSlots.map(slot => createPortal(<div key={slot.tabId ?? ''} className="af-tool-content">{renderTool(slot.tool, slot.attached)}</div>, slot.node, slot.tool))}
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
  onActivePath?: (path: string | null) => void;
}) {
  return (
    <AgentScriptPanel
      pluginId={props.pluginId}
      projectId={props.projectId}
      params={props.params}
      headerActions={props.headerActions}
      orgPicker={props.orgPicker}
      threadId={props.threadId}
      onActivePath={props.onActivePath}
    />
  );
}
