import type { ContextPreset, ContextPresetList } from '../../lib/preview-context-preset-contract.js';
import { useSalesforceControl } from './useSalesforceControl.js';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Bot, Cloud, Code, FlaskConical, Files, MessageSquare, Network, PanelRight, Play, Search, Zap } from 'lucide-react';
import { callPluginRpc, useRealtime, useSettings, useZccContext, useZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
import { type AgentScriptDialect, type PublicOrgView } from '../../lib/types.js';
import { applyProposalText } from '../../lib/agent-doc-apply.js';
import { AGENT_DOC_RPC, type AgentDocSnapshot } from '../../lib/agent-doc-contract.js';
import { stableAgentDocClientId, useAgentScriptDoc } from './agent-doc/useAgentScriptDoc.js';
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
  type StudioThreadLink,
  type StudioTool
} from '../../lib/studio-contract.js';
import { takeQueuedAgentScriptOpen } from './agent-script-open.js';
import { focusKey, parseAgentforcePanelFocus, type StudioFocus } from './agentforce-panel-params.js';
import { useAgentforceTarget } from './use-agentforce-target.js';
import { OrgPicker } from './OrgPicker.js';
import { AgentScriptDocumentBar } from './AgentScriptDocumentBar.js';
import { OrgSyncDialog } from './OrgSyncDialog.js';
import {
  PLAYGROUND_ASSET_SRC,
  PLAYGROUND_BRIDGE_SOURCE,
  readDocumentTheme,
  type PlaygroundFileRef
} from './playground-bridge.js';
import { usePlaygroundBridge } from './studio/usePlaygroundBridge.js';
import { compilerDiagnostic, parseCompileReply, type CompileState } from './studio/compile-result.js';
import { TESTS_PANE_STYLES, TestsPane } from './studio/TestsPane.js';
import type { SimulationsFocus } from './studio/SimulationsView.js';
import { OrgTestsView, type OrgTestsFocus } from './studio/OrgTestsView.js';
import { LocalSuiteDetail } from './studio/LocalSuiteDetail.js';
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
import { AgentScriptTools, isColumnTool, useAgentScriptTools, type AgentScriptTool } from './AgentScriptTools.js';
import { OrgAgentsPanel } from './OrgAgentsPanel.js';
import type { RetrievedOrgAgent } from '../../lib/org-agent-contract.js';
import { AgentScriptGraphPanel } from './AgentScriptGraphPanel.js';
import { agentSuitePath, draftCasesPrompt, graphCoverage } from '../../lib/graph-coverage.js';
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
import { PreviewRunReplay } from './preview/PreviewRunReplay.js';
import { OperationsPanel } from './panels/OperationsPanel.js';
import { AskAgentButton } from './studio/AskAgentButton.js';
import { isPanelTool, panelToolActionId, useStudioRegistration, useStudioToolSlots, type PanelTool } from './studio/studio-tool-bridge.js';
import { CommentsPane } from './studio/CommentsPane.js';
import { useStudioView } from './studio/useStudioView.js';
import { StudioShell } from './studio/StudioShell.js';
import { Explorer } from './studio/Explorer.js';
import { EditorTabs } from './studio/EditorTabs.js';
import { LightningTypeView } from './studio/LightningTypeView.js';
import { LwcBundleView } from './studio/LwcBundleView.js';
import { BottomPanel, type BottomTab } from './studio/BottomPanel.js';
import { ProblemsPanel } from './studio/ProblemsPanel.js';
import { ToolStrip, type StripItem } from './studio/ToolStrip.js';
import type { QuickOpenItem } from './studio/QuickOpen.js';
import { layoutForTier, useWidthTier } from './studio/useWidthTier.js';
import { scriptTabId, useStudioLayout, viewTab, viewTabId, type CompactTool, type EditorTab, type RailTab, type ViewTarget } from './studio/studio-layout.js';
import { AgentTabs } from './studio/AgentTabs.js';
import { registerStudioIntentTarget, type StudioIntent } from './studio/studio-intents.js';
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
  actions: <Zap size={16} aria-hidden="true" />, 'org-preview': <Cloud size={16} aria-hidden="true" />, comments: <MessageSquare size={16} aria-hidden="true" />
};
const TOOL_TITLE: Record<CompactTool, string> = {
  code: 'Code', agents: 'Agents', files: 'Files', graph: 'Graph', preview: 'Preview', test: 'Tests', actions: 'Actions',
  'org-preview': 'Org preview', comments: 'Comments'
};
/** Tools offered by the compact strip, in order. Files (QuickOpen) is intentionally absent. */
const COMPACT_TOOLS: readonly CompactTool[] = ['code', 'agents', 'graph', 'preview', 'test', 'actions', 'comments', 'org-preview'];
/** Studio can open the host side panel's tabs but not close them; the user closes them there. */
const HOST_PANEL_CLOSE = 'Studio tools are in the ZCC side panel; close or hide them from the panel.';
/** The tools that open as an editor view tab; the rest live in the side column or the host panel. */
const VIEW_FOR_TOOL: Partial<Record<AgentScriptTool, ViewTarget>> = { preview: 'preview', test: 'tests', graph: 'graph', 'org-preview': 'org-preview' };
const TOOL_FOR_VIEW: Record<ViewTarget, AgentScriptTool> = { preview: 'preview', tests: 'test', graph: 'graph', 'org-preview': 'org-preview' };
const HIDDEN_COMPACT: readonly AgentScriptTool[] = ['files'];
const ORG_AGENTS_TAB: EditorTab = { id: 'org-agents', kind: 'org', label: 'Org agents', target: 'agents' };
/** The org's Testing Center definitions and runs, full width beside the editor's other tabs. */
const ORG_TESTS_TAB: EditorTab = { id: 'org-tests', kind: 'org', label: 'Tests', target: 'tests' };
const HIDDEN_WIDE: readonly AgentScriptTool[] = ['files'];
const NO_HIDDEN: readonly AgentScriptTool[] = [];
const stripItem = (id: CompactTool, badge?: number): StripItem => ({ id, title: TOOL_TITLE[id], icon: TOOL_ICON[id], ...(badge ? { badge } : {}) });
const STUDIO_TOOL_FOR: Record<string, StudioTool | null> = { test: 'tests', files: 'code', 'org-preview': null, new: null };
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
/** The saved version a draft of the shared document sits on: the disk text when dirty, the text itself when clean. */
export function docBaseline(doc: AgentDocSnapshot): { baseline: string; baseSha: string } | Record<string, never> {
  const baseline = doc.dirty ? doc.savedText : doc.text;
  return baseline !== null && /^[0-9a-f]{64}$/.test(doc.baseSha256) ? { baseline, baseSha: doc.baseSha256 } : {};
}

/**
 * Pre-release builds kept the Studio layout (and split) per thread, under `salesforce:studio:["<scope>","<thread>"]`. The layout is
 * per project now; those keys are never read again, so they are dropped once per page. Bounded: storage holds a few hundred keys.
 */
let threadLayoutsPruned = false;
export function pruneThreadLayoutKeys(storage: Pick<Storage, 'length' | 'key' | 'removeItem'> | undefined = globalThis.localStorage): number {
  if (threadLayoutsPruned || !storage) return 0;
  threadLayoutsPruned = true;
  const stale: string[] = [];
  try {
    for (let i = 0, n = Math.min(storage.length, 2000); i < n; i++) {
      const key = storage.key(i);
      if (key && (key.startsWith('salesforce:studio:["') || key.startsWith('salesforce:studio:split:["'))) stale.push(key);
    }
    for (const key of stale) storage.removeItem(key);
  } catch { /* storage is optional */ }
  return stale.length;
}
/** Test seam: lets a test run the prune again. */
export function resetThreadLayoutPrune(): void { threadLayoutsPruned = false; }

const SAVE_DEBOUNCE_MS = 150;
const DISK_POLL_MS = 2500;
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
  tabId?: string;
  /** The open agent file, then null once the panel goes away. Pass a stable function. */
  onActivePath?: (path: string | null) => void;
};
/** `…/aiAuthoringBundles/Name/Name.agent` → `Name`; other files have no bundle to fetch. */
export const bundleName = (path: string | null) => path?.match(/(?:^|\/)([A-Za-z][A-Za-z0-9_]*)\/\1\.agent$/)?.[1] ?? null;

