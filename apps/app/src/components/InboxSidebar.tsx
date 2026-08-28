import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  CalendarClock,
  Check,
  ChevronRight,
  Circle,
  FileText,
  HelpCircle,
  Lightbulb,
  ListTodo,
  MailOpen,
  MoonStar,
  PauseCircle,
  Settings,
  Star,
  StarOff,
  Target,
  Trash2,
  type LucideIcon
} from 'lucide-react';
import {
  useData,
  useInbox,
  useInboxAnswered,
  useInboxCollapsed,
  useInboxKeep,
  useInboxRead,
  useInboxSelection,
  useFeedNoise,
  maybeRefreshFeedNoise,
  scopeKeyFor,
  deleteInboxEntry,
  toggleInboxKeep
} from '../store.js';
import { inboxQuestions, hasBlockingQuestion, type InboxEntry } from '@zana-ai/zcc-domain/product';
import {
  groupByBucketThenProject,
  groupByBucketFlat,
  flattenVisible,
  flattenVisibleFlat,
  subGroupKey,
  groupedSectionKey,
  type Bucket,
  type GroupedSection,
  type ProjectSubGroup
} from '@zana-ai/zcc-domain/inbox-grouping';
import { inboxPrimaryTitle, inboxSecondaryLine, inboxPreview, inboxContextLine } from '../lib/inboxPresentation.js';
import { isReport } from '@zana-ai/zcc-domain/feed-categories';
import { DelayedStencilList } from './ui/Skeleton.js';

/**
 * Map a registry icon NAME (from `feedCategories.ts`) to a lucide component.
 * The registry is pure/React-free, so the icon→component binding lives here.
 * Unknown/absent names fall back to the CalendarClock glyph.
 */
const SECTION_ICONS: Record<string, LucideIcon> = {
  CalendarClock,
  MoonStar,
  PauseCircle,
  ListTodo,
  Settings,
  HelpCircle,
  Lightbulb,
  Target
};
function sectionIcon(name?: string): LucideIcon {
  return (name && SECTION_ICONS[name]) || CalendarClock;
}

/** How many pending questions the "Needs your answer" band shows before the
 *  "show N more" toggle. Keeps the band from shoving the date buckets off-screen. */
const PINNED_QUESTION_COLLAPSED_COUNT = 5;
/** Questions older than this drop off the pinned band (still reachable inline). */
const PINNED_QUESTION_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

/**
 * Inbox sidebar list.
 *
 * Linear-style:
 * - Date-bucketed (Today / Yesterday / This week / Older), newest-first
 * - Within each bucket, entries are sub-grouped by project (color dot +
 *   name + count) so the user can scan per-project activity
 * - Each row: unread dot · relative time · text preview
 * - j/k keyboard navigation (walks the flattened render order)
 * - Default-selects the newest entry on first load if none is selected
 *
 * Read semantics: SELECTION marks read. Every site that mutates the
 * selection (click / j/k / default-select) also calls markRead(id).
 * Bulk-on-visibility is deliberately avoided — see store.ts inbox-read
 * comment for the rationale.
 */
