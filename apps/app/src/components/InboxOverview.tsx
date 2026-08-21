import { useMemo } from 'react';
import {
  FileText,
  HelpCircle,
  Lightbulb,
  Target,
  ChevronRight,
  type LucideIcon
} from 'lucide-react';
import { inboxQuestions, type InboxEntry, type LibraryDoc } from '@zana-ai/zcc-domain/product';
import {
  useData,
  useInboxAnswered,
  useInboxSelection,
  useLibrary,
  useUi
} from '../store.js';
import { classifyEntry, isReport } from '@zana-ai/zcc-domain/feed-categories';
import { InboxSummaryCard } from './InboxSummaryCard.js';
import { formatRelative } from './InboxSidebar.js';
import { inboxPrimaryTitle, inboxContextLine } from '../lib/inboxPresentation.js';

/**
 * Inbox Overview — the detail-column LANDING PAGE shown when no entry is
 * selected (see `InboxView`). It lifts the AI summary out of the narrow list
 * column (where it was crowding the scannable feed) and pairs it with a set of
 * category rollups projected over the SAME data the feed already classifies:
 *
 *   • Questions ⚠  — pending `inbox_ask` entries awaiting the user
 *   • Reports  📄  — agent reports / free-form status (the `report` category)
 *   • Goals    🎯  — goal outcomes (the `goal` category)
 *   • Ideas    💡  — library docs tagged `idea` (the real ideas store; ideas
 *                    are NOT inbox entries, so this rollup reads `useLibrary`)
 *
 * Scope follows the shell exactly like the feed and the summary card: when
 * drilled into a project (`scopeProjectId` set) every rollup is scoped to that
 * project; at the top level it's cross-project. No new state / IPC — this is a
 * pure projection over `entries` (already scoped by the caller) + the library.
 *
 * Clicking a Question/Report/Goal row selects that inbox entry (the detail
 * column swaps to its preview). Clicking an Idea row jumps to the Library view.
 */
const ROLLUP_MAX_ROWS = 5;

