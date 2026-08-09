import { useMemo, useState, type ReactNode } from 'react';
import {
  Clock,
  Compass,
  Inbox as InboxIcon,
  Keyboard,
  Puzzle,
  Users,
  type LucideIcon
} from 'lucide-react';
import {
  useData,
  useUi,
  useInbox,
  useInboxSelection,
  useInboxRead,
  useUnreadInboxCount
} from '../store';
import { inboxPrimaryTitle, inboxSecondaryLine } from '../util/inboxPresentation';
import { GUIDE_CONTENT } from '../util/guidesContent';
import { AuroraGrid } from './AuroraGrid';
import { CreateExtensionDialog } from './CreateExtensionDialog';
import { GuideModal } from './GuideModal';
import { HomeAgentComposer } from './HomeAgentComposer';

interface GuideItem {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  /** Label + handler for the modal's CTA button — jumps to the real feature
   *  the article just walked through (e.g. opens the Scheduler, or the
   *  Extension Creator dialog). */
  actionLabel: string;
  onAction: () => void;
}

/**
 * Landing dashboard: the latest inbox activity and task-oriented guides,
 * read from already-hydrated stores (no new IPC), each card deep-linking into
 * the existing full views. Full-width standalone panel, same shape as
 * PersonasPanel/UsagePanel (ListPane returns null for `nav === 'home'`).
 */
