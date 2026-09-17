import { useMemo } from 'react';
import { Bell, FileText, HelpCircle, Target, type LucideIcon } from 'lucide-react';
import type { InboxEntry } from '@zana-ai/zcc-domain/product';
import { useData, useInbox, useInboxRead, useUi, useInboxScopeProjectId } from '../store.js';
import { classifyEntry, FEED_CATEGORIES, type FeedCategoryId } from '@zana-ai/zcc-domain/feed-categories';
import { inboxPrimaryTitle, inboxSecondaryLine } from '../lib/inboxPresentation.js';
import { focusInboxEntry } from '../lib/inboxNavigation.js';
import { QuickAccessPanel } from './QuickAccessPanel.js';

/**
 * Quick-glance list of unread Inbox entries in the shared right panel —
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
    const unread = scoped.filter((e) => isDrawerWorthy(e, readIds)).sort((a, b) => b.ts - a.ts);
    const worthy = unread.slice(0, DRAWER_MAX_ENTRIES);
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
      total: unread.length,
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

  const scopeName = scopeProjectId ? projects.find((p) => p.id === scopeProjectId)?.name ?? 'This project' : 'All projects';

  return (
    <QuickAccessPanel kind="notifications" summary={`${sections.total} unread · ${scopeName}`}
      footer={sections.total > total ? `View all in Inbox · showing ${total} of ${sections.total}` : 'View all in Inbox'}
      onViewAll={goToInbox}>
      {total === 0 ? (
        <div className="quick-access-empty">
          <span className="quick-access-empty-icon"><Bell size={22} aria-hidden="true" /></span>
          <h3>You&rsquo;re all caught up</h3>
          <p>New questions and updates will appear here.</p>
        </div>
      ) : (
        <div className="quick-access-list">
          {sections.list.map((section) => {
            const Icon = sectionIcon(section.id);
            return (
              <section key={section.id} className="quick-access-section" data-urgent={section.id === 'question'}
                aria-labelledby={`notification-section-${section.id}`}>
                <h3 className="quick-access-section-heading" id={`notification-section-${section.id}`}>
                  {section.label}<span className="quick-access-section-count">{section.entries.length}</span>
                </h3>
                {section.entries.map((entry) => {
                  const project = projects.find((p) => p.id === entry.projectId);
                  const projectName = project?.name ?? entry.projectLabel ?? entry.projectId;
                  const title = inboxPrimaryTitle(entry);
                  const secondary = inboxSecondaryLine(entry);
                  return (
                    <button type="button" key={entry.id} className="quick-access-row notifications-drawer-row"
                      onClick={() => openEntry(entry)} title={`${title} — ${projectName}`}>
                      <Icon size={16} className="quick-access-row-icon" aria-hidden="true" />
                      <span className="quick-access-row-text">
                        <span className="quick-access-row-title">{title}</span>
                        {secondary && <span className="quick-access-row-preview">{secondary}</span>}
                        <span className="quick-access-row-meta">
                          <span className="quick-access-row-project">{projectName}</span>
                          <time dateTime={new Date(entry.ts).toISOString()} title={new Date(entry.ts).toLocaleString()}>
                            {new Date(entry.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </time>
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
    </QuickAccessPanel>
  );
}