export function InboxOverview({
  scopeProjectId,
  entries
}: {
  scopeProjectId: string | null;
  entries: InboxEntry[];
}) {
  const select = useInboxSelection((s) => s.select);
  const answeredIds = useInboxAnswered((s) => s.answeredIds);
  const libraryDocs = useLibrary((s) => s.docs);

  // Opening an idea = deep-linking into a project's Library view, scrolled to
  // that doc. Library is project-scoped (no top-level global library mode), so
  // we pick a host project in priority order and NEVER hard-fail on a missing
  // original project: prefer the doc's owning project, then inbox scope, then
  // selected project, then any registered project.
  const openIdea = async (doc: LibraryDoc) => {
    const ui = useUi.getState();
    const projects = useData.getState().projects;
    const target =
      (doc.projectId ? projects.find((p) => p.id === doc.projectId) : undefined) ??
      (scopeProjectId ? projects.find((p) => p.id === scopeProjectId) : undefined) ??
      (ui.selectedProjectId ? projects.find((p) => p.id === ui.selectedProjectId) : undefined) ??
      projects[0];
    if (target) {
      ui.revealLibraryDoc(target.id, doc.id);
      return;
    }
    // No project available: still open the doc itself so ideas remain viewable.
    const abs = doc.absPath;
    if (!abs) {
      ui.pushToast('Idea file path is unavailable.', 'error');
      return;
    }
    try {
      const opened = await window.cc.openers.openIn('cursor', abs);
      if (opened.ok) return;
      // Fallback to Finder when Cursor opener is unavailable on this machine.
      const finder = await window.cc.openers.openIn('finder', abs);
      if (!finder.ok) {
        ui.pushToast(opened.message || finder.message || 'Failed to open idea file.', 'error');
      }
    } catch (err) {
      ui.pushToast(`Failed to open idea file: ${err}`, 'error');
    }
  };

  // Bucket the already-scoped entries by feed category. Questions are further
  // narrowed to those still awaiting an answer (an answered ask drops out, same
  // signal the sidebar's pending-question flag uses).
  const { questions, reports, goals } = useMemo(() => {
    const questions: InboxEntry[] = [];
    const reports: InboxEntry[] = [];
    const goals: InboxEntry[] = [];
    for (const e of entries) {
      const cat = classifyEntry(e);
      if (cat === 'question') {
        if (inboxQuestions(e).length > 0 && !answeredIds[e.id]) questions.push(e);
      } else if (cat === 'goal') {
        goals.push(e);
      } else if (cat === 'report') {
        reports.push(e);
      }
      // grouped/noise categories (agent-closed, scheduled, heartbeat, …) are
      // deliberately omitted — the Overview surfaces signal, not folded noise.
    }
    // Newest-first within each rollup (entries arrive newest-first already, but
    // don't rely on caller order).
    const byTs = (a: InboxEntry, b: InboxEntry) => b.ts - a.ts;
    // Reports rollup: surface explicitly-flagged deliverables FIRST (then by
    // recency), so a `report: true` push leads over routine fallback statuses
    // that also classify as the `report` feed category.
    const byReportThenTs = (a: InboxEntry, b: InboxEntry) => {
      const ra = isReport(a) ? 1 : 0;
      const rb = isReport(b) ? 1 : 0;
      if (ra !== rb) return rb - ra;
      return b.ts - a.ts;
    };
    return {
      questions: questions.sort(byTs),
      reports: reports.sort(byReportThenTs),
      goals: goals.sort(byTs)
    };
  }, [entries, answeredIds]);

  // Ideas live in the library (tagged `idea`), not the inbox. Scope by project
  // when drilled in; at the top level show every idea (global + all projects).
  const ideas = useMemo(() => {
    const tagged = libraryDocs.filter((d) => d.tags?.includes('idea'));
    const scoped = scopeProjectId
      ? tagged.filter((d) => d.projectId === scopeProjectId)
      : tagged;
    return [...scoped].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [libraryDocs, scopeProjectId]);

  const nothing =
    questions.length === 0 &&
    reports.length === 0 &&
    goals.length === 0 &&
    ideas.length === 0;

  return (
    <div className="inbox-overview">
      <InboxSummaryCard scopeProjectId={scopeProjectId} entries={entries} />

      <Rollup
        icon={HelpCircle}
        tone="question"
        label="Questions"
        hint="need your answer"
        count={questions.length}
      >
        {questions.slice(0, ROLLUP_MAX_ROWS).map((e) => (
          <OverviewRow
            key={e.id}
            title={inboxPrimaryTitle(e)}
            context={inboxContextLine(e)}
            when={formatRelative(e.ts)}
            onClick={() => select(e.id)}
          />
        ))}
      </Rollup>

      <Rollup icon={FileText} tone="report" label="Reports" count={reports.length}>
        {reports.slice(0, ROLLUP_MAX_ROWS).map((e) => (
          <OverviewRow
            key={e.id}
            title={inboxPrimaryTitle(e)}
            when={formatRelative(e.ts)}
            onClick={() => select(e.id)}
          />
        ))}
      </Rollup>

      <Rollup icon={Lightbulb} tone="idea" label="Ideas" count={ideas.length}>
        {ideas.slice(0, ROLLUP_MAX_ROWS).map((d) => (
          <OverviewRow
            key={d.id}
            title={ideaTitle(d)}
            when={formatRelative(d.updatedAt)}
            onClick={() => { void openIdea(d); }}
          />
        ))}
      </Rollup>

      <Rollup icon={Target} tone="goal" label="Goals" count={goals.length}>
        {goals.slice(0, ROLLUP_MAX_ROWS).map((e) => (
          <OverviewRow
            key={e.id}
            title={inboxPrimaryTitle(e)}
            when={formatRelative(e.ts)}
            onClick={() => select(e.id)}
          />
        ))}
      </Rollup>

      {nothing && (
        <div className="inbox-overview-empty">
          Nothing to surface yet — questions, reports, goals, and captured ideas
          will appear here as your projects work.
        </div>
      )}
    </div>
  );
}

/**
 * One category rollup section. Renders nothing when empty (an empty category is
 * silent, not a zero-count placeholder). A `count` above the shown rows exposes
 * how many were elided via the "+N more" footer.
 */
function Rollup({
  icon: Icon,
  tone,
  label,
  hint,
  count,
  children
}: {
  icon: LucideIcon;
  tone: 'question' | 'report' | 'idea' | 'goal';
  label: string;
  hint?: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  const more = count - ROLLUP_MAX_ROWS;
  return (
    <section className={`inbox-overview-rollup tone-${tone}`}>
      <div className="inbox-overview-rollup-head">
        <Icon size={13} className="inbox-overview-rollup-icon" aria-hidden />
        <span className="inbox-overview-rollup-label">{label}</span>
        <span className="inbox-overview-rollup-count">
          {count}
          {hint && count > 0 ? ` ${hint}` : ''}
        </span>
      </div>
      <div className="inbox-overview-rollup-rows">{children}</div>
      {more > 0 && (
        <div className="inbox-overview-rollup-more">+{more} more</div>
      )}
    </section>
  );
}

function OverviewRow({
  title,
  context,
  when,
  onClick
}: {
  title: string;
  /** Optional one-line context ("what this is trying to achieve"), shown under the title. */
  context?: string;
  when: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="inbox-overview-row" onClick={onClick}>
      <span className="inbox-overview-row-main">
        <span className="inbox-overview-row-title">{title}</span>
        {context && <span className="inbox-overview-row-context">{context}</span>}
      </span>
      <span className="inbox-overview-row-ts">{when}</span>
      <ChevronRight size={12} className="inbox-overview-row-arrow" aria-hidden />
    </button>
  );
}

/** An idea library doc's display heading — its title, else its relPath tail. */
function ideaTitle(doc: LibraryDoc): string {
  const t = doc.title?.trim();
  if (t) return t;
  const tail = doc.relPath.split('/').pop() ?? doc.relPath;
  return tail;
}