export function AgentScriptPanel(props: AgentScriptPanelProps) {
  useContextChangeRelay();
  const context = useZccContext();
  const projectId = props.projectId ?? context.projectId ?? undefined;
  const threadId = props.threadId || context.threadId || undefined;
  return <AgentScriptWorkspace key={JSON.stringify([props.pluginId, projectId, threadId])} {...props} projectId={projectId} threadId={threadId} />;
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
  const { target: agentTarget, select: selectAgentTarget } = useAgentforceTarget({ pluginId, projectId, threadId, tabId: props.tabId, surface: 'playground', params: { ...focus, path: focus.path ?? props.subPath } });
  const initialPath = agentTarget?.path ?? null;
  const initialFileOpened = useRef(false);
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
  // Selection is remembered per thread; the layout is per project (and window), never per thread, so it cannot pile up one key per thread.
  const selectionScope = threadId ? JSON.stringify([draftScope, threadId]) : draftScope;
  const studioWindow = context.surface === 'plugin-view';
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
  const [rootEl, setRootEl] = useState<HTMLElement | null>(null);
  const rootRef = useCallback((element: HTMLElement | null) => { tierRef(element); setRootEl(element); }, [tierRef]);
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
  // Opening the panel reopens the tool last shown there; the panel's New Tab lists the rest.
  const lastHostTool = useRef<PanelTool>('actions');
  if (hostTool) lastHostTool.current = hostTool;
  // A tool the host agreed to show, until its tab attaches: commands report it right away.
  const requestedHostTool = useRef<PanelTool | null>(null);
  const seenHostTool = useRef(hostTool);
  if (seenHostTool.current !== hostTool) { seenHostTool.current = hostTool; requestedHostTool.current = null; }
  // Without a host panel the compact layout swaps the editor for one tool at a time.
  const swapCompact = compact && !hostPanel;
  useEffect(() => { pruneThreadLayoutKeys(); }, []);
  // The Studio window keeps its own layout, seeded from the project tab's the first time.
  const studioLayout = useStudioLayout(studioWindow ? `${draftScope}|window` : draftScope, draftScope);
  const { state: studio, patch, patchWorkspace, openTab, selectTab, closeTab, closeTabs, openAgent, selectAgent, closeAgent } = studioLayout;
  const studioRef = useRef(studio);
  studioRef.current = studio;
  /** Brings the open agent's Script tab to the front, where proposals are reviewed. */
  const showScriptRef = useRef(() => {});
  showScriptRef.current = () => { const path = activePathRef.current; if (path && studioRef.current.activeTab !== scriptTabId(path)) selectTab(scriptTabId(path)); };
  const activeEditorTab = studio.tabs.find(tab => tab.id === studio.activeTab) ?? null;
  const [quickOpen, setQuickOpen] = useState(false);
  const suites = useSuites(pluginId, projectId);
  const [playgroundReady, setPlaygroundReady] = useState(false);
  const playgroundReadyRef = useRef(false);
  playgroundReadyRef.current = playgroundReady;
  /** The latest agent asked for (explorer, a card, view.open) while the frame was still loading. */
  const requestedBeforeReady = useRef<string | null>(null);
  const [iframeError, setIframeError] = useState(false);
  const [playgroundTimedOut, setPlaygroundTimedOut] = useState(false);
  const [source, setSource] = useState('');
  const [diagnostics, setDiagnostics] = useState<StudioDiagnostic[]>([]);
  const [cursor, setCursor] = useState<{ line: number; column: number } | undefined>(undefined);
  const [selection, setSelection] = useState<{ startLine: number; endLine: number; text: string } | undefined>(undefined);
  const [comments, setComments] = useState<StudioComment[]>([]);
  // Bumped on every successful file read so comments reload even when the same path is reopened.
  const [fileLoads, setFileLoads] = useState(0);
  const [fixBusy, setFixBusy] = useState(false);
  const [previewEngine, setPreviewEngine] = useState<StudioEngine>('simulate');
  const [previewCommand, setPreviewCommand] = useState<PreviewCommand | null>(null);
  // Monotonic, so a command issued after one was handled and dropped never reuses its seq.
  const previewSeq = useRef(0);
  const previewCommandHandled = useCallback((seq: number) => setPreviewCommand(current => current?.seq === seq ? null : current), []);
  // Each agent's running preview, so its tab can show the mark while another agent is in front.
  const [runs, setRuns] = useState<Record<string, { runId: string; engine: StudioEngine; turn: number } | null>>({});
  const runChangers = useRef(new Map<string, (run: { runId: string; engine: StudioEngine; turn: number } | null) => void>());
  const runChangeFor = (path: string) => {
    let change = runChangers.current.get(path);
    if (!change) { change = run => setRuns(current => current[path] === run || (!current[path] && !run) ? current : { ...current, [path]: run }); runChangers.current.set(path, change); }
    return change;
  };
  // The source of every agent shown this session, so a view of another agent keeps its content while it is not in front.
  const sourceCache = useRef<Record<string, string>>({});
  // The path the editor frame currently holds (set once its file is read), so a snapshot lands on the right agent.
  const loadedPath = useRef<string | null>(null);
  /** A stored run a card asked to see: shown read-only over that agent's Preview until closed. */
  const [previewRun, setPreviewRun] = useState<{ path: string; runId: string; turn?: number; seq: number } | null>(null);
  const [graphFocus, setGraphFocus] = useState<{ node: string | null; seq: number; caseId?: string }>({ node: null, seq: 0 });
  const [editorCompactOverride, setEditorCompactOverride] = useState<boolean | null>(null);
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [actionTabs, setActionTabs] = useState<Array<{ action: AgentAction; origin: 'project' | 'org' }>>([]);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const selectedTab = actionTabs.find(tab => tab.action.id === selectedActionId);
  const selectedAction = selectedTab && (actions.find(action => action.id === selectedActionId) ?? selectedTab.action);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  /** "Inspect <action>" in an agent that is not loaded yet: opened once that agent's snapshot lists it. */
  const pendingInspect = useRef<{ path: string; id: string } | null>(null);
  const [issues, setIssues] = useState(0);
  const [fileQuery, setFileQuery] = useState('');
  const [org, setOrg] = useState<PublicOrgView | null>(null);
  const orgEpoch = useRef(0);
  const saveEnabled = Boolean(projectId) || Boolean(status?.dxProject);
  const activePathRef = useRef(activePath);
  activePathRef.current = activePath;
  const lastRun = activePath ? runs[activePath] ?? null : null;
  const onActivePath = props.onActivePath;
  useEffect(() => { onActivePath?.(activePath); }, [activePath, onActivePath]);
  useEffect(() => () => onActivePath?.(null), [onActivePath]);
  const shaRef = useRef(sha256);
  shaRef.current = sha256;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  /** The path the frame has sent a snapshot for: only then does `source` hold that agent's text. */
  const [snapshotPath, setSnapshotPath] = useState<string | null>(null);
  const diagnosticsRef = useRef<StudioDiagnostic[]>([]);

  // The shared document of the open agent: this Studio edits it (holds the lease), other surfaces read it and propose.
  // The client id survives a reload (sessionStorage), so the page renews its own lease instead of waiting out the old one.
  const docEditor = useMemo(() => ({ clientId: stableAgentDocClientId(`${draftScope}|${studioWindow ? 'window' : 'tab'}`), label: studioWindow ? 'Agentforce Studio window' : 'Agentforce Studio' }), [draftScope, studioWindow]);
  // Only an editor whose frame loaded this agent edits it: until then (or if the frame never loads) the document is opened as a viewer,
  // so a broken frame never holds the lease.
  const editorReady = playgroundReady && Boolean(activePath) && snapshotPath === activePath;
  const docOptions = useMemo(() => ({ editor: editorReady ? docEditor : { ...docEditor, standby: true } }), [docEditor, editorReady]);
  const agentDoc = useAgentScriptDoc(pluginId, projectId ?? null, activePath, docOptions);
  const agentDocRef = useRef(agentDoc);
  agentDocRef.current = agentDoc;
  // Effects run in order: once the hook points at the new path this ref follows, and only then do snapshots reach it.
  const docPath = useRef<string | null>(null);
  useEffect(() => { docPath.current = activePath; }, [activePath]);
  // The lease arrives after the first snapshots. Hand over what the editor holds (a recovered draft included) only once the frame
  // has sent this agent's snapshot. A dirty document another editor wrote last is loaded instead (with its saved version as the
  // baseline); text this editor wrote last is never newer there than here, so it is pushed.
  useEffect(() => {
    if (!agentDoc.leased || !activePath || snapshotPath !== activePath) return;
    const live = agentDoc.doc;
    if (live && live.path === activePath && live.dirty && live.text !== null && live.lastWriter && live.lastWriter !== docEditor.clientId && live.text !== sourceRef.current) {
      send.raw({ source: PLAYGROUND_BRIDGE_SOURCE, type: 'setReadOnly', readOnly: false, content: live.text, ...docBaseline(live) });
      return;
    }
    agentDoc.update(sourceRef.current, diagnosticsRef.current, shaRef.current || undefined);
  }, [agentDoc.leased, agentDoc.leaseGen, snapshotPath, activePath]); // eslint-disable-line react-hooks/exhaustive-deps
  const heldBy = agentDoc.heldBy;
  // Another Studio edits this agent: the frame is read-only and follows the holder's live text.
  const heldById = heldBy?.clientId ?? null;
  const followText = heldBy ? agentDoc.doc?.text ?? null : null;
  const frameLocked = useRef(false);
  useEffect(() => {
    if (!playgroundReady || !activePath || snapshotPath !== activePath || (!heldById && !frameLocked.current)) return;
    frameLocked.current = Boolean(heldById);
    // Unlocked (the holder left, or this window took over): the draft sits on the shared document's saved version from now on.
    const live = agentDocRef.current.doc;
    send.raw(heldById
      ? { source: PLAYGROUND_BRIDGE_SOURCE, type: 'setReadOnly', readOnly: true, ...(followText !== null ? { content: followText } : {}) }
      : { source: PLAYGROUND_BRIDGE_SOURCE, type: 'setReadOnly', readOnly: false, ...(live && live.path === activePath ? docBaseline(live) : {}) });
  }, [playgroundReady, activePath, snapshotPath, heldById, followText, send]);
  const heldByRef = useRef(heldBy);
  heldByRef.current = heldBy;

  // Compact shows exactly one tool; hidden tools fall back to the editor.
  const compactTool: CompactTool = hostPanel || HIDDEN_COMPACT.includes(studio.tool as AgentScriptTool) || (studio.tool !== 'code' && !isColumnTool(studio.tool)) ? 'code' : studio.tool;
  const hiddenTools = compact ? HIDDEN_COMPACT : wide ? HIDDEN_WIDE : NO_HIDDEN;
  // A view tab in front is the tool in use; otherwise the side column's (or the host panel's) tool.
  const viewTool = activeEditorTab?.kind === 'view' && activeEditorTab.target ? TOOL_FOR_VIEW[activeEditorTab.target as ViewTarget] ?? null : null;
  const currentTool: CompactTool = hostPanel
    ? hostTool ?? viewTool ?? 'code'
    : viewTool ?? (compact
    ? compactTool
    : tools.state.open && tools.state.active !== 'new' && !hiddenTools.includes(tools.state.active) ? tools.state.active : 'code');

  // Graph, Preview, Tests and Org preview open as one view tab of the open agent (one per kind).
  const openView = useCallback((target: ViewTarget) => {
    if (!studioRef.current.activeAgent) { setError(`Open an agent to see its ${target === 'tests' ? 'tests' : target === 'org-preview' ? 'org preview' : target}.`); return; }
    openTab(viewTab(target));
    if (compact) patch({ tool: 'code' });
  }, [compact, openTab, patch]);
  const openTool = useCallback((id: AgentScriptTool) => {
    const view = VIEW_FOR_TOOL[id];
    if (view) { openView(view); return; }
    if (id === 'files' && layout !== 'legacy') {
      if (layout === 'wide') patch({ explorerOpen: true });
      else patch({ tool: 'code' });
      return;
    }
    // Beside a host side panel, browsing org agents picks what to edit, so it opens as an editor tab.
    if (id === 'agents' && hostCapable) { openTab(ORG_AGENTS_TAB); return; }
    if (hostCapable && isPanelTool(id)) {
      if (navigateRef.current.openPanelTool?.({ actionId: panelToolActionId(id) })) {
        if (id !== hostTool) requestedHostTool.current = id;
        setHostRefused(false);
        patch({ rail: id });
        return;
      }
      setHostRefused(true);
    }
    tools.openTool(id);
    patch({ tool: id });
  }, [hostCapable, hostTool, layout, openTab, openView, patch, tools.openTool]);
  const panelShown = hostPanel ? hostTool !== null : tools.state.open;
  // A host panel showing another tab (a thread) is still open. The host panel has its own toggle, so Studio shows one only without it.
  const panelVisible = hostPanel && typeof context.sidePanelOpen === 'boolean' ? context.sidePanelOpen : panelShown;
  const showPanel = useCallback(() => {
    if (hostPanel) openTool(lastHostTool.current);
    else tools.toggle();
  }, [hostPanel, openTool, tools.toggle]);
  const closeTool = useCallback((id: AgentScriptTool) => {
    const view = VIEW_FOR_TOOL[id];
    if (view) { closeTab(viewTabId(view)); return; }
    if (hostPanel && isPanelTool(id)) throw Error(HOST_PANEL_CLOSE);
    tools.close(id);
    if (studio.tool === id) patch({ tool: 'code' });
  }, [closeTab, hostPanel, patch, studio.tool, tools.close]);
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

  // The rail's Org tests entry and orgTests.open land in the Org tests tab; a named definition or run is shown once.
  const orgTestsSeq = useRef(0);
  const [orgTestsFocus, setOrgTestsFocus] = useState<OrgTestsFocus | null>(null);
  const openOrgTests = useCallback((target: { name?: string; runId?: string } = {}) => {
    if (target.name || target.runId) { orgTestsSeq.current += 1; setOrgTestsFocus({ ...target, seq: orgTestsSeq.current }); }
    openTab(ORG_TESTS_TAB);
  }, [openTab]);
  const orgTestsFocusHandled = useCallback((seq: number) => setOrgTestsFocus(current => current?.seq === seq ? null : current), []);

  // simulations.open lands in Tests > Simulations; a named batch is shown once.
  const simulationsSeq = useRef(0);
  const [simulationsFocus, setSimulationsFocus] = useState<SimulationsFocus | null>(null);
  const openSimulations = useCallback((target: { batchId?: string } = {}) => {
    simulationsSeq.current += 1;
    setSimulationsFocus({ ...target, seq: simulationsSeq.current });
    openTool('test');
  }, [openTool]);
  const simulationsFocusHandled = useCallback((seq: number) => setSimulationsFocus(current => current?.seq === seq ? null : current), []);

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
    showScriptRef.current();
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
  // Agents unfolded in the outline that the explorer had not scanned; newest first, bounded like the server's `expand`.
  const expandedAgents = useRef<string[]>([]);
  const refreshExplorer = useCallback(async () => {
    const seq = ++explorerSeq.current;
    try {
      // The open agent, then unfolded ones, are scanned first, so they show their references however many agents the project has.
      const scan = { ...(activePathRef.current ? { focus: activePathRef.current } : {}), ...(expandedAgents.current.length ? { expand: expandedAgents.current } : {}) };
      const result = (await callPluginRpc(pluginId, STUDIO_RPC.explorer, rpcArgs(Object.keys(scan).length ? scan : undefined))) as { ok?: boolean; nodes?: ExplorerNode[]; orgAgentsTruncated?: boolean; orgAgentsNotLocal?: number };
      if (alive.current && seq === explorerSeq.current && result?.ok !== false && Array.isArray(result?.nodes)) {
        setExplorerNodes(result.nodes);
        setOrgAgentsMore(result.orgAgentsTruncated === true);
        setOrgAgentsNotLocal(typeof result.orgAgentsNotLocal === 'number' ? result.orgAgentsNotLocal : undefined);
      }
    } catch { /* the explorer sections are an enhancement over the file tree */ }
  }, [pluginId, rpcArgs]);

  // A newly opened agent may sit past the explorer's scan window: list again with it in focus.
  useEffect(() => { if (activePath) void refreshExplorer(); }, [activePath, refreshExplorer]);
  const [indexingAgents, setIndexingAgents] = useState<string[]>([]);
  const indexAgent = useCallback((path: string) => {
    expandedAgents.current = [path, ...expandedAgents.current.filter(row => row !== path)].slice(0, 20);
    setIndexingAgents(current => [...current, path]);
    void refreshExplorer().finally(() => { if (alive.current) setIndexingAgents(current => current.filter(row => row !== path)); });
  }, [refreshExplorer]);

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
    async (path: string | null, isCurrent: () => boolean = () => true, restore = false) => {
      if (!isCurrent()) return false;
      // Before the frame is ready its setFile is lost: remember the request, the ready handler opens it (and nothing older).
      if (path && !playgroundReadyRef.current) requestedBeforeReady.current = path;
      if (pendingInspect.current?.path !== path) pendingInspect.current = null;
      const generation = ++fileEpoch.current;
      setError(null);
      setActionTabs([]);
      setSelectedActionId(null);
      setActions([]);
      setSource('');
      loadedPath.current = null;
      setSnapshotPath(null);
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
        if (compact) patch({ tool: 'code' });
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
        if (restore) closeAgent(path); // a tab whose file is gone cannot be restored
        return false;
      }
      const identity = `file:${result.file.path}`;
      activeDraft.current = agentDraftKey(draftScope, identity);
      rememberAgentSelection(selectionScope, identity);
      selectAgentTarget({ path: result.file.path });
      setActivePath(result.file.path);
      setSha256(result.file.sha256);
      setDirty(false);
      loadedPath.current = result.file.path;
      openAgent(result.file.path, basename(result.file.path));
      if (!restore) selectTab(scriptTabId(result.file.path));
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
    [closeAgent, compact, dialect, openAgent, patch, pluginId, rpcArgs, draftScope, selectionScope, selectTab, send, settleProposals, selectAgentTarget]
  );

  // A retrieval opens its file seconds after the click: read the live editor, not the click-time render.
  const openFileRef = useRef(openFile);
  openFileRef.current = openFile;
  // Graph "Inspect <action>": the latest actions of the loaded agent, never a render-time copy; another agent's graph loads it first.
  const inspectAction = useCallback((path: string, id: string) => {
    if (path !== activePathRef.current) {
      pendingInspect.current = { path, id };
      const drop = () => { if (pendingInspect.current?.id === id) pendingInspect.current = null; };
      void openFileRef.current(path).then(opened => { if (!opened) drop(); }, drop);
      return;
    }
    const action = actionsRef.current.find(row => row.id === id);
    if (action) openAction(action);
  }, [openAction]);
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

  // Agent tabs follow selection: choosing another agent loads its file (and its own draft) and shows its workspace.
  useEffect(() => {
    if (!playgroundReady || !initialFileOpened.current) return;
    const wanted = studio.activeAgent;
    if (wanted === activePathRef.current || (!wanted && !activePathRef.current)) return;
    void openFile(wanted, undefined, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playgroundReady, studio.activeAgent]);

  const checkingDisk = useRef(false);
  const checkDisk = useCallback(async () => {
    const path = activePathRef.current;
    const draftKey = activeDraft.current;
    // A follower shows the holder's text; the holder offers disk changes, and the unlock re-baselines this frame.
    if (!path || !draftKey || checkingDisk.current || saving.current || heldByRef.current) return;
    checkingDisk.current = true;
    const generation = fileEpoch.current;
    try {
      const result = (await callPluginRpc(pluginId, 'agentFiles.read', rpcArgs({ path }))) as { ok?: boolean; file?: { content: string; sha256: string } };
      const file = result?.ok ? result.file : undefined;
      if (!alive.current || generation !== fileEpoch.current || activePathRef.current !== path || !file || file.sha256 === shaRef.current || heldByRef.current) return;
      send.fileChanged({ draftKey, content: file.content, sha256: file.sha256 });
    } catch { /* the next check retries */ } finally {
      checkingDisk.current = false;
    }
  }, [pluginId, rpcArgs, send]);
  const loadComments = useCallback(async () => {
    const path = activePathRef.current;
    if (!projectId || !path) { setComments([]); return; }
    try {
      const result = (await callPluginRpc(pluginId, STUDIO_RPC.comments, { projectId, path, includeResolved: true, content: sourceRef.current || undefined })) as { ok?: boolean; comments?: StudioComment[] };
      if (alive.current && activePathRef.current === path && result?.ok !== false && Array.isArray(result?.comments)) setComments(result.comments);
    } catch { /* comments are optional */ }
  }, [pluginId, projectId]);
  useEffect(() => { void loadComments(); }, [loadComments, activePath, fileLoads]);
  /** Runs a comment mutation, shows its failure, and reloads the list either way. */
  const commentRpc = (method: string, args: Record<string, unknown>, fallback: string) => {
    if (!projectId) return;
    void Promise.resolve(callPluginRpc(pluginId, method, { projectId, ...args }))
      .then(result => { const failure = result as { ok?: boolean; error?: string } | null; if (failure?.ok === false && alive.current) setError(failure.error || fallback); void loadComments(); })
      .catch(err => { if (alive.current) setError(err instanceof Error ? err.message : String(err)); });
  };
  const updateComment = (id: string, body: string) => commentRpc(STUDIO_RPC.commentUpdate, { id, body }, 'Could not edit the comment.');
  const deleteComment = (id: string) => commentRpc(STUDIO_RPC.commentDelete, { id }, 'Could not delete the comment.');
  // Each agent remembers its Assistant thread: the newest linked to its file, and a thread that appears later takes the rail.
  const seenThreads = useRef(new Map<string, Set<string>>());
  const loadThreads = useCallback(async () => {
    const path = activePathRef.current;
    if (!projectId || !path) return;
    try {
      const result = (await callPluginRpc(pluginId, STUDIO_RPC.threads, { projectId, path })) as { ok?: boolean; threads?: StudioThreadLink[] } | null;
      if (!alive.current || activePathRef.current !== path || result?.ok === false || !Array.isArray(result?.threads) || !result.threads.length) return;
      const list = result.threads;
      const newest = [...list].sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0];
      const seen = seenThreads.current.get(path);
      seenThreads.current.set(path, new Set(list.map(row => row.threadId)));
      const known = studioRef.current.workspaces[path]?.threadId;
      if (seen && !seen.has(newest.threadId)) patchWorkspace(path, { threadId: newest.threadId, rail: 'assistant' });
      else if (!known || !list.some(row => row.threadId === known)) patchWorkspace(path, { threadId: newest.threadId });
    } catch { /* the Assistant thread is an enhancement */ }
  }, [patchWorkspace, pluginId, projectId]);
  useEffect(() => { void loadThreads(); }, [loadThreads, activePath]);
  useRealtime(STUDIO_CHANGED_CHANNEL, payload => {
    const changed = payload as { projectId?: string; path?: string; kind?: string } | null;
    if (changed?.kind === 'threads' && (!changed.projectId || changed.projectId === projectId)) void loadThreads();
    if (changed?.kind === 'comments' && (!changed.projectId || changed.projectId === projectId)) void loadComments();
    // Fetch latest wrote org files into the project.
    if (changed?.kind === 'files' && (!changed.projectId || changed.projectId === projectId)) {
      void refreshFiles().catch(() => undefined);
      if (!changed.path || changed.path === activePathRef.current) void checkDisk();
    }
  });
  // An agent can write the open file through the Studio or straight to disk: poll while the Studio is in view.
  useEffect(() => {
    if (!playgroundReady || !activePath) return;
    const tick = () => { if (document.visibilityState === 'visible') void checkDisk(); };
    const timer = window.setInterval(tick, DISK_POLL_MS);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [activePath, checkDisk, playgroundReady]);
  useEffect(() => { if (playgroundReady) send.setComments(comments); }, [comments, playgroundReady, send]);

  const editorCompact = editorCompactOverride ?? !wide;
  useEffect(() => { if (playgroundReady) send.setLayout(editorCompact); }, [editorCompact, playgroundReady, send]);

  // Panel params from chat cards and guardrail rows: reveal a line, or open a dependency in the Actions tool.
  const pendingFocus = useRef<StudioFocus | null>(Object.keys(focus).length && (!focus.path || focus.path === initialPath) ? focus : null);
  const firstFocus = useRef(true);
  // Capture a new card before the iframe's ready event can restore an empty or
  // older selection. Passive effects can run after that event in another window.
  useLayoutEffect(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    const next = parseAgentforcePanelFocus(props.params);
    if (!Object.keys(next).length) return;
    pendingFocus.current = next;
    if (playgroundReady && next.path && next.path !== activePathRef.current) void openFile(next.path);
    else setFocusTick(tick => tick + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSignature]);
  const followedAgentPath = useRef(agentTarget?.path);
  useEffect(() => {
    const previous = followedAgentPath.current;
    followedAgentPath.current = agentTarget?.path;
    if (previous === agentTarget?.path) return;
    if (!playgroundReady || !agentTarget || (agentTarget.path ?? null) === activePathRef.current) return;
    if (agentTarget.path && pendingFocus.current?.path === agentTarget.path) return;
    void openFile(agentTarget.path ?? null, undefined, !!agentTarget.path && agentTarget.path === studioRef.current.activeAgent);
    // Selection changes follow Preview without reopening the file on every editor render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentTarget?.path, playgroundReady]);
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
    if (pending.simulation) openSimulations({ batchId: pending.simulation });
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
  /** Shows an agent's rail tab in the host side panel. False when the host cannot (no panel, or no thread yet for Assistant). */
  const openRail = useCallback((tab: RailTab, path: string | null = activePathRef.current): boolean => {
    const host = navigateRef.current;
    if (tab === 'assistant') {
      const id = path ? studioRef.current.workspaces[path]?.threadId : undefined;
      return Boolean(id && path && host.openPanelAgent?.({ threadId: id, title: basename(path) }));
    }
    return Boolean(host.openPanelTool?.({ actionId: panelToolActionId(tab) }));
  }, []);
  // Switching agents brings back that agent's rail, but only into a side panel that is already open.
  const railAgent = useRef(studio.activeAgent);
  useEffect(() => {
    if (railAgent.current === studio.activeAgent) return;
    railAgent.current = studio.activeAgent;
    if (context.sidePanelOpen !== true || !studio.activeAgent) return;
    const rail = studioRef.current.workspaces[studio.activeAgent]?.rail;
    if (rail) openRail(rail, studio.activeAgent);
  }, [context.sidePanelOpen, openRail, studio.activeAgent]);

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
    if (now - lastSave.current < SAVE_DEBOUNCE_MS || busy || heldBy) return;
    lastSave.current = now;
    if (!activePath) {
      if (saveEnabled && playgroundReady) { setError(null); setSaveAsOpen(true); }
      return;
    }
    send.flushSave();
  }, [activePath, busy, heldBy, playgroundReady, saveEnabled, send]);

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
            void agentDocRef.current.saved(result.file.sha256, content);
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
  /** An agent names a preset by id; it is read for the open agent and org so a wrong id fails the command, not the view. */
  const savedPreset = async (id: string): Promise<ContextPreset> => {
    const path = activePathRef.current;
    if (!path) throw Error('Open an agent before using a context preset.');
    const result = await callPluginRpc(pluginId, 'agentPreview.presets.list', rpcArgs({ path, ...(org?.alias ? { orgAlias: org.alias } : {}) })) as ContextPresetList;
    if (!result?.ok) throw Error(result?.error || 'Presets could not be loaded.');
    const preset = result.presets?.find(p => p.id === id);
    if (!preset) throw Error(`No context preset ${id} for ${path}. List them with contextPresets.list.`);
    return preset;
  };
  // Proposals other surfaces left on the shared document. A pending one is shown in this editor like the Studio's own.
  // One a read-only view accepted is applied here, because only the lease holder may change the file, and only when that is safe:
  //  - clean buffer on the version it was written against: written to disk, then resolved 'applied';
  //  - unsaved edits: nothing is written. A whole-file proposal goes to the editor's review so the person decides there;
  //    line edits cannot be placed over unsaved edits, so they are rejected with a visible reason;
  //  - another version of the file: rejected with a visible reason.
  // A pending proposal written against another version is left pending (the thread shows it as stale) and not shown here.
  // Tracks what was done per proposal, so a status change (pending -> accept-requested, resolved elsewhere) is acted on once.
  const handledProposals = useRef(new Map<string, string>());
  /** Reviews of shared-document proposals in the frame (not the Studio's own command proposals): the frame shows one review at a time. */
  const sharedReviews = useRef(new Set<string>());
  useEffect(() => { handledProposals.current.clear(); sharedReviews.current.clear(); }, [activePath]);
  /** Takes a proposal out of the frame's review; a command still waiting on it learns it was decided elsewhere. */
  const retractProposal = useCallback((id: string, note: string) => {
    const waiting = pendingProposals.current.get(id);
    pendingProposals.current.delete(id);
    sharedReviews.current.delete(id);
    send.clearProposal(id);
    if (pendingProposals.current.size === 0) setProposalSource(null);
    waiting?.({ outcome: 'rejected', acceptedHunks: 0, rejectedHunks: 0, note });
  }, [send]);
  const applyAccepted = useCallback(async (id: string, input: ProposeEditInput) => {
    const path = activePathRef.current;
    if (!path) return;
    const refuse = async (reason: string) => {
      setError(reason);
      retractProposal(id, reason);
      await agentDocRef.current.resolve(id, 'reject');
    };
    try {
      if (input.expectedSha256 !== shaRef.current) { await refuse('An accepted edit from the thread was dropped: the file changed after it was proposed.'); return; }
      if (dirtyRef.current) {
        if (input.content === undefined) { await refuse('An accepted edit from the thread was dropped: it changes lines, and you have unsaved edits. Save or discard them and ask again.'); return; }
        // Another review is open: this one waits (unmarked) and is applied once that closes; showing it would supersede the other.
        if (pendingProposals.current.size > 0 && !pendingProposals.current.has(id)) { handledProposals.current.delete(id); return; }
        // Whole-file replacement over unsaved edits: the person reviews the diff in the editor and decides there.
        sharedReviews.current.add(id);
        pendingProposals.current.set(id, pendingProposals.current.get(id) ?? (() => undefined));
        setProposalSource(input.content);
        showScriptRef.current();
        send.proposeEdit({ proposalId: id, content: input.content, summary: input.summary, actor: 'Agent' });
        return;
      }
      const text = applyProposalText(sourceRef.current, input);
      const result = (await callPluginRpc(pluginId, 'agentFiles.write', rpcArgs({ path, content: text, expectedSha256: shaRef.current }))) as { ok?: boolean; error?: string; file?: { sha256: string } } | null;
      if (result?.ok && result.file && (!alive.current || activePathRef.current !== path)) {
        // The file is written, but the person switched agents (or closed Studio): settle the written path's document directly,
        // or the proposal would stay accept-requested and the document dirty against the old version.
        const sha256 = result.file.sha256;
        await callPluginRpc(pluginId, AGENT_DOC_RPC.saved, { path, clientId: docEditor.clientId, sha256, text });
        await callPluginRpc(pluginId, AGENT_DOC_RPC.resolve, { path, id, decision: 'applied', clientId: docEditor.clientId, sha256 });
        return;
      }
      if (!alive.current || activePathRef.current !== path) return;
      if (!result?.ok || !result.file) { await refuse(result?.error || 'Could not apply the accepted edit.'); return; }
      const waiting = pendingProposals.current.get(id);
      pendingProposals.current.delete(id);
      if (pendingProposals.current.size === 0) setProposalSource(null);
      send.clearProposal(id);
      // The buffer is clean, so the frame reloads the new disk version and moves its draft base with it; the next Save writes on top of it.
      setSha256(result.file.sha256);
      shaRef.current = result.file.sha256;
      setSource(text);
      sourceRef.current = text;
      send.fileChanged({ draftKey: activeDraft.current, content: text, sha256: result.file.sha256 });
      await agentDocRef.current.saved(result.file.sha256, text);
      await agentDocRef.current.resolve(id, 'applied', result.file.sha256);
      waiting?.({ outcome: 'accepted', acceptedHunks: 1, rejectedHunks: 0, sha256: result.file.sha256 });
    } catch (err) {
      // A thrown write (or RPC) would leave it 'accepting' forever: reject it with the reason, like a refused write.
      const reason = `Could not apply the accepted edit: ${err instanceof Error ? err.message : String(err)}`;
      if (alive.current && activePathRef.current === path) { try { await refuse(reason); } catch { setError(reason); } }
    }
  }, [docEditor.clientId, pluginId, retractProposal, rpcArgs, send]);
  useEffect(() => {
    const current = agentDoc.doc;
    if (!current || !agentDoc.leased || !playgroundReady || current.path !== activePath || loadedPath.current !== activePath || snapshotPath !== activePath) return;
    const seen = handledProposals.current;
    for (const proposal of current.proposals) {
      if (proposal.input?.path !== activePath) continue;
      const before = seen.get(proposal.id);
      if (proposal.status === 'pending') {
        // A stale one is looked at again once the file version moves (the disk poll caught up, a save).
        if (before && before !== 'stale') continue;
        if (proposal.input.expectedSha256 !== shaRef.current) { seen.set(proposal.id, 'stale'); continue; }
        // One review at a time: the rest stay unmarked and are shown once the open review closes (this effect re-runs on that).
        if (pendingProposals.current.size > 0) continue;
        // Content-less bodies (resolved elsewhere, stripped by the server) never reach here: they are not pending.
        seen.set(proposal.id, 'shown');
        sharedReviews.current.add(proposal.id);
        const content = applyProposalText(sourceRef.current, proposal.input);
        pendingProposals.current.set(proposal.id, () => undefined);
        setProposalSource(content);
        showScriptRef.current();
        send.proposeEdit({ proposalId: proposal.id, content, summary: proposal.input.summary, actor: 'Agent' });
      } else if (proposal.status === 'accept-requested') {
        if (before === 'accepting') continue;
        // It was shown as a pending review: the thread's accept settles that review before the edit is applied under the rules above.
        if (before === 'shown') send.clearProposal(proposal.id);
        seen.set(proposal.id, 'accepting');
        void applyAccepted(proposal.id, proposal.input);
      } else if (before === 'shown' || before === 'accepting') {
        // Accepted or rejected elsewhere (the thread), or an accept this window was asked to apply was settled meanwhile: the review is stale.
        seen.set(proposal.id, 'closed');
        retractProposal(proposal.id, proposal.status === 'rejected' ? 'The proposal was rejected from the thread.' : 'The proposal was applied elsewhere.');
      } else if (before !== 'closed') seen.set(proposal.id, 'closed');
    }
    // A shared review the document no longer lists (evicted, or the document was reopened) leaves the frame too. The Studio's own
    // command proposals are not swept: the document may not list them yet (their propose call is in flight).
    for (const [id, state] of seen) {
      if ((state === 'shown' || state === 'accepting') && (sharedReviews.current.has(id) || state === 'accepting') && !current.proposals.some(row => row.id === id)) { seen.set(id, 'closed'); retractProposal(id, 'The proposal is no longer available.'); }
    }
  }, [activePath, agentDoc.doc, agentDoc.leased, applyAccepted, playgroundReady, retractProposal, send, snapshotPath, proposalSource, sha256]);
  // The lease went to another window: its reviews leave this frame. They stay pending on the shared document for the new holder.
  const wasLeased = useRef(false);
  useEffect(() => {
    const was = wasLeased.current;
    wasLeased.current = agentDoc.leased;
    if (!was || agentDoc.leased) return;
    for (const [id, state] of handledProposals.current) {
      if (state !== 'shown' && state !== 'accepting') continue;
      handledProposals.current.delete(id);
      retractProposal(id, 'Another Studio window is editing this agent; the proposal stays open there.');
    }
  }, [agentDoc.leased, retractProposal]);
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
      start: (input: ProposeEditInput, proposalId: string) => {
        // A follower cannot show a review: its editor is read-only and the holder owns the document. Thrown here, the command fails.
        if (heldByRef.current) throw Error('Another Studio window is editing this agent.');
        return new Promise<ProposalOutcome>((resolve, reject) => {
          try {
            const content = input.content ?? applyProposalEdits(sourceRef.current, input.edits ?? []);
            pendingProposals.current.set(proposalId, resolve);
            handledProposals.current.set(proposalId, 'shown');
            setProposalSource(content);
            if (compact) patch({ tool: 'code' });
            showScriptRef.current();
            send.proposeEdit({ proposalId, content, summary: input.summary, actor: 'Agent' });
            void agentDocRef.current.propose(input, { id: proposalId, ...(threadId ? { threadId } : {}) });
          } catch (err) { reject(err); }
        });
      }
    },
    preview: {
      start: async ({ engine, contextVariables, presetId }) => {
        const preset = presetId ? await savedPreset(presetId) : undefined;
        if (engine) setPreviewEngine(engine);
        openTool('preview');
        setPreviewCommand({ seq: ++previewSeq.current, type: 'start', engine, contextVariables, ...(preset ? { preset } : {}) });
        return preset ? { presetId: preset.id, preset: preset.name } : undefined;
      },
      send: ({ text, engine }) => {
        if (engine) setPreviewEngine(engine);
        openTool('preview');
        setPreviewCommand({ seq: ++previewSeq.current, type: 'send', text, engine });
      }
    },
    contextSet: async ({ values, presetId, merge }) => {
      const preset = presetId ? await savedPreset(presetId) : undefined;
      openTool('preview');
      setPreviewCommand({ seq: ++previewSeq.current, type: 'context', ...(preset ? { preset } : { contextVariables: values ?? [] }), ...(merge ? { merge: true } : {}) });
      return preset ? { context: 'preset', presetId: preset.id, preset: preset.name, variables: preset.values.length } : { context: merge ? 'merged' : 'replaced', variables: values?.length ?? 0 };
    },
    traceFocus: () => {
      if (wide) patch({ bottomOpen: true, bottomTab: 'trace' }); else openTool('preview');
    },
    graphFocus: node => { setGraphFocus(current => ({ node, seq: current.seq + 1 })); openTool('graph'); },
    layoutSet: setEditorCompactOverride,
    orgTestsOpen: openOrgTests,
    simulationsOpen: openSimulations
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
    commands: ['state', 'file.open', 'file.filter', 'panel.open', 'panel.close', 'panel.show', 'panel.hide', 'editor.reveal', 'editor.proposeEdit', 'preview.start', 'preview.send', 'trace.focus', 'graph.focus', 'layout.set', 'orgTests.open', 'simulations.open', 'context.set'],
    state: () => ({ path: activePath, dirty, issues, ready: playgroundReady, sha256, panels: hostPanel ? { host: true, tabs: hostSlots.filter(slot => slot.attached).map(slot => slot.tool), kept: hostSlots.filter(slot => !slot.attached).map(slot => slot.tool), active: requestedHostTool.current ?? hostTool, open: (requestedHostTool.current ?? hostTool) !== null } : tools.state, filter: fileQuery, layout, tool: currentTool, agents: studio.agents.map(agent => agent.path), activeAgent: studio.activeAgent, tabs: studio.tabs.map(tab => tab.id), follow: followPaused ? 'paused' : 'on', ...(heldReveal ? { heldReveal: heldReveal.command.command } : {}) }),
    execute: followCommand,
  });

  bridgeHandlers.current = {
    onSnapshot: message => {
      const nextActions = message.actions ?? [];
      // The frame's `issues` counts every diagnostic; the document bar shows problems only.
      setSource(message.content); setIssues(message.diagnostics ? countProblems(message.diagnostics) : message.issues); setActions(nextActions);
      setDiagnostics(message.diagnostics ?? []);
      diagnosticsRef.current = message.diagnostics ?? [];
      const path = loadedPath.current;
      if (path) {
        sourceCache.current[path] = message.content;
        setSnapshotPath(path);
        if (docPath.current === path) agentDocRef.current.update(message.content, message.diagnostics, shaRef.current || undefined);
      }
      setActionTabs(tabs => tabs.filter(tab => tab.action.id.startsWith('dependency:') || nextActions.some(action => action.id === tab.action.id)));
      setSelectedActionId(id => id?.startsWith('dependency:') || nextActions.some(action => action.id === id) ? id : null);
      const inspect = pendingInspect.current;
      if (inspect && inspect.path === path) {
        pendingInspect.current = null;
        const action = nextActions.find(row => row.id === inspect.id);
        if (action) openAction(action);
      }
    },
    onOpenAction: id => {
      const action = actions.find(row => row.id === id);
      if (action) openAction(action);
    },
    onReady: () => {
      setPlaygroundReady(true);
      playgroundReadyRef.current = true;
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
      const last = recalledAgentSelection(selectionScope);
      const tabPath = studio.activeAgent ?? undefined;
      const recalled = last?.startsWith('file:') ? last.slice(5) : null;
      // A request made while the frame loaded wins over the initial and the restored agent; nothing is opened over it.
      const requested = requestedBeforeReady.current || pendingFocus.current?.path;
      requestedBeforeReady.current = null;
      const file = requested || queued || initialPath || (agentTarget ? null : tabPath || recalled);
      // Re-sending the agent already shown (its setFile was lost before ready) keeps the tab picked meanwhile.
      const restore = file !== null && ((file === requested && file === activePathRef.current) || (file === tabPath && !queued && !requested));
      void openFile(file, undefined, restore).then(() => { initialFileOpened.current = true; });
    },
    onDirty: message => {
      if (message.dirty && Date.now() > ownMoveUntil.current) lastEditAt.current = Date.now();
      setDirty(message.dirty);
      if (message.draftKey) {
        // The draft moved to another base (a disk version accepted, a re-baseline): the shared document follows.
        if (message.baseSha && message.baseSha !== shaRef.current && message.draftKey === activeDraft.current && docPath.current === activePathRef.current) agentDocRef.current.update(sourceRef.current, diagnosticsRef.current, message.baseSha);
        setSha256(message.baseSha);
      }
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
      if (loadedPath.current) sourceCache.current[loadedPath.current] = message.content;
      if (message.note && sharedReviews.current.delete(message.proposalId)) {
        // The frame closed a shared review without a decision (superseded, file switched): it stays open on the document and is
        // shown again later. Nothing is resolved on the server.
        handledProposals.current.delete(message.proposalId);
        return;
      }
      sharedReviews.current.delete(message.proposalId);
      void agentDocRef.current.resolve(message.proposalId, message.outcome === 'rejected' ? 'reject' : 'applied', message.sha256);
      resolve?.({
        outcome: message.outcome, acceptedHunks: message.acceptedHunks, rejectedHunks: message.rejectedHunks,
        ...(message.sha256 ? { sha256: message.sha256 } : {}), ...(message.note ? { note: message.note } : {})
      });
    },
    onCommentAction: message => {
      if (message.kind === 'open') { openTool('comments'); return; }
      if (message.kind === 'update' && message.id && message.body) { updateComment(message.id, message.body); return; }
      if (message.kind === 'delete' && message.id) { deleteComment(message.id); return; }
      const body = message.body?.trim();
      const path = activePath;
      if (message.kind !== 'submit' || !body || !path || !projectId) return;
      commentRpc(STUDIO_RPC.commentAdd, { path, line: message.line, endLine: message.endLine, quote: message.quote, body, content: sourceRef.current }, 'Could not add the comment.');
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
  const saveDisabled = saveIsDisabled(saveEnabled, activePath, busy) || Boolean(heldBy);
  const composeFor = (instruction: string, path: string | null = activePath) => {
    const prompt = `${instruction}\nProject: ${projectId}\nSource: ${path}`;
    if (navigate.openPanelAgent?.({
      draft: { prompt, ...(path ? { view: path } : {}), ...(projectId ? { projectId } : {}) },
      title: path ? basename(path) : 'Agent tests'
    })) return;
    navigate.toCompose({ initialPrompt: prompt, focusPrompt: true });
  };
  const quickItems = useMemo<QuickOpenItem[]>(() => [
    ...files.map(file => ({ id: `file:${file.path}`, label: file.apiName || basename(file.path), detail: file.path, kind: 'agent' })),
    ...explorerNodes.flatMap((node, index) => node.kind === 'agent' || node.kind === 'prompt' ? [] : [{ id: `node:${index}`, label: node.apiName, detail: node.path ?? node.usedBy?.[0], kind: node.kind === 'lightning-type' ? 'type' : node.kind === 'lwc' ? 'LWC' : node.kind }])
  ], [files, explorerNodes]);
  const openNode = useCallback((node: ExplorerNode) => {
    if (node.kind === 'agent' && node.path) void openFile(node.path);
    else if (node.kind === 'apex' || node.kind === 'flow') openTarget(node.kind, node.apiName, node.path);
    else if (node.kind === 'lightning-type') { openTab({ id: `type:${node.apiName}`, kind: 'type', label: node.apiName, target: node.apiName, ...(node.path ? { path: node.path } : {}) }); if (compact) patch({ tool: 'code' }); }
    else if (node.kind === 'lwc') { openTab({ id: `lwc:${node.apiName}`, kind: 'lwc', label: node.apiName, target: node.apiName, ...(node.path ? { path: node.path } : {}) }); if (compact) patch({ tool: 'code' }); }
    else if (node.kind === 'scenario') openTool('test');
    else if (node.kind === 'org-agent') browseAgents(node.apiName);
  }, [browseAgents, compact, openFile, openTab, openTarget, openTool, patch]);
  const pickQuick = (item: QuickOpenItem) => {
    setQuickOpen(false);
    if (item.id.startsWith('file:')) void openFile(item.id.slice(5));
    else if (item.id.startsWith('node:')) { const node = explorerNodes[Number(item.id.slice(5))]; if (node) openNode(node); }
  };

  // Studio tabs own the project-wide controls, so the document bar only carries what acts on the open agent.
  const stripOwnsWorkspace = studio.tabs.length > 0;
  const followChip = layout !== 'legacy' && (driver || threadId || followPaused) ? <FollowChip driver={driver ?? (threadId ? 'this thread' : undefined)} paused={followPaused} onToggle={() => setFollowPaused(paused => !paused)} /> : undefined;
  const orgPicker = props.orgPicker !== false && <OrgPicker pluginId={pluginId} projectId={projectId} compact appearance="toolbar" />;
  const askAgentMenu = <AskAgentButton pluginId={pluginId} projectId={projectId} path={activePath} view={view} onShareChange={setShare} />;
  const activeBundle = bundleName(activePath);
  const documentBar = (
      <AgentScriptDocumentBar path={activePath} dirty={dirty} busy={busy} issues={issues}
        saveDisabled={saveDisabled} saveAsDisabled={!saveEnabled || busy || !playgroundReady || !activePath} panelOpen={panelVisible}
        {...(stripOwnsWorkspace ? {} : { headerActions: <>{askAgentMenu}{props.headerActions}</>, follow: followChip })}
        onBrowse={() => browseAgents()} onSave={() => void save()}
        onPreview={() => openTool('preview')}
        onSaveAs={() => { setError(null); setSaveAsOpen(true); }} onShowPanel={showPanel}
        {...(layout === 'legacy' ? {} : {
          shortcutHint: wide, hidePanelToggle: compact || stripOwnsWorkspace || hostPanel,
          ...(stripOwnsWorkspace ? {} : { onQuickOpen: () => setQuickOpen(true) }),
          onCompile: () => void compile(), compiling: compiled?.status === 'running',
          onOpenInBuilder: () => void openInBuilder(), openingBuilder,
          ...(activeBundle ? { onFetch: () => setFetchAgent(activeBundle) } : {})
        })} />
  );
  const workspaceActions = stripOwnsWorkspace ? <>
    {followChip}
    {askAgentMenu}
    {props.headerActions}
    <button type="button" className="icon-btn" title={`Go to file (${modShortcut('P')})`} aria-label="Go to file" onClick={() => setQuickOpen(true)}><Search size={15} aria-hidden="true" /></button>
    {!hostPanel && !panelVisible && !compact && <button type="button" className="icon-btn" title="Show side panel" aria-label="Show side panel" aria-expanded={false} onClick={showPanel}><PanelRight size={15} aria-hidden="true" /></button>}
  </> : undefined;

  const orgAgentsPanel = (visible: boolean) => <OrgAgentsPanel pluginId={pluginId} projectId={projectId} visible={visible} editorReady={playgroundReady} focus={agentsFocus} onFocusHandled={agentsFocusHandled} onNew={() => setNewAgentOpen(true)} localFiles={files.filter(file => !file.path.startsWith('.zcc/'))} onLocalOpen={path => void openFile(path)} onOpen={openRetrieved} />;
  const showTargetTab = activeEditorTab !== null && activeEditorTab.kind !== 'agent';
  const openAgentTab = (path: string) => { if (path === activePath) selectTab(`agent:${path}`); else void openFile(path); };
  // The Org agents tab stays mounted while open, so its search and retrieve status survive opening an agent.
  const orgTabActive = activeEditorTab?.kind === 'org';
  const orgAgentsActive = orgTabActive && activeEditorTab?.target !== 'tests';
  const orgTestsActive = orgTabActive && activeEditorTab?.target === 'tests';
  const orgAgentsView = studio.tabs.some(tab => tab.kind === 'org' && tab.target !== 'tests') ? (
    <div className="sf-etab-view" data-testid="studio-org-agents-view" style={orgAgentsActive ? undefined : { display: 'none' }}>{orgAgentsPanel(orgAgentsActive)}</div>
  ) : false;
  // Like Org agents, the Org tests tab stays mounted while open so a followed run keeps its place.
  const orgTestsView = studio.tabs.some(tab => tab.id === ORG_TESTS_TAB.id) ? (
    <div className="sf-etab-view" data-testid="studio-org-tests-view" style={orgTestsActive ? undefined : { display: 'none' }}>
      <section className="sf-tp is-org-tests" aria-label="Agent tests"><style>{TESTS_PANE_STYLES}</style>
        <OrgTestsView pluginId={pluginId} projectId={projectId} threadId={threadId} path={activePath} visible={orgTestsActive}
          onAskAgent={composeFor} focus={orgTestsFocus} onFocusHandled={orgTestsFocusHandled}
          renderLocalSuite={suite => <LocalSuiteDetail key={`${projectId}:${suite.path}`} suite={suite} Cases={TestsPane}
            editor={{ pluginId, projectId, threadId, path: activePath, source, dirty, proposalSource, visible: orgTestsActive, roleplay: null, onAskAgent: composeFor,
              onShowPath: caseId => { setGraphFocus(current => ({ node: null, seq: current.seq + 1, caseId })); openTool('graph'); } }} />} />
      </section>
    </div>
  ) : false;
  const targetTabView = showTargetTab && activeEditorTab && !orgTabActive && activeEditorTab.kind !== 'view' ? (
    <div className="sf-etab-view" data-testid="studio-target-view">
      {activeEditorTab.kind === 'type'
        ? <LightningTypeView key={`${projectId}:${activeEditorTab.id}`} pluginId={pluginId} projectId={projectId} typeRef={activeEditorTab.target ?? activeEditorTab.label}
          usedBy={explorerNodes.find(node => node.kind === 'lightning-type' && node.apiName === (activeEditorTab.target ?? activeEditorTab.label))?.usedBy}
          onOpenAgent={path => void openFile(path)}
          onOpenComponent={ref => openNode(explorerNodes.find(node => node.kind === 'lwc' && node.apiName === ref) ?? { kind: 'lwc', apiName: ref })} />
        : activeEditorTab.kind === 'lwc'
        ? (() => {
          const ref = activeEditorTab.target ?? activeEditorTab.label;
          const node = explorerNodes.find(row => row.kind === 'lwc' && row.apiName === ref);
          return <LwcBundleView key={`${projectId}:${activeEditorTab.id}`} pluginId={pluginId} projectId={projectId} componentRef={ref}
            usedBy={node?.usedBy} via={node?.via} onOpenAgent={path => void openFile(path)}
            onOpenType={type => openNode(explorerNodes.find(row => row.kind === 'lightning-type' && row.apiName === type) ?? { kind: 'lightning-type', apiName: type })} />;
        })()
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
  // An agent's Script tab goes with the agent (close the agent tab), so "close others / all" never takes it.
  const closeEditorTabs = (ids: string[], focus?: string) => closeTabs(ids.filter(id => studio.tabs.find(tab => tab.id === id)?.kind !== 'agent'), focus);
  const tabs = (
    <EditorTabs tabs={studio.tabs} active={studio.activeTab} dirtyId={dirty && activePath ? scriptTabId(activePath) : null} problems={problemsCount}
      problemsId={activePath ? scriptTabId(activePath) : null} trailing={workspaceActions} onSelect={selectTab} onClose={closeTab} onCloseMany={closeEditorTabs} />
  );
  const dirtyPaths = useMemo(() => new Set(studio.agents.filter(agent => agent.path === activePath ? dirty : Boolean(readAgentDraft(agentDraftKey(draftScope, `file:${agent.path}`)))).map(agent => agent.path)), [activePath, dirty, draftScope, studio.agents]);
  const runningPaths = useMemo(() => new Set(Object.keys(runs).filter(path => runs[path] && studio.agents.some(agent => agent.path === path))), [runs, studio.agents]);
  const closeAgentTab = (path: string) => {
    closeAgent(path);
    delete sourceCache.current[path];
    runChangers.current.delete(path);
    setRuns(current => { if (!(path in current)) return current; const { [path]: _gone, ...rest } = current; return rest; });
  };
  const agentTabs = <AgentTabs agents={studio.agents} active={studio.activeAgent} dirtyPaths={dirtyPaths} runningPaths={runningPaths} projectId={projectId ?? ''}
    orgPill={orgPicker || undefined} onSelect={selectAgent} onClose={closeAgentTab} onOpenAgent={() => setQuickOpen(true)} onOpenView={openView} />;

  const bottomActive: BottomTab = compact ? 'problems' : studio.bottomTab;
  const bottom = layout !== 'legacy' && (wide || compactTool === 'code') ? (
    <BottomPanel open={studio.bottomOpen} active={bottomActive} problems={problemsCount} compact={compact}
      testFailures={suites.reduce((count, suite) => count + suite.cases.filter(scenario => suite.lastResults?.[scenario.id]?.outcome === 'fail').length, 0)}
      onToggle={() => patch({ bottomOpen: !studio.bottomOpen })} onSelect={tab => patch({ bottomTab: tab, bottomOpen: true })}
      render={(tab, visible) => {
        if (tab === 'problems') return <ProblemsPanel path={activePath} diagnostics={problems} compact={compact} busy={fixBusy}
          compile={compiled} stale={Boolean(compiled && (dirty || compiled.sha !== (sha256 || undefined)))}
          onReveal={line => revealLine(line)} onFixWithAgent={() => void fixWithAgent()} />;
        if (tab === 'trace') return <BottomTrace pluginId={pluginId} path={activePath} run={lastRun} visible={visible} onOpenPreview={() => openTool('preview')}
          onRevealSource={(path, line) => { if (path === activePathRef.current) revealLine(line); else void openFile(path).then(opened => { if (opened) revealLine(line); }); }} />;
        if (tab === 'output') return visible ? <OperationsPanel pluginId={pluginId} projectId={projectId} orgAlias={org?.alias} threadId={threadId} /> : null;
        return <BottomTests key={`${projectId}:${activePath}`} suites={suites}
          context={{ pluginId, projectId, threadId, path: activePath, source, dirty }} onOpenTests={() => openTool('test')} />;
      }} />
  ) : false;

  const toggleSection = useCallback((id: string) => patch({
    collapsedSections: studio.collapsedSections.includes(id) ? studio.collapsedSections.filter(row => row !== id) : [...studio.collapsedSections, id]
  }), [patch, studio.collapsedSections]);
  const badgedNodes = useMemo(() => withSuiteBadges(explorerNodes, suites), [explorerNodes, suites]);
  const coverageFor = useMemo(() => {
    const byPath = new Map<string, ReturnType<typeof graphCoverage> | null>();
    for (const agent of studio.agents) {
      const suitePath = agentSuitePath(agent.path);
      const own = suites.filter(suite => suite.path === suitePath);
      byPath.set(agent.path, own.length ? graphCoverage(own) : null);
    }
    return (path: string) => byPath.get(path) ?? null;
  }, [studio.agents, suites]);
  const explorerNode = (
    <Explorer files={files} nodes={badgedNodes} activePath={activePath} dirtyPath={dirty ? activePath : null}
      query={fileQuery} onQuery={setFileQuery} onOpenFile={path => void openFile(path)}
      onOpenNode={openNode} onIndexAgent={indexAgent} indexing={indexingAgents} onBrowseOrg={() => browseAgents()} orgLabel={org?.alias} orgAgentsMore={orgAgentsMore} orgAgentsNotLocal={orgAgentsNotLocal}
      collapsed={studio.collapsedSections} onToggleSection={toggleSection} onHide={wide ? () => patch({ explorerOpen: false }) : undefined} />
  );

  // One mounted pane per open view tab of every agent shown this session; only the agent and tab in front are visible.
  const revealIn = (path: string, line: number) => { if (path === activePathRef.current) revealLine(line); else void openFile(path).then(opened => { if (opened) revealLine(line); }); };
  const viewPanes = studio.agents.flatMap(agent => {
    const open = studio.workspaces[agent.path]?.tabs.filter(tab => tab.kind === 'view') ?? [];
    const live = agent.path === activePath;
    const cached = sourceCache.current[agent.path];
    if (!live && cached === undefined) return []; // never loaded this session: nothing to show yet
    const paneSource = cached ?? source;
    const label = basename(agent.path);
    return open.map(tab => {
      const target = tab.target as ViewTarget;
      const shown = agent.path === studio.activeAgent && studio.activeTab === tab.id;
      const key = `${agent.path}\n${target}`;
      const body = target === 'graph'
        ? <AgentScriptGraphPanel source={paneSource} visible={shown} compact={compact} focusNode={live ? graphFocus.node : null} focusSeq={live ? graphFocus.seq : 0} focusCase={live ? graphFocus.caseId : undefined}
          coverage={coverageFor(agent.path)} onDraftCases={labels => composeFor(draftCasesPrompt(labels, agentSuitePath(agent.path) ?? 'the scenario suite'), agent.path)}
          onOpenAction={id => inspectAction(agent.path, id)} />
        : target === 'preview'
        ? <>
          {previewRun?.path === agent.path && <PreviewRunReplay key={`${previewRun.runId}:${previewRun.turn ?? ''}:${previewRun.seq}`} pluginId={pluginId} projectId={projectId} runId={previewRun.runId} turn={previewRun.turn}
            onRevealSource={revealIn} onClose={() => setPreviewRun(null)} />}
          {/* Stays mounted behind a replay: a live session is not ended by looking at an old run. */}
          <div style={{ display: previewRun?.path === agent.path ? 'none' : 'contents' }}>
            <PreviewWorkbench pluginId={pluginId} projectId={projectId} source={paneSource} fileLabel={label}
              engine={previewEngine} onEngineChange={setPreviewEngine} path={agent.path} orgAlias={org?.alias} threadId={threadId}
              onRunChange={runChangeFor(agent.path)} command={live ? previewCommand : null} onCommandHandled={previewCommandHandled} dirty={live && dirty}
              onRevealSource={revealIn} />
          </div>
        </>
        : target === 'tests'
        ? <TestsPane pluginId={pluginId} projectId={projectId} threadId={threadId} path={agent.path} source={paneSource} visible={shown} dirty={live && dirty}
          proposalSource={live ? proposalSource : null} onAskAgent={prompt => composeFor(prompt, agent.path)} simulationsFocus={live ? simulationsFocus : null} onSimulationsFocusHandled={simulationsFocusHandled}
          onShowPath={caseId => { setGraphFocus(current => ({ node: null, seq: current.seq + 1, caseId })); openTool('graph'); }}
          roleplay={<AgentforceLabPanel pluginId={pluginId} projectId={projectId} threadId={threadId} orgAlias={org?.alias} source={paneSource} mode="test" fileLabel={label} agentPath={agent.path} />} />
        : <AgentforcePreviewPanel pluginId={pluginId} projectId={projectId} threadId={threadId} />;
      return <div key={key} className="sf-etab-view" data-testid={`studio-view-${target}`} data-agent={agent.path} style={shown ? undefined : { display: 'none' }}>{body}</div>;
    });
  });
  const top = compact ? (
    <>
      <ToolStrip orientation="horizontal" label="Studio tools" iconsOnly={tier === 0} active={hostPanel ? currentTool : compactTool}
        items={COMPACT_TOOLS.map(id => stripItem(id, id === 'code' ? problemsCount : undefined))} onSelect={id => {
          if (id !== 'code' && VIEW_FOR_TOOL[id as AgentScriptTool]) openTool(id as AgentScriptTool); // a view opens as a tab of the editor
          else if (hostPanel) { if (id !== 'code') openTool(id as AgentScriptTool); } else patch({ tool: id as CompactTool });
        }} />
    </>
  ) : false;
  const activity = wide ? (
    <ToolStrip orientation="vertical" label="Studio activity" active={studio.explorerOpen ? 'files' : null}
      items={[stripItem('files'), { id: 'org-tests', title: 'Tests', icon: <FlaskConical size={16} aria-hidden="true" /> }, { id: 'search', title: 'Go to file', icon: <Search size={16} aria-hidden="true" /> }]}
      onSelect={id => { if (id === 'files') patch({ explorerOpen: !studio.explorerOpen }); else if (id === 'org-tests') openOrgTests(); else setQuickOpen(true); }} />
  ) : false;

  const splitMode = hostPanel ? 'editor' : swapCompact ? (compactTool === 'code' ? 'editor' : 'panel') : 'split';
  const splitOpen = hostPanel ? false : swapCompact ? compactTool !== 'code' : tools.state.open;

  const renderTool = (id: AgentScriptTool, visible: boolean): ReactNode => {
    if (id === 'agents') return orgAgentsPanel(visible);
    if (id === 'files') return layout === 'legacy' ? explorerNode : null;
    if (id === 'comments') return <CommentsPane pluginId={pluginId} projectId={projectId} path={activePath} comments={comments}
      onReveal={revealLine}
      onResolve={(commentId, note) => { void Promise.resolve(callPluginRpc(pluginId, STUDIO_RPC.commentResolve, { projectId, id: commentId, note })).then(() => loadComments()).catch(err => { if (alive.current) setError(err instanceof Error ? err.message : String(err)); }); }}
      onEdit={updateComment}
      onDelete={deleteComment}
      onAddressWithAgent={() => { void askAgent('address-comments').catch(err => { if (alive.current) setError(err instanceof Error ? err.message : String(err)); }); }} />;
    if (id !== 'actions') return null; // Graph, Preview, Tests and Org preview are editor view tabs
    return <div className="af-action-workspace">
      {actionTabs.length > 0 && <div className="af-related-tabs" aria-label="Open agent files">
        <div className={`af-related-tab${!selectedActionId ? ' is-active' : ''}`}><button aria-pressed={!selectedActionId} onClick={() => setSelectedActionId(null)}>All actions</button></div>
        {actionTabs.map(tab => <div className={`af-related-tab${selectedActionId === tab.action.id ? ' is-active' : ''}`} key={tab.action.id}><button title={`${tab.action.owner} · ${tab.action.target}`} aria-pressed={selectedActionId === tab.action.id} onClick={() => setSelectedActionId(tab.action.id)}>{tab.action.name}</button><button aria-label={`Close ${tab.action.name}`} onClick={() => { setActionTabs(tabs => tabs.filter(t => t.action.id !== tab.action.id)); if (selectedActionId === tab.action.id) setSelectedActionId(null); }}>×</button></div>)}
      </div>}
      {!selectedAction && <div className="af-actions-list"><h2>Actions</h2><p>Explore implementations and references in the current script.</p><AgentActionExplorer actions={actions} selected={selectedActionId ?? undefined} onOpen={openAction} />{actions.length === 0 && <EmptyState compact art="code" title="No actions in this script yet.">Add an Apex or Flow action to explore its implementation here.</EmptyState>}</div>}
      {selectedAction && <AgentActionPanel key={`${projectId}:${activePath}:${selectedAction.id}`} pluginId={pluginId} projectId={projectId} org={org} action={selectedAction} initialOrigin={selectedTab?.origin} onOriginChange={origin => { chooseActionOrigin(origin); setActionTabs(tabs => tabs.map(tab => tab.action.id === selectedActionId ? { ...tab, origin } : tab)); }} onReveal={revealLine} onOpenTarget={(target, origin) => openAction(targetAction(target, `Referenced by ${selectedAction.name}`), origin)} />}
    </div>;
  };

  // Cards and buttons elsewhere (chat, guardrail rows, the Assistant rail) ask this Studio to show something.
  const handleIntent = (intent: StudioIntent): boolean => {
    if (!playgroundReady) return false;
    const show = () => {
      if (intent.kind === 'preview') {
        const path = activePathRef.current;
        if (intent.runId && path) setPreviewRun(current => ({ path, runId: intent.runId!, ...(intent.turn !== undefined ? { turn: intent.turn } : {}), seq: (current?.seq ?? 0) + 1 }));
        openTool('preview');
      } else if (intent.kind === 'tests') {
        if (intent.sub === 'org') openOrgTests({ ...(intent.name ? { name: intent.name } : {}), ...(intent.runId ? { runId: intent.runId } : {}) });
        else if (intent.sub === 'simulations') openSimulations({ ...(intent.batchId ? { batchId: intent.batchId } : {}) });
        else openTool('test'); // 'local' is the Tests view's first sub-view; TestsPane has no prop to choose 'local'/'rehearse' (it keeps its own sub-view)
      } else if (intent.kind === 'graph') {
        if (intent.node) setGraphFocus(current => ({ node: intent.node ?? null, seq: current.seq + 1 }));
        openTool('graph');
      } else if (intent.kind === 'org-preview') openTool('org-preview');
      else if (intent.kind === 'actions' || intent.kind === 'comments') openTool(intent.kind);
    };
    if (intent.kind === 'agent') {
      void openFile(intent.path).then(opened => { if (opened && intent.line) revealLine(intent.line); });
      return true;
    }
    if (intent.path && intent.path !== activePathRef.current) {
      void openFile(intent.path).then(opened => { if (opened) show(); });
      return true;
    }
    show();
    return true;
  };
  const intentHandler = useRef(handleIntent);
  intentHandler.current = handleIntent;
  useEffect(() => {
    if (!projectId || !rootEl) return;
    return registerStudioIntentTarget({ projectId, root: rootEl, handle: intent => intentHandler.current(intent) });
  }, [projectId, rootEl]);

  return (
    <div className="sf-as" ref={rootRef} style={PANEL_ROOT} data-testid="salesforce-agent-script-panel">
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
      <StudioShell layout={layout} tier={tier} top={top} activity={activity} explorer={wide && studio.explorerOpen ? explorerNode : false}
        explorerWidth={studio.explorerWidth} onExplorerWidth={width => patch({ explorerWidth: width })}
        quickOpen={quickOpen} quickItems={quickItems} onQuickOpenChange={setQuickOpen} onQuickPick={pickQuick} onSave={save}
        onToggleExplorer={wide ? () => patch({ explorerOpen: !studio.explorerOpen }) : undefined}>
        <div className="sf-main-col">
        <AgentforceStudioSplit open={splitOpen} mode={splitMode} storageKey={`salesforce:studio:split:${draftScope}`} editor={<div className="af-action-workspace">
          {agentTabs}
          {tabs}
          {!showTargetTab && documentBar}
          {!showTargetTab && heldBy && <div className="sf-held-banner" role="status" data-testid="salesforce-agent-held-banner">
            <span>Read-only: {heldBy.label} is editing this agent.</span>
            <button type="button" className="sf-as-save" onClick={() => void agentDoc.takeOver()}>Take over</button>
          </div>}
          {orgSessionLabel(org) ? <span hidden className="sf-as-crumb-seg" data-testid="salesforce-playground-org">{orgSessionLabel(org)}</span> : null}
          {heldReveal && <FollowToast held={heldReveal} onShow={showHeldReveal} onDismiss={() => setHeldReveal(null)} />}
          {targetTabView}
          {orgAgentsView}
          {orgTestsView}
          {viewPanes}
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
  tabId?: string;
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
      tabId={props.tabId}
      onActivePath={props.onActivePath}
    />
  );
}
