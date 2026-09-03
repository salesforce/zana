export const MAX_FIXTURE_SCALE = 1.2;

export const DEFAULT_SLIDE_ID = 'kanban';

export interface TourSlide {
  id: string;
  title: string;
  blurb: string;
}

export const SLIDES: readonly TourSlide[] = [
  {
    id: 'features',
    title: 'Features',
    blurb:
      'New Chat is the cockpit. Start a Modern thread or a CLI agent, pick the harness, and keep every project on the same rail.'
  },
  {
    id: 'kanban',
    title: 'Kanban',
    blurb:
      'Every session in a lane. Cards flow Needs you → Working → Idle → Done as the agent works — you never drag them. Threads and CLI agents share the board.'
  },
  {
    id: 'thread',
    title: 'Thread',
    blurb:
      'The Modern conversation: a timeline of turns, tools, and files, with a composer that can pause on a question until you reply.'
  },
  {
    id: 'cli',
    title: 'CLI agent',
    blurb:
      'The live PTY for Claude Code, Cursor, Codex, and the rest. Same board card, same inspector split — terminal on the left, facts and diffs on the right.'
  },
  {
    id: 'inbox',
    title: 'Inbox',
    blurb:
      'Questions pin at the top until you answer. Reports and ideas stay inline. Routine noise and agent-closed runs fold so they cannot bury the signal.'
  },
  {
    id: 'plugins',
    title: 'Plugins',
    blurb:
      'Installed plugins sit beside Browse. Confirm full trust, then a marketplace panel or a plugin you asked the app to build runs in-process.'
  },
  {
    id: 'remote',
    title: 'Remote',
    blurb:
      'Pilot an agent over SSH from the same board. Local and remote sessions look the same — the SSH chip is the only tell.'
  }
];

export function spatialFixtureScale(
  availableWidth: number,
  authoredWidth: number,
  availableHeight?: number,
  authoredHeight?: number
): number {
  if (availableWidth <= 0 || authoredWidth <= 0) return 1;
  const heightScale =
    availableHeight !== undefined &&
    availableHeight > 0 &&
    authoredHeight !== undefined &&
    authoredHeight > 0
      ? availableHeight / authoredHeight
      : Number.POSITIVE_INFINITY;
  return Math.min(MAX_FIXTURE_SCALE, availableWidth / authoredWidth, heightScale);
}

export function slideIdFromHash(hash: string, slides: readonly TourSlide[] = SLIDES): string | null {
  const id = hash.replace(/^#/, '').replace(/^tour-/, '');
  return slides.some((slide) => slide.id === id) ? id : null;
}

export function slideIndexFromHash(hash: string, slides: readonly TourSlide[] = SLIDES): number {
  const id = slideIdFromHash(hash, slides);
  if (id) return slides.findIndex((slide) => slide.id === id);
  return Math.max(
    0,
    slides.findIndex((slide) => slide.id === DEFAULT_SLIDE_ID)
  );
}

/** Fragment id for a slide. Keep `tour-features` so `/#features` is not mistaken for the Features page. */
export function anchorForSlide(id: string): string {
  return id === 'features' ? 'tour-features' : id;
}

/** Path + search + hash. Callers must pass this to replaceState WITH the existing history.state. */
export function hrefForSlide(id: string, currentHref: string): string {
  const url = new URL(currentHref, 'http://localhost');
  url.hash = anchorForSlide(id);
  return `${url.pathname}${url.search}${url.hash}`;
}
