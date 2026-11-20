import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { OWN_FIND_ATTRIBUTE } from '../../../../apps/app/src/lib/thread-find.js';
import { panelFindKey } from './panel-find.js';
import { useZccContext, useZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
import { PopoverPicklist, type PopoverPicklistOption } from '@zana-ai/zcc-ui/popover-picklist';
import {
  ArrowLeft,
  Bot,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleDot,
  DraftingCompass,
  FolderOpen,
  House,
  Layers,
  List,
  MoreHorizontal,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Download,
  Copy,
  Trash2,
  X
} from 'lucide-react';
import { STATUS_LABELS, DOC_STATUSES, type DesignDocSummary, type DocStatus } from '../shared/contract.js';
import { MAX_AGENT_PROMPT_LENGTH } from '../shared/agent-actions.js';
import { MAX_LIST_LIMIT, MAX_SUMMARY_LENGTH, MAX_TITLE_LENGTH } from '../shared/limits.js';
import { draftDocAgent, showDocAgent } from './Agents.js';
import { defaultAgentProject, errorMessage, toast, useApi, type DocSyncState, type ProjectInfo, type TemplateInfo, type UnassignedProject } from './api.js';
import { effectiveSyncState, needsAttention, SYNC_STATE_LABEL, useDocSyncStatuses } from './sync-status.js';
import type { DocLocation } from './content.js';
import { RenameStaleNotice, useDocActions, useTitleRename, type RenameStale } from './DocActions.js';
import { ProjectMark } from './ProjectMark.js';
import { anyOpen, buildSections, collapseAll, collapseAllHint, expandAll, groupHint, parseCollapsed, pruneCollapsed, toggleCollapsed, type ListSection } from './doc-sections.js';
import { DocView } from './DocView.js';
import { PinnableContext } from './pin.js';
import { useDocs, useNow, usePersistentState, useProjects, useRemovedProjects, useTemplates, useUnassignedDocs, useUnassignedProjects } from './hooks.js';
import { UNASSIGNED_LABEL, UnassignedProjectsDialog } from './UnassignedProjects.js';
import { buildUnassignedGroups, OTHER_KEY, type LabelSource, type UnassignedGroup } from './unassigned-groups.js';
import { SyncButton, usePeerSync, type PeerSync } from './PeerSettings.js';
import { SettingsToggle, SettingsView } from './Settings.js';
import { markSeen, parseSeen, unseenAgentEdit } from './seen.js';
import { ContextMenu, contextMenuPoint, Dialog, IconButton, MenuItem, Popover, Spinner, StatusPill, TimeAgo } from './ui.js';
import { saveBytes } from './download.js';

type StatusFilter = DocStatus | 'active' | 'all';
const GLOBAL_ONLY = '__global__';

const BRIEF_LIMIT = MAX_AGENT_PROMPT_LENGTH - 600;

const STATUS_OPTIONS: PopoverPicklistOption<StatusFilter>[] = [
  { value: 'active', label: 'Active', description: 'Everything except archived' },
  ...DOC_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] })),
  { value: 'all', label: 'All statuses' }
];

export function importSummary(imported: number, skipped: number): string {
  const noun = (n: number) => `${n} template${n === 1 ? '' : 's'}`;
  if (imported === 0 && skipped === 0) return 'No templates found in that file.';
  if (imported === 0) return `Nothing imported: ${skipped === 1 ? 'that template is' : `all ${noun(skipped)} are`} already here.`;
  return `Imported ${noun(imported)}${skipped ? `; skipped ${skipped} already here` : ''}.`;
}

function countedOption(value: string, label: string, count: number): PopoverPicklistOption<string> {
  return {
    value,
    label,
    content: (
      <span className="dd-pick-row">
        <span className="dd-pick-label">{label}</span>
        <span className="dd-pick-count">{count}</span>
      </span>
    )
  };
}

/** Project choices: only those with docs in the list, with counts, plus the current pick. */
export function projectOptions(docs: DesignDocSummary[], projects: ProjectInfo[], selected: string): PopoverPicklistOption<string>[] {
  const counts = new Map<string | null, number>();
  for (const doc of docs) counts.set(doc.projectId, (counts.get(doc.projectId) ?? 0) + 1);
  const options = [countedOption('', 'All projects', docs.length)];
  if (counts.has(null) || selected === GLOBAL_ONLY) options.push(countedOption(GLOBAL_ONLY, 'Global docs', counts.get(null) ?? 0));
  for (const project of projects) {
    if (counts.has(project.id) || selected === project.id) options.push(countedOption(project.id, project.name, counts.get(project.id) ?? 0));
  }
  return options;
}

export function draftingPrompt(brief: string): string {
  return [
    'Draft this design doc from the brief below. Fill in every section of its template with concrete, specific content grounded in this project, add diagrams where they help, and mark open questions and assumptions explicitly. Keep it concise.',
    'Brief:',
    brief.trim()
  ].join('\n\n');
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** The row's tooltip: the full title, then the summary the row no longer shows. */
function rowTooltip(doc: DesignDocSummary): string {
  return doc.summary ? `${doc.title}\n${doc.summary}` : doc.title;
}

/**
 * The row's inline rename: the title becomes an input in place and the doc is not opened. Enter saves, Esc
 * cancels, blur saves a changed non-empty title; an empty Enter shows an alert and stays. The draft lives in
 * the list (not here) so a refresh that re-sorts or remounts the row keeps what was typed.
 */
function RowRename({
  doc,
  draft,
  stale,
  onDraft,
  onCommit,
  onCancel,
  onKeepMine,
  onUseTheirs
}: {
  doc: DesignDocSummary;
  draft: string;
  stale: RenameStale | null;
  onDraft(next: string): void;
  onCommit(): Promise<void>;
  onCancel(): void;
  onKeepMine(): void;
  onUseTheirs(): void;
}) {
  const [error, setError] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const errorId = useId();
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (save: boolean, viaBlur = false) => {
    if (done.current || (stale && viaBlur)) return;
    const next = draft.trim();
    if (!save || next === doc.title.trim() || (!next && viaBlur)) {
      done.current = true;
      onCancel();
      return;
    }
    if (!next) {
      setError(true);
      return;
    }
    done.current = true;
    void onCommit().finally(() => {
      done.current = false;
    });
  };
  return (
    <div
      className={`dd-doc-row dd-doc-row-editing${stale ? ' dd-doc-row-stale' : ''}`}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <input
        ref={input}
        className="dd-editable-input dd-doc-row-input"
        value={draft}
        maxLength={MAX_TITLE_LENGTH}
        aria-label={`Rename ${doc.title}`}
        aria-invalid={error || undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          onDraft(event.target.value);
          setError(false);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            finish(false);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            finish(true);
          }
        }}
        onBlur={() => finish(true, true)}
      />
      {error ? (
        <span id={errorId} className="dd-field-error" role="alert">
          Title can’t be empty
        </span>
      ) : null}
      {stale ? <RenameStaleNotice stale={stale} onKeepMine={onKeepMine} onUseTheirs={onUseTheirs} /> : null}
    </div>
  );
}