export function InboxSidebar({
  query = '',
  unreadOnly = false,
  reportsOnly = false,
  scopeProjectId = null,
  grouping = 'project'
}: {
  query?: string;
  unreadOnly?: boolean;
  /** When set, show ONLY entries explicitly flagged `report: true` (the Reports
   *  tab / Reports filter). Narrows the feed to deliverables. */
  reportsOnly?: boolean;
  /** When set, show only this project's entries (focused/scoped view). */
  scopeProjectId?: string | null;
  /** How to group rows within each day bucket: per-project subgroups
   *  ('project', default) or a flat chronological stream ('time'). */
  grouping?: 'project' | 'time';
} = {}) {
  const entries = useInbox((s) => s.entries);
  const loading = useInbox((s) => s.loading);
  const selectedId = useInboxSelection((s) => s.selectedEntryId);
  const select = useInboxSelection((s) => s.select);
  const readIds = useInboxRead((s) => s.readIds);
  const keptIds = useInboxKeep((s) => s.keptIds);
  // Which entries the user has already answered/skipped — a question entry stops
  // being "pending" (loses its flag) once answered, same signal the detail pane uses.
  const answeredIds = useInboxAnswered((s) => s.answeredIds);
  const markRead = useInboxRead((s) => s.markRead);
  const markUnread = useInboxRead((s) => s.markUnread);
  const projects = useData((s) => s.projects);

  // Open right-click menu: which entry + the cursor anchor (viewport coords).
  // Rendered `position: fixed` so it escapes the list's scroll/clip container —
  // mirrors the Projects and Agents context menus.
  const [rowMenu, setRowMenu] = useState<{ entry: InboxEntry; x: number; y: number } | null>(null);
  const openRowMenu = (e: ReactMouseEvent, entry: InboxEntry) => {
    e.preventDefault();
    setRowMenu({ entry, x: e.clientX, y: e.clientY });
  };
  // Explicit per-(bucket,project) collapse choices (persisted). Absence →
  // falls back to the all-read auto-fold default below.
  const collapsedByProject = useInboxCollapsed((s) => s.byKey);
  const toggleProjectCollapsed = useInboxCollapsed((s) => s.toggle);

  // Optional feed-noise overlay: main's advisory set of report-entry ids judged
  // "routine" (folded into the "Routine" section). Gated by the config flag;
  // when off the hook never fetches and the set stays empty (every report inline).
  const feedNoiseEnabled = useData((s) => s.feedNoiseClassifierEnabled);
  const noiseScopeKey = scopeKeyFor(scopeProjectId ?? null);
  const routineIds = useFeedNoise((s) => s.byScope[noiseScopeKey]?.routineIds);

  const selectAndRead = (id: string) => {
    select(id);
    markRead(id);
  };

  // In scoped view (single project), we suppress the per-project subheader
  // since there's only one project and it would be redundant visual noise.
  const scoped = !!scopeProjectId;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q && !unreadOnly && !reportsOnly && !scopeProjectId) return entries;
    return entries.filter((e) => {
      if (scopeProjectId && e.projectId !== scopeProjectId) return false;
      if (reportsOnly && !isReport(e)) return false;
      if (unreadOnly && readIds[e.id]) return false;
      if (!q) return true;
      const hay = `${e.projectLabel ?? e.projectId} ${e.subject ?? ''} ${e.intent ?? ''} ${e.origin?.title ?? ''} ${e.comments ?? ''} ${
        e.docs?.map((d) => d.path).join(' ') ?? ''
      }`.toLowerCase();
      return hay.includes(q);
    });
  }, [entries, query, unreadOnly, reportsOnly, readIds, scopeProjectId]);

  // View-driven, throttled refresh of the routine overlay for the current scope.
  // No-op when the flag is off; internally rate-limited by inbox-content signature.
  useEffect(() => {
    maybeRefreshFeedNoise(scopeProjectId ?? null, filtered, feedNoiseEnabled);
  }, [filtered, scopeProjectId, feedNoiseEnabled]);

  // Entries the pinned "NEEDS YOUR ANSWER" band owns — newest first. A row earns
  // the band only when it carries an unanswered, still-fresh, BLOCKING question
  // (the agent can't proceed without the answer). A non-blocking / soft question
  // ("want me to open a PR?") is deliberately excluded: it still renders inline
  // and stays answerable, it just doesn't demand a pinned slot. Computed BEFORE
  // `groups` because the bucket layout excludes these ids so a pinned question
  // renders ONCE (in the band), never a second time inline (the band is a single
  // home, not a duplicate surface). Stale questions (> 3 days) drop off the band
  // and are excluded here too, so they fall back to rendering inline.
  const pendingQuestionEntries = useMemo(() => {
    const cutoff = Date.now() - PINNED_QUESTION_MAX_AGE_MS;
    return filtered
      .filter(
        (e) =>
          e.ts >= cutoff && hasPendingQuestion(e, answeredIds) && hasBlockingQuestion(e)
      )
      .sort((a, b) => b.ts - a.ts);
  }, [filtered, answeredIds]);

  // Ids the pinned band owns — excluded from the bucket layout so they don't
  // render twice. In scoped/time-view the band isn't rendered, but excluding is
  // still harmless (the band set is just the fresh pending questions).
  const pinnedExcludeIds = useMemo(
    () => new Set(pendingQuestionEntries.map((e) => e.id)),
    [pendingQuestionEntries]
  );

  const groups = useMemo(
    () =>
      groupByBucketThenProject(
        filtered,
        undefined,
        feedNoiseEnabled ? routineIds : undefined,
        pinnedExcludeIds
      ),
    [filtered, feedNoiseEnabled, routineIds, pinnedExcludeIds]
  );

  // TIME view: flat, newest-first stream per day bucket (signal only). Computed
  // regardless of mode (cheap) so a mode flip is instant; only rendered when
  // `grouping === 'time'`.
  const timeGroups = useMemo(
    () => groupByBucketFlat(filtered, undefined, feedNoiseEnabled ? routineIds : undefined),
    [filtered, feedNoiseEnabled, routineIds]
  );
  const timeMode = grouping === 'time';

  // Effective collapse for a project sub-group: an explicit user toggle always
  // wins; absent one, the DEFAULT is recency-driven — only "Today" pre-expands,
  // every older bucket (Yesterday / This week / Older) pre-collapses so the most
  // recent activity is what's open on arrival. Within "Today" we still tuck away
  // a sub-group whose entries are all read (unread work stays surfaced). `allRead`
  // is the per-(bucket,project) read state, passed in by the render loop.
  // In scoped mode, always return false to force all sub-groups expanded (no header,
  // so collapse affordances don't make sense).
  //
  // `hasSelected` guards the ONE surprising case: clicking a row marks it read,
  // which can flip a "Today" sub-group to all-read and auto-fold it out from
  // under the user (the row they just clicked vanishes). So a sub-group holding
  // the selected entry NEVER auto-folds — but an EXPLICIT collapse still wins
  // (the user can always fold it deliberately).
  const isCollapsed = (
    projectId: string,
    bucket: Bucket,
    allRead: boolean,
    hasSelected = false
  ): boolean => {
    if (scoped) return false;
    const explicit = collapsedByProject[subGroupKey(bucket, projectId)];
    if (explicit !== undefined) return explicit;
    if (hasSelected) return false;
    return bucket !== 'Today' || allRead;
  };

  // Which folded NOISE sections are expanded, keyed by
  // groupedSectionKey(bucket, project, category). One flat set across every
  // category (Agent closed, Scheduled, Paused, …) — the category is baked into
  // the key so each section collapses independently. Collapsed by default: the
  // whole point of folding is to keep high-volume recurring notices tucked away.
  const [expandedSectionKeys, setExpandedSectionKeys] = useState<ReadonlySet<string>>(new Set());
  const toggleSection = (key: string) =>
    setExpandedSectionKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Render order (bucket → project → entry → expanded scheduled), flattened to
  // entry ids. j/k and default-select MUST walk this, not `filtered` — the two
  // diverge once a project's entries interleave, and collapsed scheduled rows
  // are intentionally excluded so nav can't land on a hidden row.
  // All non-scheduled entries in a sub-group already read? Drives the auto-fold.
  const subgroupAllRead = (sg: { entries: InboxEntry[] }): boolean =>
    sg.entries.length > 0 && sg.entries.every((e) => readIds[e.id]);

  // Does a sub-group (incl. its folded noise sections) currently hold the
  // selected entry? Keeps that sub-group pinned open so selecting its last
  // unread row can't auto-fold it away (see `isCollapsed`).
  const subgroupHasSelected = (sg: ProjectSubGroup): boolean =>
    selectedId != null &&
    (sg.entries.some((e) => e.id === selectedId) ||
      sg.groupedSections.some((s) => s.entries.some((e) => e.id === selectedId)));

  // Collapse the pinned band to the newest PINNED_QUESTION_COLLAPSED_COUNT with a
  // "show N more" toggle, so a busy inbox doesn't push the date buckets off-screen.
  const [showAllQuestions, setShowAllQuestions] = useState(false);
  const shownQuestionEntries = showAllQuestions
    ? pendingQuestionEntries
    : pendingQuestionEntries.slice(0, PINNED_QUESTION_COLLAPSED_COUNT);
  const hiddenQuestionCount = pendingQuestionEntries.length - shownQuestionEntries.length;

  const visibleIds = useMemo(() => {
    const bucketIds = timeMode
      ? flattenVisibleFlat(timeGroups)
      : flattenVisible(groups, expandedSectionKeys, (sg, bucket) =>
          isCollapsed(sg.projectId, bucket, subgroupAllRead(sg), subgroupHasSelected(sg))
        );
    // Pinned questions lead the nav sequence (j/k starts on the first pending
    // question), then the buckets. Pending questions are excluded from the
    // buckets entirely (`pinnedExcludeIds`), so the dedupe filter is now belt-
    // and-suspenders — an id can't appear in both. Only the SHOWN pinned rows
    // join nav; a collapsed-away question (beyond PINNED_QUESTION_COLLAPSED_COUNT)
    // becomes navigable once "show N more" expands the band, which is its only
    // home now that it no longer renders inline.
    const pinnedIds = shownQuestionEntries.map((e) => e.id);
    const seen = new Set(pinnedIds);
    return [...pinnedIds, ...bucketIds.filter((id) => !seen.has(id))];
  },
    // `isCollapsed`/`subgroupAllRead`/`subgroupHasSelected` close over
    // collapsedByProject + readIds + selectedId + scoped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, timeMode, timeGroups, expandedSectionKeys, collapsedByProject, readIds, selectedId, scoped, shownQuestionEntries]
  );
  const projectsById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects]
  );

  // NOTE: we intentionally do NOT default-select the newest entry on first
  // load. With nothing selected, the detail column renders the Inbox Overview
  // (AI summary + Questions/Reports/Ideas/Goals rollups) as the landing page —
  // see `InboxView`. The user drops into a selected entry by clicking a row or
  // pressing j/k; both go through `selectAndRead` below. (Historically this
  // component force-selected `visibleIds[0]`, which pre-empted the Overview.)

  // Keep selection in scope: if the project scope changes (focus a project /
  // return home) and the selected entry no longer belongs to this scope, DROP
  // the selection so the detail pane falls back to the (now re-scoped)
  // Overview rather than stranding on an entry hidden by the current scope. We
  // deliberately do NOT auto-select the newest visible entry here — the
  // Overview is the intended landing page on a scope switch, same as first
  // load; the user re-enters an entry via click or j/k.
  //
  // Checked against `filtered` (scope-filtered entries), NOT `visibleIds` (the
  // render-order list, capped/collapsed for display). A deep-linked selection
  // (e.g. from the Home dashboard) can legitimately belong to this scope while
  // sitting outside the pinned-questions band's top-N cap or a collapsed
  // sub-group — `visibleIds` would wrongly call that "not in scope" and wipe
  // the selection right after this component mounts.
  useEffect(() => {
    if (selectedId && filtered.some((e) => e.id === selectedId)) return;
    if (selectedId) select(null);
    // Fire only on scope change: filtered is already fresh here because its
    // memo lists scopeProjectId in its deps, so it recomputes in the same
    // render before this effect runs. Adding filtered to the deps would
    // re-run this on every list change and fight the user's selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeProjectId]);

  // j/k navigation across the visible (render-ordered) sequence.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== 'j' && e.key !== 'k') return;
      if (visibleIds.length === 0) return;
      const idx = visibleIds.indexOf(selectedId ?? '');
      const next = e.key === 'j' ? Math.min(visibleIds.length - 1, idx + 1) : Math.max(0, idx - 1);
      if (next !== idx && visibleIds[next]) selectAndRead(visibleIds[next]);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleIds, selectedId]);

  if (loading && entries.length === 0) {
    return <DelayedStencilList label="Loading inbox" className="zcc-stencil-padded" />;
  }

  if (entries.length === 0) {
    return (
      <div className="inbox-sidebar-empty">
        No inbox messages.
        <div className="inbox-sidebar-empty-hint">
          Projects will push status updates here.
        </div>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="inbox-sidebar-empty">
        {unreadOnly && !query.trim()
          ? 'No unread messages.'
          : 'No matches.'}
      </div>
    );
  }

  return (
    <div className="inbox-sidebar-list">
      {/* Pinned "Needs your answer" — every unanswered question across the
          current scope, above the date buckets so it can't be buried. Each row
          carries its context line (author intent → session title). */}
      {pendingQuestionEntries.length > 0 && (
        <div className="inbox-questions-pinned">
          <div className="inbox-questions-pinned-head">
            <HelpCircle size={12} strokeWidth={2.5} aria-hidden />
            <span className="inbox-questions-pinned-label">Needs your answer</span>
            <span className="inbox-questions-pinned-count">{pendingQuestionEntries.length}</span>
          </div>
          {shownQuestionEntries.map((entry) => {
            const project = projectsById.get(entry.projectId) ?? null;
            return (
              <QuestionPinnedRow
                key={entry.id}
                entry={entry}
                projectName={project?.name ?? entry.projectLabel ?? entry.projectId}
                projectColor={project?.color}
                active={entry.id === selectedId}
                unread={!readIds[entry.id]}
                onClick={() => selectAndRead(entry.id)}
                onContextMenu={(e) => openRowMenu(e, entry)}
              />
            );
          })}
          {(hiddenQuestionCount > 0 || showAllQuestions) && (
            <button
              type="button"
              className="inbox-questions-pinned-more"
              onClick={() => setShowAllQuestions((v) => !v)}
            >
              {showAllQuestions
                ? 'Show fewer'
                : `Show ${hiddenQuestionCount} more`}
            </button>
          )}
        </div>
      )}
      {/* TIME view: a flat, newest-first stream per day bucket (signal only).
          Each row shows a project dot + name prefix since there's no per-project
          header to carry it. Noise (scheduled/agent-closed/heartbeat) is omitted
          — flip to the project view to see it. */}
      {timeMode &&
        timeGroups.map(([bucket, list]) => (
          <div key={bucket} className="inbox-bucket">
            <div className="inbox-bucket-label">{bucket}</div>
            {list.map((entry) => {
              const project = projectsById.get(entry.projectId) ?? null;
              return (
                <InboxRow
                  key={entry.id}
                  entry={entry}
                  active={entry.id === selectedId}
                  unread={!readIds[entry.id]}
                  kept={!!keptIds[entry.id]}
                  pendingQuestion={hasPendingQuestion(entry, answeredIds)}
                  onClick={() => selectAndRead(entry.id)}
                  onContextMenu={(e) => openRowMenu(e, entry)}
                  projectName={project?.name ?? entry.projectLabel ?? entry.projectId}
                  projectColor={project?.color}
                />
              );
            })}
          </div>
        ))}
      {!timeMode && groups.map(([bucket, subgroups]) => (
        <div key={bucket} className="inbox-bucket">
          <div className="inbox-bucket-label">{bucket}</div>
          {subgroups.map((sg) => {
            const project = projectsById.get(sg.projectId) ?? null;
            const name = project?.name ?? sg.fallbackLabel;
            const color = project?.color;
            // Count folded noise entries + their unread tally across all sections.
            const noiseCount = sg.groupedSections.reduce((n, s) => n + s.entries.length, 0);
            const noiseUnread = sg.groupedSections.reduce(
              (n, s) => n + s.entries.filter((e) => !readIds[e.id]).length,
              0
            );
            // Total count shown on the project header includes all folded sections.
            const totalCount = sg.entries.length + noiseCount;
            // Effective collapse: explicit toggle wins, else the recency default
            // (only Today pre-expands; Today also folds when all-read). Unread
            // count surfaces on the header while collapsed.
            const collapsed = isCollapsed(
              sg.projectId,
              bucket,
              subgroupAllRead(sg),
              subgroupHasSelected(sg)
            );
            const projUnread = sg.entries.filter((e) => !readIds[e.id]).length + noiseUnread;
            // Any unanswered question anywhere in this sub-group (incl. folded
            // sections) — surfaced on the collapsed header so a pending question
            // is visible even when the project is folded shut.
            const pendingQuestions =
              sg.entries.filter((e) => hasPendingQuestion(e, answeredIds)).length +
              sg.groupedSections.reduce(
                (n, s) => n + s.entries.filter((e) => hasPendingQuestion(e, answeredIds)).length,
                0
              );
            return (
              <div key={sg.projectId} className="inbox-project-group">
                {/* In scoped mode (single project), suppress the project subheader —
                    it's redundant noise when the sidebar is already filtered to one project. */}
                {!scoped && (
                  <button
                    type="button"
                    className={`inbox-project-subhead ${collapsed ? 'collapsed' : ''}`}
                    onClick={() => toggleProjectCollapsed(subGroupKey(bucket, sg.projectId))}
                    aria-expanded={!collapsed}
                    title={collapsed ? `Expand ${name}` : `Collapse ${name}`}
                  >
                    <ChevronRight
                      size={11}
                      className="inbox-project-chevron"
                      aria-hidden
                    />
                    <span
                      className={`inbox-project-dot ${color ? '' : 'inbox-project-dot--none'}`}
                      style={color ? { background: color } : undefined}
                      aria-hidden
                    />
                    <span className={`inbox-project-name ${project ? '' : 'tombstoned'}`}>
                      {name}
                    </span>
                    {/* Pending-question flag — surfaces an unanswered inbox_ask on
                        the header so it's noticeable even while the group is folded. */}
                    {pendingQuestions > 0 && (
                      <span
                        className="inbox-project-question"
                        title={`${pendingQuestions} question${pendingQuestions > 1 ? 's' : ''} awaiting your answer`}
                      >
                        <HelpCircle size={11} strokeWidth={2.5} aria-hidden />
                        {pendingQuestions > 1 ? pendingQuestions : ''}
                      </span>
                    )}
                    {/* While collapsed, lead with the unread count (the reason to
                        reopen); otherwise show the total. */}
                    <span className="inbox-project-count">
                      {collapsed && projUnread > 0 ? `${projUnread} new · ${totalCount}` : totalCount}
                    </span>
                  </button>
                )}
                {!collapsed && sg.entries.map((entry) => (
                  <InboxRow
                    key={entry.id}
                    entry={entry}
                    active={entry.id === selectedId}
                    unread={!readIds[entry.id]}
                    kept={!!keptIds[entry.id]}
                    pendingQuestion={hasPendingQuestion(entry, answeredIds)}
                    onClick={() => selectAndRead(entry.id)}
                    onContextMenu={(e) => openRowMenu(e, entry)}
                  />
                ))}
                {/* Folded NOISE sections — one collapsible header per category
                    (Agent closed, Scheduled, Paused, …), in registry order. Each
                    keeps high-volume recurring notices out of the signal list.
                    Adding a new folded category is data-driven — see
                    `feedCategories.ts` + `inboxGrouping.ts`; nothing to edit here. */}
                {!collapsed &&
                  sg.groupedSections.map((section) => (
                    <FoldedSection
                      key={section.category}
                      section={section}
                      expanded={expandedSectionKeys.has(
                        groupedSectionKey(bucket, sg.projectId, section.category)
                      )}
                      onToggle={() =>
                        toggleSection(groupedSectionKey(bucket, sg.projectId, section.category))
                      }
                      selectedId={selectedId}
                      readIds={readIds}
                      keptIds={keptIds}
                      answeredIds={answeredIds}
                      onSelect={selectAndRead}
                      onRowContextMenu={openRowMenu}
                    />
                  ))}
              </div>
            );
          })}
        </div>
      ))}
      {rowMenu && (
        <InboxRowMenu
          entry={rowMenu.entry}
          anchor={{ x: rowMenu.x, y: rowMenu.y }}
          read={!!readIds[rowMenu.entry.id]}
          kept={!!keptIds[rowMenu.entry.id]}
          onClose={() => setRowMenu(null)}
          onOpen={() => selectAndRead(rowMenu.entry.id)}
          onToggleRead={() =>
            readIds[rowMenu.entry.id]
              ? markUnread(rowMenu.entry.id)
              : markRead(rowMenu.entry.id)
          }
          onToggleKeep={() => toggleInboxKeep(rowMenu.entry.id)}
          onDelete={() => void deleteInboxEntry(rowMenu.entry.id)}
        />
      )}
    </div>
  );
}