export function HomePanel() {
  const inboxEntries = useInbox((s) => s.entries);
  const inboxLoading = useInbox((s) => s.loading);
  const unreadInbox = useUnreadInboxCount();
  const setNav = useUi((s) => s.setNav);
  const setInboxTab = useUi((s) => s.setInboxTab);
  const exitProjectFocus = useUi((s) => s.exitProjectFocus);
  const selectInbox = useInboxSelection((s) => s.select);
  const markInboxRead = useInboxRead((s) => s.markRead);
  const [creatingExtension, setCreatingExtension] = useState(false);
  const [openGuideId, setOpenGuideId] = useState<string | null>(null);

  const latestInbox = useMemo(
    () => [...inboxEntries].sort((a, b) => b.ts - a.ts).slice(0, 5),
    [inboxEntries]
  );

  const openInboxEntry = (id: string) => {
    // Home is a cross-project view; a lingering `focusedProjectId` from an
    // earlier drill-in would scope the Inbox to that one project, and
    // InboxSidebar's scope effect immediately clears any selection that
    // isn't in the now-filtered list — so an entry from a DIFFERENT project
    // would silently fail to open. Exit focus so the Inbox shows everything.
    exitProjectFocus();
    setNav('inbox');
    // InboxView only reads `selectedEntryId` on the 'feed' tab (the 'saved'
    // tab renders SavedDetail instead, ignoring selection) — force it so a
    // deep-link from Home can't silently land on whichever tab was last open.
    setInboxTab('feed');
    selectInbox(id);
    markInboxRead(id);
  };

  // Short, task-oriented articles — each opens a markdown how-to in a modal
  // (GuideModal), whose CTA button then jumps to the real feature/dialog the
  // article just walked through, so reading and doing are one click apart.
  const guides: GuideItem[] = [
    {
      id: 'create-extension',
      icon: Puzzle,
      title: 'Create an extension',
      description: 'Build your own panel or tool with the in-app Extension Creator.',
      actionLabel: 'Create an extension',
      onAction: () => setCreatingExtension(true)
    },
    {
      id: 'scheduler',
      icon: Clock,
      title: 'Use the Scheduler',
      description: 'Run an agent on a recurring cadence — results land in your Inbox.',
      actionLabel: 'Open Scheduler',
      onAction: () => setNav('scheduler')
    },
    {
      id: 'personas',
      icon: Users,
      title: 'Set up Personas',
      description: 'Give an agent a role, model, and system prompt you can reuse.',
      actionLabel: 'Open Personas',
      onAction: () => setNav('personas')
    },
    {
      id: 'shortcuts',
      icon: Keyboard,
      title: 'Keyboard shortcuts',
      description: 'Navigate projects, tabs, and terminals without the mouse.',
      actionLabel: 'See all shortcuts',
      onAction: () => useUi.getState().setShortcutsOpen(true)
    },
    {
      id: 'walkthrough',
      icon: Compass,
      title: 'Replay the tour',
      description: 'Re-run the first-run walkthrough: agents, projects, schedules.',
      actionLabel: 'Start the tour',
      onAction: () => useUi.getState().setWalkthroughOpen(true)
    }
  ];
  const openGuide = guides.find((g) => g.id === openGuideId) ?? null;

  return (
    <main className="settings-panel home-panel">
      <AuroraGrid />
      <div className="settings-inner settings-inner--wide">
        <div className="scheduler-header">
          <div className="scheduler-header-text">
            <h2>Home</h2>
            <p className="settings-help scheduler-subtitle">
              Your open follow-ups, the latest inbox activity, and everything currently
              running — one glance across every project.
            </p>
          </div>
        </div>

        <HomeAgentComposer />

        <div className="home-grid">
          <HomeCard
            title="Inbox"
            icon={InboxIcon}
            count={unreadInbox}
            onViewAll={() => setNav('inbox')}
            viewAllLabel="View all"
            loading={inboxLoading}
            empty="Nothing in the inbox yet."
          >
            {latestInbox.map((entry) => (
              <button
                key={entry.id}
                className="home-row"
                onClick={() => openInboxEntry(entry.id)}
              >
                <span className="home-row-icon" aria-hidden="true">
                  <InboxIcon size={14} />
                </span>
                <span className="home-row-text">
                  <span className="home-row-title">{inboxPrimaryTitle(entry)}</span>
                  <span className="home-row-meta">
                    {entry.projectLabel ?? entry.projectId}
                    {inboxSecondaryLine(entry) ? ` · ${inboxSecondaryLine(entry)}` : ''}
                  </span>
                </span>
              </button>
            ))}
          </HomeCard>

          <HomeCard title="Guides" icon={Compass} count={0} loading={false} empty="">
            {guides.map((g) => {
              const Icon = g.icon;
              return (
                <button
                  key={g.id}
                  className="home-row home-row--guide"
                  onClick={() => setOpenGuideId(g.id)}
                >
                  <span className="home-row-icon" aria-hidden="true">
                    <Icon size={14} />
                  </span>
                  <span className="home-row-text">
                    <span className="home-row-title">{g.title}</span>
                    <span className="home-row-meta">{g.description}</span>
                  </span>
                </button>
              );
            })}
          </HomeCard>
        </div>

      </div>

      {creatingExtension && (
        <CreateExtensionDialog onClose={() => setCreatingExtension(false)} />
      )}
      {openGuide && (
        <GuideModal
          title={openGuide.title}
          icon={openGuide.icon}
          content={GUIDE_CONTENT[openGuide.id] ?? ''}
          actionLabel={openGuide.actionLabel}
          onAction={() => {
            setOpenGuideId(null);
            openGuide.onAction();
          }}
          onClose={() => setOpenGuideId(null)}
        />
      )}
    </main>
  );
}

function HomeCard({
  title,
  icon: Icon,
  count,
  onViewAll,
  viewAllLabel,
  loading,
  empty,
  children
}: {
  title: string;
  icon: LucideIcon;
  count: number;
  onViewAll?: () => void;
  viewAllLabel?: string;
  loading: boolean;
  empty: string;
  children: ReactNode;
}) {
  const hasRows = !!children && (Array.isArray(children) ? children.length > 0 : true);
  return (
    <section className="home-card">
      <header className="home-card-head">
        <span className="home-card-title">
          <Icon size={14} />
          {title}
          {count > 0 && <span className="home-card-count">{count}</span>}
        </span>
        {onViewAll && (
          <button className="home-card-viewall" onClick={onViewAll}>
            {viewAllLabel ?? 'View all'}
          </button>
        )}
      </header>
      <div className="home-card-body">
        {loading ? (
          <div className="home-card-empty">Loading…</div>
        ) : hasRows ? (
          children
        ) : (
          <div className="home-card-empty">{empty}</div>
        )}
      </div>
    </section>
  );
}