function DocRow({
  doc,
  active,
  alternative = false,
  projectName,
  unseen,
  syncState,
  now,
  menuOpen,
  rename,
  onSelect,
  onMenu
}: {
  doc: DesignDocSummary;
  active: boolean;
  /** Nested under the doc it is an alternative to. */
  alternative?: boolean;
  projectName: string | null;
  /** An agent edited it since the user last opened it. */
  unseen: boolean;
  /** Only passed for states worth a mark. */
  syncState?: DocSyncState;
  now: number;
  menuOpen: boolean;
  /** Set while this row is being renamed in place. */
  rename?: ReactNode;
  onSelect(): void;
  onMenu(at: { x: number; y: number }): void;
}) {
  const excerpt = doc.lastComment;
  // The excerpt already says there is a comment; the count adds only "more than one".
  const comments = doc.openComments > (excerpt ? 1 : 0);
  if (rename) return <>{rename}</>;
  return (
    <button
      type="button"
      data-doc-id={doc.id}
      className={`dd-doc-row${active ? ' on' : ''}${alternative ? ' dd-doc-row-alt' : ''}${menuOpen ? ' dd-doc-row-menu' : ''}`}
      title={rowTooltip(doc)}
      onClick={onSelect}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(contextMenuPoint(event));
      }}
      aria-current={active ? 'page' : undefined}
      aria-haspopup="menu"
    >
      <span className="dd-doc-row-top">
        <span className="dd-doc-row-title">{doc.title}</span>
        {syncState ? (
          <span className={`dd-sync-dot dd-sync-${syncState}`} role="img" title={SYNC_STATE_LABEL[syncState]} aria-label={SYNC_STATE_LABEL[syncState]} />
        ) : null}
        {alternative ? (
          <span className="dd-doc-row-badge" title="An alternative to the doc above">
            Alt
          </span>
        ) : null}
        {/* Draft is the default state: only a status worth noticing gets a pill. */}
        {doc.status !== 'draft' ? <StatusPill status={doc.status} compact /> : null}
        <TimeAgo at={doc.updatedAt} now={now} />
      </span>
      {excerpt ? (
        <span className="dd-doc-row-excerpt">
          <MessageSquare size={11} aria-hidden />
          <span className="dd-doc-row-excerpt-body">{excerpt.body.replace(/\s+/g, ' ').trim()}</span>
          <span className="dd-doc-row-excerpt-author">{excerpt.author.label}</span>
        </span>
      ) : null}
      {projectName !== null || comments || unseen ? (
        <span className="dd-doc-row-meta">
          {projectName !== null ? (
            <span className="dd-doc-row-project" title={projectName}>
              <ProjectMark projectId={doc.projectId}>
                <span className="dd-doc-row-project-name">{projectName}</span>
              </ProjectMark>
            </span>
          ) : null}
          {comments ? (
            <span title={`${doc.openComments} open comments`} className="dd-doc-row-comments">
              <MessageSquare size={11} aria-hidden /> {doc.openComments}
            </span>
          ) : null}
          {unseen ? (
            <span className="dd-doc-row-unseen" title="Edited by an agent since you last opened it">
              <Bot size={11} aria-hidden /> New edits
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

/** A peer-supplied name shortened for a chip; the full text stays in the tooltip. */
function shorten(text: string, max = 24): string {
  const points = Array.from(text);
  return points.length > max ? `${points.slice(0, max - 1).join('')}…` : text;
}
const basisText = (basis: 'tag' | 'name' | null) => (basis === 'tag' ? 'matched by tag' : 'matched by name');
const countText = (n: number, capped: boolean) => (capped ? `${n}+` : String(n));
const docsText = (n: number, capped: boolean) => `${countText(n, capped)} ${n === 1 && !capped ? 'doc' : 'docs'}`;

function groupAriaLabel(group: UnassignedGroup): string {
  const count = docsText(group.docs.length, group.capped);
  if (group.foreignProjectId === null) return `${group.label}, ${count}`;
  if (group.pending) return `Loading project name, from another computer, ${count}`;
  return `${group.label}${group.suggestedName ? `, suggested: ${group.suggestedName}` : ''}, from another computer, ${count}`;
}

const UNASSIGNED_SECTION: ListSection = { key: 'unassigned', kind: 'project', label: UNASSIGNED_LABEL, entries: [], count: 0 };
const SECTION_ICONS = { pinned: Pin, 'needs-me': MessageSquare } as const;

function SectionHead({ section, open, onToggle, count, buttonRef }: { section: ListSection; open: boolean; onToggle(): void; count?: string; buttonRef?: Ref<HTMLButtonElement> }) {
  const Glyph = section.kind === 'pinned' || section.kind === 'needs-me' ? SECTION_ICONS[section.kind] : null;
  return (
    <button ref={buttonRef} type="button" className={`dd-list-section dd-list-section-${section.kind}`} aria-expanded={open} onClick={onToggle}>
      <ChevronDown size={12} aria-hidden className="dd-list-section-caret" />
      {Glyph ? <Glyph size={11} aria-hidden /> : null}
      {section.kind === 'project' ? (
        <ProjectMark projectId={section.projectId ?? null}>
          <span className="dd-list-section-label" title={section.label}>
            {section.label}
          </span>
        </ProjectMark>
      ) : (
        <span className="dd-list-section-label" title={section.label}>
          {section.label}
        </span>
      )}
      {section.current ? (
        <span className="dd-list-section-here" title="The project you are in">
          Here
        </span>
      ) : null}
      <span className="dd-list-section-count">{count ?? section.count}</span>
    </button>
  );
}

function DocList({
  projectId,
  showProjects,
  projects,
  activeId,
  onSelect,
  onDeleted,
  onNew,
  onCollapse,
  peerSync,
  onOpenSettings,
  onHome,
  headerActions
}: {
  projectId: string | null;
  showProjects: boolean;
  projects: ProjectInfo[];
  activeId: string | null;
  onSelect(docId: string): void;
  onDeleted(docId: string): void;
  onNew(): void;
  onCollapse(): void;
  peerSync: PeerSync;
  onOpenSettings(): void;
  onHome(): void;
  headerActions?: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = usePersistentState<StatusFilter>('list-status', 'active');
  const [projectFilter, setProjectFilter] = usePersistentState<string>('list-project', '');
  const [grouped, setGrouped] = usePersistentState<boolean>('list-grouped', true);
  const [collapsedRaw, setCollapsedRaw] = usePersistentState<string>('list-collapsed', '[]');
  const [seenRaw, setSeenRaw] = usePersistentState<string>('list-seen', '');
  const [menu, setMenu] = useState<{ doc: DesignDocSummary; at: { x: number; y: number } } | null>(null);
  const context = useZccContext();
  const docActions = useDocActions(projects);
  const titleRename = useTitleRename();
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  // Closing the inline editor unmounts the focused input; hand focus back to that doc's row so keyboard users keep their place.
  const refocusId = useRef<string | null>(null);
  const endRename = (id: string) => {
    refocusId.current = id;
    setRenaming(null);
  };
  useEffect(() => {
    if (renaming || !refocusId.current) return;
    const id = refocusId.current;
    refocusId.current = null;
    Array.from(document.querySelectorAll<HTMLElement>('[data-doc-id]')).find((el) => el.dataset.docId === id)?.focus();
  }, [renaming]);
  const debounced = useDebounced(query.trim(), 200);
  const now = useNow();
  const docs = useDocs({ ...(projectId ? { projectId } : showProjects ? { excludeUnassigned: true } : {}), ...(debounced ? { query: debounced } : {}), status });
  const removed = useRemovedProjects();
  const names = useMemo(() => {
    const map = new Map((removed.data ?? []).map((item) => [item.id, item.label]));
    for (const project of projects) map.set(project.id, project.name);
    return map;
  }, [projects, removed.data]);
  const inUnassignedScope = showProjects && !projectFilter;
  const unassignedDocs = useUnassignedDocs(inUnassignedScope, { ...(debounced ? { query: debounced } : {}), status });
  const unassignedProjects = useUnassignedProjects(showProjects);
  const [mapping, setMapping] = useState(false);
  // One total over every project and status, so the count matches the other computer's (R10). A failed read hides it.
  const api = useApi();
  const [totals, setTotals] = useState<{ total: number; unmapped: number } | null>(null);
  useEffect(() => {
    let live = true;
    api.docCounts().then((value) => { if (live) setTotals(value); }, () => { if (live) setTotals(null); });
    return () => { live = false; };
  }, [api, docs.data]);
  // Keep the previous list while a new query loads, so the section does not flash empty.
  const lastUnassigned = useRef<DesignDocSummary[]>([]);
  if (unassignedDocs.data) lastUnassigned.current = unassignedDocs.data;
  const unassignedList = useMemo(
    () => (inUnassignedScope ? unassignedDocs.data ?? (unassignedDocs.loading ? lastUnassigned.current : []) : []),
    [inUnassignedScope, unassignedDocs.data, unassignedDocs.loading]
  );
  // Label metadata is held until both lists have settled, so a mapped group never flickers to its first-title label.
  const heldProjects = useRef<UnassignedProject[] | null>(null);
  const listsSettled = !unassignedProjects.loading && !unassignedDocs.loading;
  if (listsSettled && unassignedProjects.data) heldProjects.current = unassignedProjects.data;
  const labelProjects = listsSettled ? unassignedProjects.data : heldProjects.current ?? unassignedProjects.data;
  const labelSource: LabelSource = labelProjects ? 'ready' : unassignedProjects.error ? 'failed' : unassignedProjects.loading ? 'loading' : 'ready';
  const localNames = useMemo(() => projects.map((project) => project.name), [projects]);
  const groups = useMemo(
    () => buildUnassignedGroups(unassignedList, labelProjects ?? [], localNames, { cap: MAX_LIST_LIMIT, labels: labelSource }),
    [unassignedList, labelProjects, localNames, labelSource]
  );
  const [otherOpen, setOtherOpen] = useState(false); // "Other" stays closed until explicitly opened; session only
  const unassignedCapped = unassignedList.length >= MAX_LIST_LIMIT;
  const toggleRefs = useRef(new Map<string, HTMLButtonElement>());
  const mapRefs = useRef(new Map<string, HTMLButtonElement>());
  const unassignedHead = useRef<HTMLButtonElement | null>(null);
  const listScroll = useRef<HTMLDivElement | null>(null);
  const [mappingFocus, setMappingFocus] = useState<string | null>(null);
  const [restore, setRestore] = useState<{ key: string; order: string[] } | null>(null);
  const unassignedOpen = !(debounced ? new Set<string>() : parseCollapsed(collapsedRaw)).has('unassigned');
  const visible = useMemo(() => {
    const all = docs.data ?? [];
    if (!showProjects || !projectFilter) return all;
    return all.filter((doc) => (projectFilter === GLOBAL_ONLY ? doc.projectId === null : doc.projectId === projectFilter));
  }, [docs.data, showProjects, projectFilter]);
  const filtered = status !== 'active' || (showProjects && !!projectFilter);
  const byProject = showProjects && !projectFilter && grouped;
  const currentProjectId = showProjects ? context.projectId : null;
  const sections = useMemo(
    () => buildSections(visible, { byProject, currentProjectId, projectName: (id) => names.get(id) ?? 'Unknown project' }),
    [visible, byProject, currentProjectId, names]
  );
  const seen = useMemo(() => parseSeen(seenRaw, Date.now()), [seenRaw]);
  // Start tracking now, so docs edited before today are not all marked new.
  useEffect(() => {
    if (!seenRaw) setSeenRaw(JSON.stringify(seen));
  }, [seenRaw, seen, setSeenRaw]);
  // An unassigned (peer) doc is listed separately from `docs`, so look it up there too.
  const activeUpdatedAt = (docs.data?.find((doc) => doc.id === activeId) ?? unassignedDocs.data?.find((doc) => doc.id === activeId))?.updatedAt ?? null;
  // The open doc is seen, including edits that land while it is open.
  useEffect(() => {
    if (!activeId || activeUpdatedAt === null) return;
    const next = markSeen(seen, activeId, activeUpdatedAt);
    if (next) setSeenRaw(JSON.stringify(next));
  }, [activeId, activeUpdatedAt, seen, setSeenRaw]);
  // A lone timeline needs no header: the list then looks as it always did.
  const headed = !(sections.length === 1 && sections[0]?.kind === 'recent');
  // Searching shows every match, even inside collapsed sections.
  const collapsed = useMemo(() => (debounced ? new Set<string>() : parseCollapsed(collapsedRaw)), [debounced, collapsedRaw]);
  const searching = debounced.length > 0;
  const hasOther = groups.some((group) => group.key === OTHER_KEY);
  const sectionKeys = useMemo(
    () => [
      ...sections.map((section) => section.key),
      ...(unassignedList.length ? ['unassigned', ...groups.filter((group) => group.key !== OTHER_KEY).map((group) => group.key)] : [])
    ],
    [sections, unassignedList.length, groups]
  );
  const someOpen = anyOpen(sectionKeys, collapsedRaw, hasOther && otherOpen);
  const groupOpen = (group: UnassignedGroup) => searching || (group.key === OTHER_KEY ? otherOpen : !collapsed.has(group.key));
  const toggleGroup = (group: UnassignedGroup) => {
    if (searching) return; // the display ignores collapsed state while searching, so nothing is persisted
    if (group.key === OTHER_KEY) setOtherOpen((value) => !value);
    else setCollapsedRaw(pruneCollapsed(toggleCollapsed(collapsedRaw, group.key), null));
  };
  // Forget subgroup keys of mapped projects, but only from a complete, unfiltered, settled project list.
  const pruneIds = useMemo(() => {
    const list = unassignedProjects.data;
    const trusted = list && !unassignedProjects.loading && !unassignedProjects.error && !unassignedDocs.loading && list.length < MAX_LIST_LIMIT;
    return trusted && inUnassignedScope && status === 'active' && !query.trim() && !debounced ? new Set(list.map((item) => item.foreignProjectId)) : null;
  }, [unassignedProjects.data, unassignedProjects.loading, unassignedProjects.error, unassignedDocs.loading, inUnassignedScope, status, query, debounced]);
  useEffect(() => {
    if (!pruneIds) return;
    const next = pruneCollapsed(collapsedRaw, pruneIds);
    if (next !== collapsedRaw) setCollapsedRaw(next);
  }, [pruneIds, collapsedRaw, setCollapsedRaw]);
  // After the mapping dialog closes: the originating button, else the next subgroup, else the section header, else the list.
  useEffect(() => {
    if (mapping || !restore) return;
    const from = restore.order.indexOf(restore.key);
    const next = restore.order.slice(from + 1).map((key) => toggleRefs.current.get(key)).find((el) => el?.isConnected);
    const target = [mapRefs.current.get(restore.key), next, unassignedHead.current, listScroll.current].find((el) => el?.isConnected);
    setRestore(null);
    target?.focus();
  }, [mapping, restore]);
  const collapseHint = collapseAllHint({ projectFilter: !!projectFilter, grouped, searching, someOpen });
  const projectLabel = (doc: DesignDocSummary, section: ListSection) => {
    if (section.kind === 'project') return null;
    if (showProjects) return doc.projectId ? names.get(doc.projectId) ?? 'Unknown project' : 'Global';
    return doc.projectId ? null : 'Global';
  };
  const syncStates = useDocSyncStatuses(docs.data);
  const row = (doc: DesignDocSummary, section: ListSection, alternative: boolean) => (
    <DocRow
      key={doc.id}
      doc={doc}
      active={doc.id === activeId}
      alternative={alternative}
      projectName={alternative ? null : projectLabel(doc, section)}
      unseen={doc.id !== activeId && unseenAgentEdit(doc, seen)}
      syncState={(() => { const row = syncStates.get(doc.id); const state = row && effectiveSyncState(row); return needsAttention(state) ? state : undefined; })()}
      now={now}
      menuOpen={menu?.doc.id === doc.id}
      rename={
        renaming?.id === doc.id ? (
          <RowRename
            doc={doc}
            draft={renaming.draft}
            stale={titleRename.stale?.id === doc.id ? titleRename.stale : null}
            onDraft={(draft) => setRenaming({ id: doc.id, draft })}
            onCancel={() => {
              titleRename.useTheirs();
              endRename(doc.id);
            }}
            onCommit={async () => {
              // A stale head keeps the row open for the Keep yours / Use theirs choice; anything else closes it.
              if ((await titleRename.save(doc, renaming.draft.trim())) !== 'stale') endRename(doc.id);
            }}
            onKeepMine={() => {
              void titleRename.keepMine();
              endRename(doc.id);
            }}
            onUseTheirs={() => {
              titleRename.useTheirs();
              endRename(doc.id);
            }}
          />
        ) : undefined
      }
      onSelect={() => onSelect(doc.id)}
      onMenu={(at) => setMenu({ doc, at })}
    />
  );
  const projectChoices = useMemo(
    () => (showProjects ? projectOptions(docs.data ?? [], projects, projectFilter) : []),
    [showProjects, docs.data, projects, projectFilter]
  );

  return (
    <div className="dd-list">
      <div className="dd-list-head">
        <span className="dd-list-title">Design docs</span>
        {docs.data ? (
          <span className="dd-list-count" title={`${visible.length} ${visible.length === 1 ? 'doc' : 'docs'}`}>
            {visible.length}
          </span>
        ) : null}
        <span className="dd-spacer" />
        <IconButton icon={House} label="Home" onClick={onHome} />
        <SettingsToggle open={false} onToggle={onOpenSettings} />
        <SyncButton peerSync={peerSync} />
         <button type="button" className="btn primary dd-head-btn dd-new" onClick={onNew}>
          <Plus size={13} aria-hidden /> New
         </button>
        <IconButton icon={PanelLeftClose} label="Hide doc list" onClick={onCollapse} />
        {headerActions}
      </div>
      {totals && totals.total !== visible.length ? (
        <div className="dd-list-total" title={`${totals.total} docs across all projects and statuses, ${totals.unmapped} unmapped`}>
          <span>{visible.length} of {totals.total} docs</span>
          {totals.unmapped ? <><span aria-hidden>·</span><button type="button" className="dd-link" onClick={() => setMapping(true)}>{totals.unmapped} unmapped</button></> : null}
        </div>
      ) : null}
      <div className="dd-list-tools">
        <label className="dd-search">
          <Search size={13} aria-hidden />
          <input value={query} placeholder="Search docs and content" aria-label="Search design docs" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            setQuery('');
            listScroll.current?.focus();
          }} />
          {query ? (
            <button type="button" className="dd-search-clear" aria-label="Clear search" onClick={() => setQuery('')}>
              <X size={12} aria-hidden />
            </button>
          ) : null}
        </label>
      </div>
      <div className="dd-list-filters">
        <PopoverPicklist
          ariaLabel="Filter by status"
          value={status}
          options={STATUS_OPTIONS}
          onChange={setStatus}
          searchable={false}
          triggerClassName={`launch-model-picker-trigger dd-pick${status !== 'active' ? ' on' : ''}`}
          triggerIcon={<CircleDot size={12} aria-hidden />}
        />
        {showProjects ? (
          <PopoverPicklist
            ariaLabel="Filter by project"
            value={projectFilter}
            options={projectChoices}
            onChange={setProjectFilter}
            searchable={projectChoices.length > 8}
            searchPlaceholder="Search projects…"
            minWidth={220}
            triggerClassName={`launch-model-picker-trigger dd-pick${projectFilter ? ' on' : ''}`}
            triggerIcon={<FolderOpen size={12} aria-hidden />}
          />
        ) : null}
        {showProjects ? (
          <>
            <span className="dd-spacer" />
            <IconButton
              icon={grouped ? Layers : List}
              label="Group by project"
              hint={groupHint({ projectFilter: !!projectFilter, grouped })}
              active={byProject}
              pressed={grouped}
              disabled={!!projectFilter}
              size={13}
              onClick={() => setGrouped(!grouped)}
            />
            <IconButton
              icon={someOpen ? ChevronsDownUp : ChevronsUpDown}
              label={someOpen ? 'Collapse all sections' : 'Expand all sections'}
              hint={collapseHint}
              disabled={!byProject || searching}
              size={13}
              onClick={() => {
                setCollapsedRaw(someOpen ? collapseAll(sectionKeys) : expandAll());
                setOtherOpen(!someOpen);
              }}
            />
          </>
        ) : null}
      </div>
      <div className="dd-list-scroll" ref={listScroll} tabIndex={-1}>
        {docs.error ? <div className="dd-banner dd-banner-error">{docs.error}</div> : null}
        {!docs.data && docs.loading ? (
          <div className="dd-center">
            <Spinner label="Loading design docs" />
          </div>
        ) : null}
        {docs.data && !visible.length ? (
          <div className="dd-list-empty dd-muted">{debounced || filtered ? 'No docs match.' : 'No design docs yet.'}</div>
        ) : null}
        {sections.map((section) => {
          const open = !collapsed.has(section.key);
          const rows = section.entries.flatMap((entry) => [
            row(entry.doc, section, false),
            ...entry.alternatives.map((alternative) => row(alternative, section, true))
          ]);
          if (!headed) return rows;
          return (
            <section key={section.key} className="dd-list-group" aria-label={section.label}>
              <SectionHead section={section} open={open} onToggle={() => setCollapsedRaw(toggleCollapsed(collapsedRaw, section.key))} />
              {open ? rows : null}
            </section>
          );
        })}
        {unassignedList.length ? (
          <section className="dd-list-group dd-list-unassigned" aria-label={UNASSIGNED_LABEL}>
            <SectionHead
              buttonRef={unassignedHead}
              section={{ key: 'unassigned', kind: 'recent', label: UNASSIGNED_LABEL, entries: [], count: unassignedList.length }}
              count={countText(unassignedList.length, unassignedCapped)}
              open={unassignedOpen}
              onToggle={() => setCollapsedRaw(toggleCollapsed(collapsedRaw, 'unassigned'))}
            />
            {unassignedOpen ? (
              <>
                {groups.map((group) => {
                  const open = groupOpen(group);
                  const peer = group.foreignProjectId !== null;
                  const basis = basisText(group.suggestionBasis);
                  return (
                    <div key={group.key} role="group" aria-label={groupAriaLabel(group)} aria-busy={group.pending || undefined} className="dd-list-subgroup">
                      <div className="dd-list-subhead">
                        <button
                          ref={(el) => { if (el) toggleRefs.current.set(group.key, el); else toggleRefs.current.delete(group.key); }}
                          type="button"
                          className="dd-list-subtoggle"
                          title={group.pending ? undefined : [group.label, peer ? 'From another computer; not a local Project' : null, group.suggestedName ? `Suggested Project: ${group.suggestedName} (${basis})` : null].filter(Boolean).join('\n')}
                          aria-expanded={open}
                          onClick={() => toggleGroup(group)}
                        >
                          <ChevronDown size={11} aria-hidden className="dd-list-section-caret" />
                          {group.pending ? (
                            <>
                              <span className="dd-skel" aria-hidden="true" />
                              <span className="dd-vh">Loading project name</span>
                            </>
                          ) : (
                            <span className="dd-list-sublabel" dir="auto" title={group.label}>{group.label}</span>
                          )}
                          {group.suggestedName ? (
                            <span className="dd-list-chip" title={`Suggested Project, ${basis}`}>suggested: {shorten(group.suggestedName)}</span>
                          ) : null}
                          {peer ? <span className="dd-list-chip" title="From another computer; not a local Project">peer</span> : null}
                        </button>
                        {group.suggestedName && peer ? (
                          <button
                            ref={(el) => { if (el) mapRefs.current.set(group.key, el); else mapRefs.current.delete(group.key); }}
                            type="button"
                            className="dd-map-short"
                            title={`Opens the mapping dialog; ${basis}`}
                            aria-label={`Map ${group.label} docs to ${group.suggestedName}, ${basis}`}
                            onClick={() => {
                              setRestore({ key: group.key, order: groups.map((item) => item.key) });
                              setMappingFocus(group.foreignProjectId);
                              setMapping(true);
                            }}
                          >
                            Map to {shorten(group.suggestedName)}
                          </button>
                        ) : null}
                        <span className="dd-list-section-count">{countText(group.docs.length, group.capped)}</span>
                      </div>
                      {open ? <div className="dd-list-subbody">{group.docs.map((doc) => row(doc, UNASSIGNED_SECTION, false))}</div> : null}
                    </div>
                  );
                })}
                <div className="dd-list-actions">
                  <button type="button" className="btn dd-head-btn" onClick={() => setMapping(true)}>
                    <FolderOpen size={12} aria-hidden /> Map to a Project…
                  </button>
                </div>
              </>
            ) : null}
          </section>
        ) : searching && inUnassignedScope && !unassignedDocs.loading && (unassignedProjects.data?.length ?? 0) > 0 ? (
          <div className="dd-list-empty dd-muted">No matching docs from peers.</div>
        ) : null}
      </div>
      {mapping ? (
        <UnassignedProjectsDialog
          unassigned={unassignedProjects.data ?? []}
          projects={projects}
          focusForeignId={mappingFocus ?? undefined}
          onClose={() => {
            setMapping(false);
            setMappingFocus(null);
          }}
          onChanged={() => {
            unassignedProjects.reload();
            unassignedDocs.reload();
          }}
        />
      ) : null}
      {menu ? (
        <ContextMenu key={`${menu.doc.id}@${menu.at.x},${menu.at.y}`} at={menu.at} label={`Actions for ${menu.doc.title}`} onClose={() => setMenu(null)}>
          {docActions.items(
            menu.doc,
            () => setMenu(null),
            () => onDeleted(menu.doc.id),
            menu.doc.id === activeId ? undefined : () => onSelect(menu.doc.id),
            () => setRenaming({ id: menu.doc.id, draft: menu.doc.title })
          )}
        </ContextMenu>
      ) : null}
      {docActions.dialogs}
    </div>
  );
}

function TemplateCards({ templates, selected, onSelect }: { templates: TemplateInfo[]; selected: string | null; onSelect(id: string): void }) {
  return (
    <div className="dd-templates" role="radiogroup" aria-label="Template">
      {templates.map((template) => (
        <button
          key={template.id}
          type="button"
          role="radio"
          aria-checked={selected === template.id}
          className={`dd-template${selected === template.id ? ' on' : ''}`}
          onClick={() => onSelect(template.id)}
        >
          <span className="dd-template-label">{template.label}</span>
          <span className="dd-template-desc">{template.description}</span>
          <span className="dd-template-files">{template.files.join(' · ')}</span>
        </button>
      ))}
    </div>
  );
}

export function NewDocDialog({
  initialTemplate,
  defaultProjectId,
  projects,
  onClose,
  onCreated
}: {
  initialTemplate?: string | null;
  defaultProjectId: string | null;
  projects: ProjectInfo[];
  onClose(): void;
  onCreated(docId: string): void;
}) {
  const api = useApi();
  const navigate = useZccNavigate();
  const templates = useTemplates();
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [template, setTemplate] = useState<string | null>(initialTemplate ?? null);
  const [projectId, setProjectId] = useState(defaultProjectId ?? '');
  const [tags, setTags] = useState('');
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen = template ?? templates.data?.[0]?.id ?? null;
  const drafting = !!brief.trim();
  const agentProject = projectId || defaultProjectId || defaultAgentProject(projects) || '';

  const create = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    let doc;
    try {
      doc = await api.create({
        title: title.trim(),
        ...(summary.trim() ? { summary: summary.trim() } : {}),
        ...(chosen ? { template: chosen } : {}),
        tags: tags
          .split(',')
          .map((tag) => tag.trim().toLowerCase())
          .filter(Boolean),
        projectId: projectId || null
      });
    } catch (error) {
      toast(`Could not create the doc: ${errorMessage(error)}`, 'error');
      setBusy(false);
      return;
    }
    onCreated(doc.id);
    if (drafting) {
      if (!agentProject) {
        toast('Doc created. Add a project to let an agent draft it.', 'error');
      } else {
        // The doc exists either way; only the drafting agent can fail from here.
        try {
          if (!draftDocAgent(navigate, doc, { prompt: draftingPrompt(brief), projectId: agentProject })) {
            const result = await api.askAgent(doc.id, { prompt: draftingPrompt(brief), projectId: agentProject });
            showDocAgent(navigate, doc, result.threadId);
            toast(`An agent is drafting “${doc.title}”. Watch it fill in as it writes.`);
          }
        } catch (error) {
          toast(`Doc created, but the agent could not start: ${errorMessage(error)}`, 'error');
        }
      }
    }
    onClose();
  };

  return (
    <Dialog
      title="New design doc"
      wide
      onClose={onClose}
      footer={
        <>
          <span className="dd-muted dd-dialog-hint">{drafting ? 'An agent drafts it from the brief.' : 'You can ask an agent to fill it in later.'}</span>
          <span className="dd-spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!title.trim() || busy} onClick={() => void create()}>
            {busy ? <Spinner size={12} /> : drafting ? <Sparkles size={12} aria-hidden /> : null}
            {drafting ? 'Create & draft with agent' : 'Create'}
          </button>
        </>
      }
    >
      <form
        className="dd-form"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label className="dd-field">
          <span className="dd-field-label">Title</span>
          <input
            className="dd-input"
            value={title}
            maxLength={MAX_TITLE_LENGTH}
            placeholder="e.g. Offline sync for the mobile app"
            onChange={(event) => setTitle(event.target.value)}
            autoFocus
          />
        </label>
        <label className="dd-field">
          <span className="dd-field-label">Summary</span>
          <input
            className="dd-input"
            value={summary}
            maxLength={MAX_SUMMARY_LENGTH}
            placeholder="One line agents see when deciding which doc to read"
            onChange={(event) => setSummary(event.target.value)}
          />
        </label>
        <div className="dd-field">
          <span className="dd-field-label">Template</span>
          {templates.data ? <TemplateCards templates={templates.data} selected={chosen} onSelect={setTemplate} /> : <Spinner label="Loading templates" />}
        </div>
        <div className="dd-field-row">
          <label className="dd-field">
            <span className="dd-field-label">Project</span>
            <select className="dd-input dd-select" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">Global (all projects)</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="dd-field">
            <span className="dd-field-label">Tags</span>
            <input className="dd-input" value={tags} placeholder="sync, mobile" onChange={(event) => setTags(event.target.value)} />
          </label>
        </div>
        <label className="dd-field">
          <span className="dd-field-label">
            <Sparkles size={12} aria-hidden /> Brief for an agent <span className="dd-muted">(optional)</span>
          </span>
          <textarea
            className="dd-input"
            rows={4}
            value={brief}
            maxLength={BRIEF_LIMIT}
            placeholder="Describe the problem, constraints and any ideas. An agent will draft the doc from this while you watch."
            onChange={(event) => setBrief(event.target.value)}
          />
        </label>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function TemplateManager({ templates, onNew, onEdit, onChanged }: { templates: TemplateInfo[] | null; onNew(template?: string): void; onEdit(template: TemplateInfo): void; onChanged(): void }) {
  const api = useApi();
  const input = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [more, setMore] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const needle = query.trim().toLowerCase();
  const filtered = (templates ?? []).filter((template) => `${template.label} ${template.description} ${template.files.join(' ')}`.toLowerCase().includes(needle));
  const run = async (action: 'duplicate' | 'export' | 'delete', template: TemplateInfo) => {
    try {
      if (action === 'duplicate') await api.templateDuplicate(template.id);
      else if (action === 'export') {
        const bundle = await api.templatesExport([template.id]);
        saveBytes(`${template.id}.design-doc-templates.json`, new TextEncoder().encode(bundle.bundleText), 'application/json');
      } else await api.templateDelete(template.id);
      onChanged();
    } catch (error) {
      toast(`Could not ${action} template: ${errorMessage(error)}`, 'error');
    }
  };
  const createTemplate = () =>
    api
      .templateNew({ label: 'New template' })
      .then((template) => {
        onChanged();
        onEdit({ id: template.id, key: template.id, docId: template.id, origin: 'user', entryPath: template.entryPath, label: template.title, description: template.summary, files: template.files.map((file) => file.path) });
      })
      .catch((error) => toast(`Could not create template: ${errorMessage(error)}`, 'error'));
  const importTemplates = async (file: File | null) => {
    if (!file) return;
    try {
      const { imported, skipped } = await api.templatesImport(await file.text());
      onChanged();
      toast(importSummary(imported.length, skipped));
    } catch (error) {
      toast(`Could not import templates: ${errorMessage(error)}`, 'error');
    } finally {
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div className="dd-landing-start">
      <div className="dd-template-heading">
        <span className="dd-section-label">Start from a template</span>
        <span className="dd-spacer" />
        <button type="button" className="btn primary dd-head-btn" onClick={() => void createTemplate()}>
          <Plus size={13} aria-hidden /> New template
        </button>
        <Popover
          open={more}
          onClose={() => setMore(false)}
          className="dd-menu"
          anchor={<IconButton icon={MoreHorizontal} label="Template actions" active={more} onClick={() => setMore(!more)} />}
        >
          <MenuItem icon={FolderOpen} label="Import" onSelect={() => { setMore(false); input.current?.click(); }} />
          <MenuItem icon={Download} label="Export all" onSelect={() => { setMore(false); void api.templatesExport().then((bundle) => saveBytes('design-doc-templates.json', new TextEncoder().encode(bundle.bundleText), 'application/json')).catch((error) => toast(`Could not export templates: ${errorMessage(error)}`, 'error')); }} />
          <MenuItem icon={Copy} label="Restore built-ins" onSelect={() => { setMore(false); void api.templatesRestoreBuiltins().then(onChanged).catch((error) => toast(`Could not restore built-ins: ${errorMessage(error)}`, 'error')); }} />
        </Popover>
      </div>
      <input ref={input} type="file" accept="application/json,.json" hidden onChange={(event) => void importTemplates(event.target.files?.[0] ?? null)} />
      <label className="dd-search dd-template-filter">
        <Search size={13} aria-hidden />
        <input value={query} placeholder="Filter templates" aria-label="Filter templates" onChange={(event) => setQuery(event.target.value)} />
      </label>
      {templates ? (
        <div className="dd-templates" role="list">
          {filtered.map((template) => (
            <div key={template.id} className="dd-template-wrap" role="listitem">
              <button type="button" className="dd-template" onClick={() => onNew(template.id)}>
                <span className="dd-template-label">{template.label}</span>
                <span className="dd-template-desc">{template.description}</span>
                <span className="dd-template-files">{template.files.join(' · ')}</span>
              </button>
              <Popover
                open={menuFor === template.id}
                onClose={() => setMenuFor((current) => (current === template.id ? null : current))}
                className="dd-menu"
                anchor={<IconButton icon={MoreHorizontal} label={`Actions for ${template.label}`} size={13} active={menuFor === template.id} onClick={() => setMenuFor(menuFor === template.id ? null : template.id)} />}
              >
                <MenuItem icon={Pencil} label="Edit" onSelect={() => { setMenuFor(null); onEdit(template); }} />
                <MenuItem icon={Copy} label="Duplicate" onSelect={() => { setMenuFor(null); void run('duplicate', template); }} />
                <MenuItem icon={Download} label="Export" onSelect={() => { setMenuFor(null); void run('export', template); }} />
                <MenuItem icon={Trash2} label="Delete" danger disabledReason={templates.length <= 1 ? 'Keep at least one template.' : undefined} onSelect={() => { setMenuFor(null); void run('delete', template); }} />
              </Popover>
            </div>
          ))}
        </div>
      ) : (
        <Spinner />
      )}
    </div>
  );
}

function Landing({ templates, onNew, onEdit, onChanged }: { templates: TemplateInfo[] | null; onNew(template?: string): void; onEdit(template: TemplateInfo): void; onChanged(): void }) {
  return (
    <div className="dd-landing">
      <div className="dd-landing-inner">
        <span className="dd-landing-icon">
          <DraftingCompass size={26} aria-hidden />
        </span>
        <h1 className="dd-landing-title">Design docs your agents work on with you</h1>
        <p className="dd-landing-lede">
          Each doc is a small project of Markdown, Mermaid diagrams and HTML mockups. Agents in this project know your docs, read them for
          context, edit them, and leave review comments. You watch every change land live.
        </p>
        <ul className="dd-landing-points">
          <li>
            <Sparkles size={13} aria-hidden /> <strong>Ask agent</strong> to review, fill gaps, add diagrams or check a design against the code.
          </li>
          <li>
            <MessageSquare size={13} aria-hidden /> Select any passage to comment. Agents address open comments.
          </li>
          <li>
            <Bot size={13} aria-hidden /> Every save is versioned, so an agent's edit is always one click from undone.
          </li>
        </ul>
        <TemplateManager templates={templates} onNew={onNew} onEdit={onEdit} onChanged={onChanged} />
      </div>
    </div>
  );
}

/**
 * Doc list + doc. `variant` "global" (the nav panel) lists every project's
 * docs; "project" (the project tab) lists one project's docs plus global ones.
 */
/** Ctrl+F anywhere in the panel that no pane took: the doc list's search box. */
function focusListSearch(event: KeyboardEvent<HTMLElement>) {
  if (!panelFindKey(event)) return;
  event.preventDefault();
  const input = event.currentTarget.querySelector<HTMLInputElement>('input[aria-label="Search design docs"]');
  input?.focus();
  input?.select();
}

export function Workbench({
  projectId,
  location,
  onLocationChange,
  variant,
  headerActions
}: {
  projectId: string | null;
  location: DocLocation;
  onLocationChange(location: DocLocation, replace?: boolean): void;
  variant: 'global' | 'project';
  /** Host split-pane actions for a project tab with a custom header. */
  headerActions?: ReactNode;
}) {
  const projects = useProjects();
  const templates = useTemplates();
  const [creating, setCreating] = useState<{ template: string | null } | null>(null);
  const [listOpen, setListOpen] = usePersistentState<boolean>('list-open', true);
  const [view, setView] = useState<'docs' | 'settings'>('docs');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const peerSync = usePeerSync();
  const projectList = projects.data ?? [];
  const navigate = useZccNavigate();
  const publishPageContext = navigate.setPageContext;
  const global = variant === 'global';
  const setPanelScope = navigate.setPanelScope;
  // One agent panel per doc on the nav page: the doc id is the pinned tab's item key and the scope id.
  useEffect(() => {
    if (!global || !setPanelScope) return;
    setPanelScope(location.docId ? { id: location.docId, ...(projectId ? { projectId } : {}) } : null);
  }, [global, setPanelScope, location.docId, projectId]);
  // The doc the page itself just opened (list, new doc) is not a pinned-tab activation.
  const selfOpened = useRef<string | null>(null);
  const opened = useRef<{ docId: string | null; agent: boolean }>({ docId: null, agent: false });
  if (opened.current.docId !== location.docId) {
    opened.current = {
      docId: location.docId,
      agent: global && !!location.docId && selfOpened.current !== location.docId && !!navigate.isPinned?.(location.docId)
    };
    selfOpened.current = null;
  }
  const openLocation = (docId: string | null) => {
    selfOpened.current = docId;
    onLocationChange({ docId, path: null });
  };
  useLayoutEffect(() => {
    if (view !== 'settings' && (location.docId || templateId)) return;
    publishPageContext?.({ title: view === 'settings' ? 'Design Docs settings' : 'Design Docs catalogue' });
    return () => publishPageContext?.(null);
  }, [publishPageContext, view, location.docId, templateId]);

  if (view === 'settings') {
    return (
      <div className="dd-root dd-workbench">
        <SettingsView
          peer={peerSync.peer}
          onBack={() => {
            setView('docs');
            peerSync.refresh();
          }}
          headerActions={headerActions}
        />
      </div>
    );
  }

  return (
    <PinnableContext.Provider value={global}>
    <div className="dd-root dd-workbench" {...{ [OWN_FIND_ATTRIBUTE]: '' }} onKeyDown={focusListSearch}>
      {listOpen ? (
        <DocList
          projectId={variant === 'project' ? projectId : null}
          showProjects={variant === 'global'}
          projects={projectList}
          activeId={location.docId}
          onSelect={(docId) => { setTemplateId(null); openLocation(docId); }}
          onDeleted={(docId) => {
            if (navigate.isPinned?.(docId)) navigate.updatePinnedItem?.(docId, { available: false });
            if (docId === location.docId) onLocationChange({ docId: null, path: null });
          }}
          onNew={() => setCreating({ template: null })}
          onCollapse={() => setListOpen(false)}
          peerSync={peerSync}
          onOpenSettings={() => setView('settings')}
          onHome={() => { setTemplateId(null); onLocationChange({ docId: null, path: null }); }}
          headerActions={headerActions}
        />
      ) : (
        <nav className="dd-list-collapsed" aria-label="Design docs">
          <IconButton icon={PanelLeftOpen} label="Show doc list" onClick={() => setListOpen(true)} />
          <IconButton icon={Plus} label="New design doc" onClick={() => setCreating({ template: null })} />
          <SyncButton peerSync={peerSync} compact />
          {headerActions}
        </nav>
      )}
      <main className="dd-main">
        {templateId ? (
          <>
            <div className="dd-template-bar">
              <button type="button" className="btn dd-head-btn" onClick={() => { setTemplateId(null); templates.reload(); }}>
                <ArrowLeft size={13} aria-hidden /> Back to templates
              </button>
            </div>
            <DocView key={templateId} docId={templateId} path={null} layout="workbench" kind="template" onOpenPath={() => undefined} onDeleted={() => { setTemplateId(null); templates.reload(); }} />
          </>
        ) : location.docId ? (
          <DocView
            key={location.docId}
            docId={location.docId}
            path={location.path}
            layout="workbench"
            contextProjectId={projectId}
            openAgent={opened.current.agent}
            onOpenPath={(path, replace) => onLocationChange({ docId: location.docId, path }, replace ?? true)}
            onDeleted={() => onLocationChange({ docId: null, path: null })}
          />
        ) : (
          <Landing
            templates={templates.data}
            onNew={(template) => setCreating({ template: template ?? null })}
            onEdit={(template) => setTemplateId(template.docId)}
            onChanged={templates.reload}
          />
        )}
      </main>
      {creating ? (
        <NewDocDialog
          initialTemplate={creating.template}
          defaultProjectId={projectId}
          projects={projectList}
          onClose={() => setCreating(null)}
          onCreated={openLocation}
        />
      ) : null}
    </div>
    </PinnableContext.Provider>
  );
}
