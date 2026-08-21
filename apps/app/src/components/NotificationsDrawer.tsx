import { useMemo } from 'react';
import { Bell, FileText, HelpCircle, Target, X, type LucideIcon } from 'lucide-react';
import type { InboxEntry } from '@zana-ai/zcc-domain/product';
import { useData, useInbox, useInboxRead, useUi, useInboxScopeProjectId } from '../store.js';
import { classifyEntry, FEED_CATEGORIES, type FeedCategoryId } from '@zana-ai/zcc-domain/feed-categories';
import { inboxPrimaryTitle, inboxSecondaryLine } from '../lib/inboxPresentation.js';
import { focusInboxEntry } from '../lib/inboxNavigation.js';

/**
 * Right-edge slide-over quick-glance list of recent/unread Inbox entries —
 * the structural twin of {@link FavoriteAgentsDrawer}. Opened from the
 * titlebar bell ({@link useUi.toggleNotificationsDrawer}), which used to
 * navigate straight to the full Inbox nav route; that route is unchanged and
 * remains the deep "view all / triage" destination (reachable via the footer
 * link below).
 *
 * Shows only entries worth a quick glance: unread questions/reports (the
 * SIGNAL categories, per `feedCategories.ts`) plus any unread entry stamped
 * `notify: 'loud'` regardless of category — so a loud extension-pushed entry
 * always surfaces here even if it would otherwise classify as noise. Capped
 * at the most recent 20 qualifying entries; the full list lives in Inbox.
 */

const SECTION_ORDER: { id: FeedCategoryId | 'other'; label: string }[] = [
  { id: 'question', label: 'Needs your answer' },
  { id: 'goal', label: 'Goals' },
  { id: 'report', label: 'Reports' },
  { id: 'other', label: 'Other' }
];

const DRAWER_MAX_ENTRIES = 20;

const SECTION_ICONS: Record<string, LucideIcon> = {
  HelpCircle,
  Target,
  FileText
};

function sectionIcon(id: FeedCategoryId | 'other'): LucideIcon {
  if (id === 'other') return Bell;
  return SECTION_ICONS[FEED_CATEGORIES[id].icon ?? ''] ?? Bell;
}

function isDrawerWorthy(entry: InboxEntry, readIds: Record<string, true>): boolean {
  if (readIds[entry.id]) return false;
  if (entry.notify === 'loud') return true;
  const category = classifyEntry(entry);
  return category === 'question' || category === 'goal' || category === 'report';
}

function sectionFor(entry: InboxEntry): FeedCategoryId | 'other' {
  const category = classifyEntry(entry);
  if (category === 'question' || category === 'goal' || category === 'report') return category;
  return 'other';
}

export function NotificationsDrawer() {
  const open = useUi((s) => s.notificationsDrawerOpen);
  const setOpen = useUi((s) => s.setNotificationsDrawerOpen);
  const entries = useInbox((s) => s.entries);
  const readIds = useInboxRead((s) => s.readIds);
  const projects = useData((s) => s.projects);
  const scopeProjectId = useInboxScopeProjectId();

  const sections = useMemo(() => {
    const scoped = scopeProjectId ? entries.filter((e) => e.projectId === scopeProjectId) : entries;
    const worthy = scoped
      .filter((e) => isDrawerWorthy(e, readIds))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, DRAWER_MAX_ENTRIES);
    const byId: Record<FeedCategoryId | 'other', InboxEntry[]> = {
      question: [],
      goal: [],
      report: [],
      other: [],
      idea: [],
      'agent-closed': [],
      scheduled: [],
      heartbeat: [],
      'follow-up': [],
      routine: [],
      system: []
    };
    for (const e of worthy) byId[sectionFor(e)].push(e);
    return {
      worthy,
      list: SECTION_ORDER.filter((s) => byId[s.id].length > 0).map((s) => ({ ...s, entries: byId[s.id] }))
    };
  }, [entries, readIds, scopeProjectId]);

  if (!open) return null;

  const total = sections.worthy.length;

  const goToInbox = () => {
    setOpen(false);
    useUi.getState().setNav('inbox');
  };

  // Resolve the click destination via the shared resolver — the specific
  // entry's project + detail pane by default, or the extension's own
  // `target` surface when the entry carries one (see inboxNavigation.ts).
  const openEntry = (entry: InboxEntry) => {
    setOpen(false);
    focusInboxEntry(entry);
  };

  return (
    <aside className="notifications-drawer" aria-label="Notifications">
      <header className="notifications-drawer-header">
        <Bell size={14} className="notifications-drawer-icon" aria-hidden="true" />
        <span className="notifications-drawer-title">Notifications</span>
        <span className="notifications-drawer-count">{total}</span>
        <span className="grow" />
        <button
          className="icon-button"
          onClick={() => setOpen(false)}
          aria-label="Close notifications"
          title="Close"
        >
          <X size={16} />
        </button>
      </header>

      {total === 0 ? (
        <div className="notifications-drawer-empty">
          <Bell size={26} aria-hidden="true" />
          <h4>You&rsquo;re all caught up</h4>
          <p>Questions, reports, and loud extension notifications will show up here.</p>
        </div>
      ) : (
        <div className="notifications-drawer-list">
          {sections.list.map((section) => {
            const Icon = sectionIcon(section.id);
            return (
              <section key={section.id} className={`notifications-drawer-section section-${section.id}`}>
                <header className="notifications-drawer-section-head">
                  <span className="notifications-drawer-section-label">{section.label}</span>
                  <span className="notifications-drawer-section-count">{section.entries.length}</span>
                </header>
                {section.entries.map((entry) => {
                  const project = projects.find((p) => p.id === entry.projectId);
                  const projectName = project?.name ?? entry.projectLabel ?? entry.projectId;
                  const title = inboxPrimaryTitle(entry);
                  const secondary = inboxSecondaryLine(entry);
                  return (
                    <button
                      key={entry.id}
                      className="notifications-drawer-row"
                      onClick={() => openEntry(entry)}
                      title={`${title} — ${projectName}`}
                    >
                      <Icon size={14} className="notifications-drawer-row-icon" aria-hidden="true" />
                      <span className="notifications-drawer-row-text">
                        <span className="notifications-drawer-row-title">{title}</span>
                        <span className="notifications-drawer-row-meta">
                          {projectName}
                          {secondary ? ` · ${secondary}` : ''}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}

      <footer className="notifications-drawer-footer">
        <button className="notifications-drawer-view-all" onClick={goToInbox}>
          View all in Inbox →
        </button>
      </footer>
    </aside>
  );
}
