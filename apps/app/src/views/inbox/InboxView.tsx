import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useInbox, useInboxScopeProjectId, useInboxSelection, useSavedSelection, useSaved, useUi } from '@/store';
import { useCompactLayout } from '@/hooks/useCompactLayout';
import { InboxDetail } from '@/components/InboxDetail';
import { InboxOverview } from '@/components/InboxOverview';
import { InboxPane } from '@/components/listpane/InboxPane';
import { SavedDetail } from '@/components/SavedDetail';
import { useBooleanPreference } from '@/lib/use-boolean-preference';
import './inbox-feed.css';

const FULL_WIDTH_INBOX_KEY = 'zcc.inbox.fullWidth';

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
  const [preferFullWidth, setPreferFullWidth] = useBooleanPreference(FULL_WIDTH_INBOX_KEY, true);
  const toolbarLayout = preferFullWidth ? 'wide' : 'split';
  const fullWidth = preferFullWidth && !showingSaved;
  const singlePane = compact || fullWidth;
  const [overviewOpen, setOverviewOpen] = useState(false);
  const root = useRef<HTMLElement>(null);
  const listFocus = useRef<HTMLElement | null>(null);
  const detailWasOpen = useRef(false);

  // Same scoped slice the list column computes, so the landing's questions and
  // AI summary agree with what the feed shows (home = all projects, drilled-in
  // = that project).
  const allEntries = useInbox((s) => s.entries);
  const scopeProjectId = useInboxScopeProjectId();
  const entries = useMemo(
    () => (scopeProjectId ? allEntries.filter((e) => e.projectId === scopeProjectId) : allEntries),
    [allEntries, scopeProjectId]
  );
  // Same predicate the sidebar's effect uses to drop a stale selection, computed during render so an
  // out-of-scope or deleted entry never paints before that effect clears the store.
  const selectionInScope = !!selectedId && entries.some((entry) => entry.id === selectedId);
  const detailOpen = showingSaved
    ? savedRecords.some((record) => record.id === savedId && (!scopeProjectId || record.projectId === scopeProjectId))
    : entries.some((entry) => entry.id === selectedId) || overviewOpen;
  const detailVisible = active && (!singlePane || detailOpen);
  const detailKey = showingSaved ? savedId : selectedId;

  useLayoutEffect(() => {
    if (!singlePane || !active) return;
    if (detailOpen) {
      const detail = root.current?.querySelector('.inbox-view-detail');
      if (detail) detail.scrollTop = 0;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.closest('.inbox-list-pane, .inbox-pane-toolbar')) {
        listFocus.current = focused;
      }
      root.current?.querySelector<HTMLButtonElement>('.inbox-mobile-back, .inbox-detail-overview-back')?.focus();
    } else if (detailWasOpen.current) {
      const target = listFocus.current?.isConnected ? listFocus.current
        : root.current?.querySelector<HTMLElement>('.inbox-tab[aria-selected="true"]');
      target?.focus();
      listFocus.current = null;
    }
    detailWasOpen.current = detailOpen;
  }, [singlePane, active, detailOpen, detailKey]);

  function backToList() {
    setOverviewOpen(false);
    if (showingSaved) selectSaved(null);
    else select(null);
  }

  return (
    <section ref={root} className="inbox-view panel-body--full" data-compact={compact} data-full-width={fullWidth} data-toolbar-layout={toolbarLayout} data-detail-open={detailOpen}>
      <InboxPane
        toolbarLayout={toolbarLayout}
        fullWidth={fullWidth}
        onChangeLayout={(wide) => {
          if (wide === preferFullWidth) return;
          if (wide) backToList();
          setPreferFullWidth(wide);
        }}
        mobileHeaderEnabled={active && !detailOpen}
        onShowOverview={singlePane ? () => { select(null); setOverviewOpen(true); } : undefined}
      />
      <div className="inbox-view-detail">
        {singlePane && (showingSaved || !selectionInScope) && (
          <button type="button" className="inbox-mobile-back" onClick={backToList}>
            <ArrowLeft size={16} aria-hidden />
            {showingSaved ? 'Saved reports' : fullWidth ? 'Back to Feed' : 'Inbox'}
          </button>
        )}
        {showingSaved ? (
          <SavedDetail visible={detailVisible} />
        ) : selectionInScope ? (
          <InboxDetail visible={detailVisible} onBack={singlePane ? backToList : undefined} />
        ) : (!fullWidth || overviewOpen) && (
          <InboxOverview scopeProjectId={scopeProjectId} entries={entries} />
        )}
      </div>
    </section>
  );
}
