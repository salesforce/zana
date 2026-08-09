import { useMemo } from 'react';
import { useInbox, useInboxScopeProjectId, useInboxSelection, useUi } from '../store';
import { InboxDetail } from './InboxDetail';
import { InboxOverview } from './InboxOverview';
import { SavedDetail } from './SavedDetail';

/**
 * Inbox detail surface mounted in the app shell's main column when
 * nav==='inbox'. The list lives in `ListPane`'s inbox branch alongside
 * the existing Projects/Settings list panes, so the two-pane layout
 * (sidebar list + detail) reuses the existing 3-column app grid
 * (nav | list | main).
 *
 * The inbox has three tabs (`inboxTab`): the live Feed, the Reports filter
 * (entries flagged `report: true`), and the durable Saved reports. Feed and
 * Reports share the same detail pane (they differ only in which rows the list
 * shows); Saved has its own. Each is gated on visibility so keyboard shortcuts
 * (Delete) only fire for the tab actually on screen.
 *
 * Feed / Reports tab, detail column:
 *   • nothing selected → the Inbox OVERVIEW (AI summary + Questions / Reports /
 *     Ideas / Goals rollups) as the landing page. The AI summary used to live
 *     atop the narrow list column; it moved here so the list is a pure feed.
 *   • an entry selected → that entry's `InboxDetail` preview.
 */
export function InboxView() {
  const nav = useUi((s) => s.nav);
  const inboxTab = useUi((s) => s.inboxTab);
  const active = nav === 'inbox';
  const showingSaved = inboxTab === 'saved';
  const selectedId = useInboxSelection((s) => s.selectedEntryId);

  // Same scoped slice the list column computes, so the Overview's rollups and
  // AI summary agree with what the feed shows (home = all projects, drilled-in
  // = that project).
  const allEntries = useInbox((s) => s.entries);
  const scopeProjectId = useInboxScopeProjectId();
  const entries = useMemo(
    () => (scopeProjectId ? allEntries.filter((e) => e.projectId === scopeProjectId) : allEntries),
    [allEntries, scopeProjectId]
  );

  return (
    <section className="inbox-view">
      {showingSaved ? (
        <SavedDetail visible={active} />
      ) : selectedId ? (
        <InboxDetail visible={active} />
      ) : (
        <InboxOverview scopeProjectId={scopeProjectId} entries={entries} />
      )}
    </section>
  );
}
