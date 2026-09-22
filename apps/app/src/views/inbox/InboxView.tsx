import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useInbox, useInboxScopeProjectId, useInboxSelection, useSavedSelection, useSaved, useUi } from '@/store';
import { useCompactLayout } from '@/hooks/useCompactLayout';
import { InboxDetail } from '@/components/InboxDetail';
import { InboxOverview } from '@/components/InboxOverview';
import { InboxPane } from '@/components/listpane/InboxPane';
import { SavedDetail } from '@/components/SavedDetail';

/**
 * Inbox surface: the feed list and the detail column live together as an
 * internal grid. The shell is always nav + full content, so this panel owns
 * any list/detail chrome rather than borrowing a middle ListPane column.
 *
 * Two tabs (`inboxTab`): the live Feed and the durable Saved reports. Flagged
 * deliverables (`report: true`) are a Feed filter, not a third tab. Feed and
 * Saved each have their own detail pane. Each is gated on visibility so
 * keyboard shortcuts (Delete) only fire for the tab actually on screen.
 *
 * Feed tab, detail column:
 *   • nothing selected → the attention landing (pending questions + AI summary).
 *   • an entry selected → that entry's `InboxDetail` preview.
 */
export function InboxView() {
  const nav = useUi((s) => s.nav);
  const inboxTab = useUi((s) => s.inboxTab);
  const active = nav === 'inbox';
  const showingSaved = inboxTab === 'saved';
  const selectedId = useInboxSelection((s) => s.selectedEntryId);
  const select = useInboxSelection((s) => s.select);
  const savedId = useSavedSelection((s) => s.selectedSavedId);
  const selectSaved = useSavedSelection((s) => s.selectSaved);
  const savedRecords = useSaved((s) => s.records);
  const compact = useCompactLayout();
  const [overviewOpen, setOverviewOpen] = useState(false);
  const root = useRef<HTMLElement>(null);
  const listFocus = useRef<HTMLElement | null>(null);

  // Same scoped slice the list column computes, so the landing's questions and
  // AI summary agree with what the feed shows (home = all projects, drilled-in
  // = that project).
  const allEntries = useInbox((s) => s.entries);
  const scopeProjectId = useInboxScopeProjectId();
  const entries = useMemo(
    () => (scopeProjectId ? allEntries.filter((e) => e.projectId === scopeProjectId) : allEntries),
    [allEntries, scopeProjectId]
  );
  const detailOpen = showingSaved
    ? savedRecords.some((record) => record.id === savedId && (!scopeProjectId || record.projectId === scopeProjectId))
    : entries.some((entry) => entry.id === selectedId) || overviewOpen;
  const detailVisible = active && (!compact || detailOpen);
  const detailKey = showingSaved ? savedId : selectedId;

  useLayoutEffect(() => {
    if (!compact || !active) return;
    if (detailOpen) {
      const detail = root.current?.querySelector('.inbox-view-detail');
      if (detail) detail.scrollTop = 0;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.closest('.inbox-list-pane')) listFocus.current = focused;
      root.current?.querySelector<HTMLButtonElement>('.inbox-mobile-back, .inbox-detail-overview-back')?.focus();
    } else if (listFocus.current?.isConnected) {
      listFocus.current.focus();
    }
  }, [compact, active, detailOpen, detailKey]);

  function backToList() {
    setOverviewOpen(false);
    if (showingSaved) selectSaved(null);
    else select(null);
  }

  return (
    <section ref={root} className="inbox-view panel-body--full" data-compact={compact} data-detail-open={detailOpen}>
      <InboxPane onShowOverview={compact ? () => { select(null); setOverviewOpen(true); } : undefined} />
      <div className="inbox-view-detail">
        {compact && (showingSaved || !selectedId) && (
          <button type="button" className="inbox-mobile-back" onClick={backToList}>
            <ArrowLeft size={16} aria-hidden />
            {showingSaved ? 'Saved reports' : 'Inbox'}
          </button>
        )}
        {showingSaved ? (
          <SavedDetail visible={detailVisible} />
        ) : selectedId ? (
          <InboxDetail visible={detailVisible} onBack={compact ? backToList : undefined} />
        ) : (
          <InboxOverview scopeProjectId={scopeProjectId} entries={entries} />
        )}
      </div>
    </section>
  );
}