/**
 * The right-click context menu for a single inbox row — Open, mark read/unread,
 * Keep/Unkeep (star), and Delete. Mirrors the app's other list menus (Projects,
 * Agents): rendered inline as `position: fixed` (shared `.tab-context-menu`
 * styling) and anchored to the cursor so it escapes the list's scroll/clip.
 * Positioning + outside-click/Escape/scroll close are self-contained here.
 */
function InboxRowMenu({
  entry,
  anchor,
  read,
  kept,
  onClose,
  onOpen,
  onToggleRead,
  onToggleKeep,
  onDelete
}: {
  entry: InboxEntry;
  anchor: { x: number; y: number };
  read: boolean;
  kept: boolean;
  onClose: () => void;
  onOpen: () => void;
  onToggleRead: () => void;
  onToggleKeep: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close on any outside click / Escape / scroll (a fixed menu doesn't follow
  // the list as it scrolls, so dismiss rather than let it drift).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  // Clamp the fixed menu into the viewport once it has measured its own size.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const PAD = 8;
    const rect = el.getBoundingClientRect();
    let left = anchor.x;
    let top = anchor.y;
    if (left + rect.width > window.innerWidth - PAD) {
      left = Math.max(PAD, window.innerWidth - rect.width - PAD);
    }
    if (top + rect.height > window.innerHeight - PAD) {
      top = Math.max(PAD, window.innerHeight - rect.height - PAD);
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [anchor]);

  return (
    <div
      ref={menuRef}
      className="tab-context-menu"
      role="menu"
      aria-label={`Actions for ${rowTitle(entry)}`}
      style={{ top: anchor.y, left: anchor.x }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button role="menuitem" onClick={() => { onClose(); onOpen(); }}>
        <MailOpen size={13} /> Open
      </button>
      <button role="menuitem" onClick={() => { onClose(); onToggleRead(); }}>
        {read ? <><Circle size={13} /> Mark unread</> : <><Check size={13} /> Mark read</>}
      </button>
      <button role="menuitem" onClick={() => { onClose(); onToggleKeep(); }}>
        {kept ? <><StarOff size={13} /> Remove keep</> : <><Star size={13} /> Keep</>}
      </button>
      <div className="tab-context-sep" />
      <button
        role="menuitem"
        className="tab-context-danger"
        onClick={() => { onClose(); onDelete(); }}
      >
        <Trash2 size={13} /> Delete
      </button>
    </div>
  );
}

/**
 * One collapsible folded section of NOISE (agent-closed, scheduled, heartbeat,
 * …). Generic over the {@link GroupedSection} the grouping engine produced — the
 * label + icon come from the feed-category registry, so a new folded category
 * needs no new markup. Reuses the `inbox-scheduled-*` CSS classes (kept generic
 * even though the "Scheduled" name is historical) so all folded sections share
 * one visual treatment.
 */
function FoldedSection({
  section,
  expanded,
  onToggle,
  selectedId,
  readIds,
  keptIds,
  answeredIds,
  onSelect,
  onRowContextMenu
}: {
  section: GroupedSection;
  expanded: boolean;
  onToggle: () => void;
  selectedId: string | null;
  readIds: Record<string, boolean>;
  keptIds: Record<string, boolean>;
  answeredIds: Record<string, true>;
  onSelect: (id: string) => void;
  onRowContextMenu: (e: ReactMouseEvent, entry: InboxEntry) => void;
}) {
  const Icon = sectionIcon(section.icon);
  const count = section.entries.length;
  const unread = section.entries.filter((e) => !readIds[e.id]).length;
  return (
    <div className="inbox-scheduled-group">
      <button
        type="button"
        className={`inbox-scheduled-head ${expanded ? 'expanded' : ''}`}
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <ChevronRight size={12} className="inbox-scheduled-chevron" aria-hidden />
        <Icon size={12} aria-hidden />
        <span className="inbox-scheduled-label">{section.label}</span>
        <span className="inbox-scheduled-count">
          {unread > 0 ? `${unread} new · ${count}` : count}
        </span>
      </button>
      {expanded &&
        section.entries.map((entry) => (
          <InboxRow
            key={entry.id}
            entry={entry}
            active={entry.id === selectedId}
            unread={!readIds[entry.id]}
            kept={!!keptIds[entry.id]}
            pendingQuestion={hasPendingQuestion(entry, answeredIds)}
            onClick={() => onSelect(entry.id)}
            onContextMenu={(e) => onRowContextMenu(e, entry)}
            indented
          />
        ))}
    </div>
  );
}

/**
 * A single row in the pinned "Needs your answer" section. Unlike {@link InboxRow}
 * it ALWAYS shows the question title + its context line (author intent, else the
 * session task title) + the project it came from, because this section is the
 * cross-project triage surface — the user is choosing which question to answer,
 * so the "what was this trying to do" context is the whole point.
 */
function QuestionPinnedRow({
  entry,
  projectName,
  projectColor,
  active,
  unread,
  onClick,
  onContextMenu
}: {
  entry: InboxEntry;
  projectName: string;
  projectColor?: string;
  active: boolean;
  unread: boolean;
  onClick: () => void;
  onContextMenu?: (e: ReactMouseEvent) => void;
}) {
  const context = inboxContextLine(entry);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={`inbox-question-row ${active ? 'active' : ''} ${unread ? 'unread' : ''}`}
    >
      <div className="inbox-question-row-line1">
        <HelpCircle size={12} strokeWidth={2.5} className="inbox-question-row-icon" aria-hidden />
        <span className="inbox-question-row-title">{inboxPrimaryTitle(entry)}</span>
      </div>
      {context && <div className="inbox-question-row-context">{context}</div>}
      <div className="inbox-question-row-meta">
        <span
          className={`inbox-project-dot ${projectColor ? '' : 'inbox-project-dot--none'}`}
          style={projectColor ? { background: projectColor } : undefined}
          aria-hidden
        />
        <span className="inbox-question-row-project">{projectName}</span>
      </div>
    </div>
  );
}

function InboxRow({
  entry,
  active,
  unread,
  kept = false,
  pendingQuestion = false,
  onClick,
  onContextMenu,
  indented = false,
  projectName,
  projectColor
}: {
  entry: InboxEntry;
  active: boolean;
  unread: boolean;
  /** Flagged "Keep" — shows a star and is protected from Clear inbox. */
  kept?: boolean;
  /** Carries an unanswered `inbox_ask` question — flagged so it's easy to spot. */
  pendingQuestion?: boolean;
  onClick: () => void;
  /** Right-click → open the row context menu at the cursor. */
  onContextMenu?: (e: ReactMouseEvent) => void;
  /** Extra left padding for rows nested under the Scheduled section. */
  indented?: boolean;
  /** TIME view only: project dot + name prefix (there's no per-project header). */
  projectName?: string;
  projectColor?: string;
}) {
  // Noise reduction: keep rows single-line by default and reveal the
  // second-line preview only for UNREAD rows (its purpose is surfacing
  // not-yet-read context). Selecting a row deliberately does NOT expand it —
  // the full content is already in the detail pane, so growing the selected
  // row to two lines is redundant and makes it jump in size on click.
  const subtitle = rowSubtitle(entry);
  const showSubtitle = Boolean(subtitle) && unread;
  const showMeta = active || unread;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={`inbox-row ${active ? 'active' : ''} ${unread ? 'unread' : ''} ${indented ? 'indented' : ''} ${kept ? 'kept' : ''}`}
    >
      <div className="inbox-row-line1">
        <span aria-hidden className={`inbox-row-dot ${unread ? 'on' : ''}`} />
        {/* Timestamp leads every row (always shown, fixed-width) so the flat
            cross-project stream is scannable by recency without hunting the
            far right edge of a truncated title. */}
        <span className="inbox-row-ts">{formatRelative(entry.ts)}</span>
        {/* TIME view: project dot + name prefix so a flat cross-project stream
            stays attributable without a per-project header. */}
        {projectName && (
          <span className="inbox-row-project" title={projectName}>
            <span
              className={`inbox-project-dot ${projectColor ? '' : 'inbox-project-dot--none'}`}
              style={projectColor ? { background: projectColor } : undefined}
              aria-hidden
            />
            <span className="inbox-row-project-name">{projectName}</span>
          </span>
        )}
        {pendingQuestion && (
          <HelpCircle
            size={12}
            className="inbox-row-question-icon"
            strokeWidth={2.5}
            aria-label="Needs your answer"
          />
        )}
        {/* Row heading: the originating agent's task label ("Analyze cmux for
            ZCC") so the list is navigable by task, not by the first line of the
            comment. Falls back to the comment preview when no title was
            captured (legacy entries, non-titled sessions). */}
        <span className="inbox-row-title">{rowTitle(entry)}</span>
        {/* Report badge — an explicitly-flagged deliverable stands apart from a
            routine status ping while scanning the mixed feed. */}
        {isReport(entry) && (
          <span className="inbox-row-report-badge" title="Report — a finished deliverable">
            <FileText size={10} strokeWidth={2.5} aria-hidden />
            Report
          </span>
        )}
        {showMeta && (entry.occurrences ?? 1) > 1 && (
          <span
            className="inbox-row-occurrences"
            title={`${entry.occurrences} occurrences — repeats coalesced into one entry`}
          >
            ×{entry.occurrences}
          </span>
        )}
        {kept && (
          <Star
            size={11}
            className="inbox-row-keep-star"
            fill="currentColor"
            strokeWidth={0}
            aria-label="Kept"
          />
        )}
      </div>
      {/* Secondary line: the comment preview, shown only when it adds something
          beyond the title (i.e. we actually have a distinct title above). */}
      {showSubtitle && (
        <div className="inbox-row-line2">
          <span className="inbox-row-preview-inline">{subtitle}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Row heading — what the row is "about". Fallback chain:
 *   1. the author-set {@link InboxEntry.subject} (a deliberate headline), then
 *   2. the snapshotted {@link InboxOrigin.title} (the OSC/LLM session task
 *      label captured at push time), then
 *   3. the comment/doc preview (legacy entries, project-scoped pushes, or
 *      untitled sessions with no subject).
 * Preferring the author-set subject is the whole point: a producer with no
 * session title (scheduler / goal / updater notices) no longer leaks its raw
 * message body into the heading.
 */
export function rowTitle(entry: InboxEntry): string {
  return inboxPrimaryTitle(entry);
}

/**
 * Secondary preview line — the comment/doc preview, shown ONLY when a distinct
 * heading (subject or session title) occupies line 1 (else it'd duplicate the
 * heading). Comparing against {@link rowTitle} is the correct dedupe regardless
 * of which heading source won: when neither a subject nor a session title
 * exists, rowTitle collapses to the preview and this returns '' (single-line
 * row). Empty string ⇒ the row stays single-line.
 */
function rowSubtitle(entry: InboxEntry): string {
  return inboxSecondaryLine(entry);
}

/**
 * True when an entry carries a structured `inbox_ask` question the user hasn't
 * answered/skipped yet — the signal for the row's "needs your answer" flag. An
 * answered entry drops the flag (mirrors the detail pane's collapsed state), so
 * the sidebar highlights only what's still waiting on the user.
 */
function hasPendingQuestion(
  entry: InboxEntry,
  answeredIds: Record<string, true>
): boolean {
  return inboxQuestions(entry).length > 0 && !answeredIds[entry.id];
}

/**
 * Build the second-line preview text for a sidebar row.
 * - If comments: first non-empty line, leading markdown markers stripped.
 * - Else first doc's path with "+N more" suffix when relevant.
 * - Else empty (shouldn't happen — store rejects entries with neither).
 */
function previewFor(entry: InboxEntry): string {
  return inboxPreview(entry);
}

export function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}
