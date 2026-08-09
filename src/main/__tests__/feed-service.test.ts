import { describe, it, expect, vi } from 'vitest';
import {
  FeedService,
  deriveFromInbox,
  deriveFromFollowups,
  deriveFromGoals,
  deriveFromLibrary,
  mergeAndPaginate,
  commitToInput,
  type FeedServiceDeps
} from '../feed-service.js';
import { AUTO_CLOSE_KEY_PREFIX } from '../../renderer/util/inboxGrouping.js';
import type {
  FeedEvent,
  FollowUp,
  Goal,
  GitCommit,
  InboxEntry,
  LibraryDoc
} from '../../shared/types.js';

const NOW = 1_700_000_000_000;

function inbox(over: Partial<InboxEntry> = {}): InboxEntry {
  return { id: 'i1', ts: NOW, projectId: 'p1', comments: 'Did work', ...over } as InboxEntry;
}

describe('deriveFromInbox', () => {
  it('skips questions (those belong to the Inbox, not history)', () => {
    const out = deriveFromInbox([inbox({ question: { prompt: 'x', options: [] } as never })]);
    expect(out).toEqual([]);
  });

  it('maps auto-close breadcrumbs → session-finished', () => {
    const out = deriveFromInbox([
      inbox({ dedupeKey: `${AUTO_CLOSE_KEY_PREFIX}sess1`, comments: 'Agent wrapped up' })
    ]);
    expect(out[0]!.kind).toBe('session-finished');
    expect(out[0]!.title).toBe('Agent wrapped up');
  });

  it('maps scheduled entries → schedule-run and plain entries → report', () => {
    const out = deriveFromInbox([
      inbox({ id: 'a', scheduled: true, comments: 'Nightly build' }),
      inbox({ id: 'b', comments: 'Manual report' })
    ]);
    expect(out.find((e) => e.id === 'inbox:a')!.kind).toBe('schedule-run');
    expect(out.find((e) => e.id === 'inbox:b')!.kind).toBe('report');
  });

  it('carries the full body, context, and docs into detail', () => {
    const [ev] = deriveFromInbox([
      inbox({
        subject: 'Website polish epic — COMPLETE',
        intent: 'Ship the 4-ticket polish epic',
        comments: 'Landed shiki, ⌘K search, a11y-SEO, visual pass.\nAll 54 tests green.',
        docs: [{ path: 'docs/website.md' } as never]
      })
    ]);
    expect(ev!.title).toBe('Website polish epic — COMPLETE');
    expect(ev!.context).toBe('Ship the 4-ticket polish epic');
    expect(ev!.detail).toContain('Landed shiki');
    expect(ev!.detail).toContain('All 54 tests green.');
    expect(ev!.detail).toContain('📄 docs/website.md');
  });

  it('omits detail when the body is just the title (no new info)', () => {
    const [ev] = deriveFromInbox([inbox({ comments: 'Did work' })]);
    expect(ev!.title).toBe('Did work');
    expect(ev!.detail).toBeUndefined();
  });
});

describe('deriveFromFollowups', () => {
  const fu = (over: Partial<FollowUp>): FollowUp =>
    ({
      id: 'f1',
      projectId: 'p1',
      title: 'Ship it?',
      kind: 'decision',
      status: 'open',
      origin: { source: 'agent' },
      createdAt: new Date(NOW).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
      ...over
    }) as FollowUp;

  it('emits a created event for every follow-up in the project', () => {
    const out = deriveFromFollowups([fu({})], 'p1');
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('followup-created');
  });

  it('emits both created + resolved for a resolved follow-up', () => {
    const out = deriveFromFollowups(
      [
        fu({
          status: 'resolved',
          resolvedAt: new Date(NOW + 1000).toISOString(),
          resolution: 'yes'
        })
      ],
      'p1'
    );
    expect(out.map((e) => e.kind).sort()).toEqual(['followup-created', 'followup-resolved']);
    expect(out.find((e) => e.kind === 'followup-resolved')!.detail).toBe('yes');
  });

  it('filters out other projects', () => {
    expect(deriveFromFollowups([fu({ projectId: 'other' })], 'p1')).toEqual([]);
  });
});

describe('deriveFromGoals', () => {
  const goal = (over: Partial<Goal>): Goal =>
    ({
      id: 'g1',
      projectId: 'p1',
      title: 'Reach 90% coverage',
      status: 'active',
      updatedAt: new Date(NOW).toISOString(),
      createdAt: new Date(NOW).toISOString(),
      ...over
    }) as Goal;

  it('only emits achieved / escalated goals', () => {
    const out = deriveFromGoals(
      [
        goal({ id: 'a', status: 'achieved' }),
        goal({ id: 'b', status: 'active' }),
        goal({ id: 'c', status: 'escalated' })
      ],
      'p1'
    );
    expect(out.map((e) => e.id).sort()).toEqual(['goal:a:achieved', 'goal:c:escalated']);
  });
});

describe('deriveFromLibrary', () => {
  const doc = (over: Partial<LibraryDoc>): LibraryDoc =>
    ({
      id: 'd1',
      relPath: 'findings/x.md',
      title: 'Findings',
      kind: 'markdown',
      createdAt: NOW,
      updatedAt: NOW,
      projectId: 'p1',
      source: { kind: 'agent' },
      ...over
    }) as LibraryDoc;

  it('emits agent/schedule docs but skips human (user) edits', () => {
    const out = deriveFromLibrary(
      [doc({ id: 'a' }), doc({ id: 'b', source: { kind: 'user' } })],
      'p1'
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('library-doc');
  });
});

describe('mergeAndPaginate', () => {
  const ev = (id: string, ts: number): FeedEvent => ({
    id,
    projectId: 'p1',
    kind: 'report',
    ts,
    title: id
  });

  it('dedupes by id, sorts newest-first, and paginates', () => {
    const page = mergeAndPaginate(
      [
        [ev('a', 100), ev('b', 300)],
        [ev('b', 300), ev('c', 200)] // 'b' duplicated across lists
      ],
      { limit: 2 }
    );
    expect(page.events.map((e) => e.id)).toEqual(['b', 'c']);
    expect(page.hasMore).toBe(true);
  });

  it('applies the before cursor (strictly older than)', () => {
    const page = mergeAndPaginate([[ev('a', 100), ev('b', 200), ev('c', 300)]], {
      limit: 10,
      before: 300
    });
    expect(page.events.map((e) => e.id)).toEqual(['b', 'a']);
    expect(page.hasMore).toBe(false);
  });
});

describe('commitToInput', () => {
  it('maps a commit to a dedupe-keyed persisted input', () => {
    const c: GitCommit = {
      hash: 'deadbeef',
      shortHash: 'deadbee',
      author: 'Dev',
      ts: NOW,
      subject: 'feat: x'
    };
    const inp = commitToInput('p1', c);
    expect(inp.kind).toBe('commit');
    expect(inp.dedupeKey).toBe('commit:deadbeef');
    expect(inp.title).toBe('feat: x');
    expect(inp.detail).toContain('deadbee');
  });
});

describe('FeedService.list', () => {
  function deps(over: Partial<FeedServiceDeps> = {}): FeedServiceDeps {
    return {
      store: {
        list: () => [],
        appendMany: vi.fn(() => 0)
      } as unknown as FeedServiceDeps['store'],
      readInbox: async () => [inbox({ id: 'r', comments: 'Report' })],
      listFollowups: () => [],
      listGoals: () => [],
      listLibrary: () => [],
      getRecentCommits: async () => [],
      resolveProject: () => ({ path: '/tmp/p', name: 'P' }),
      ...over
    };
  }

  it('merges derived sources and returns a sorted page', async () => {
    const svc = new FeedService(deps());
    const page = await svc.list('p1', { limit: 10 });
    expect(page.events.some((e) => e.id === 'inbox:r')).toBe(true);
  });

  it('snapshots git only when refreshGit is set', async () => {
    const appendMany = vi.fn(() => 1);
    const getRecentCommits = vi.fn(async () => [
      { hash: 'h', shortHash: 'h', author: 'D', ts: NOW, subject: 's' } as GitCommit
    ]);
    const store = { list: () => [], appendMany } as unknown as FeedServiceDeps['store'];

    const svc = new FeedService(deps({ store, getRecentCommits }));
    await svc.list('p1', { limit: 10 });
    expect(getRecentCommits).not.toHaveBeenCalled();

    await svc.list('p1', { limit: 10, refreshGit: true });
    expect(getRecentCommits).toHaveBeenCalledOnce();
    expect(appendMany).toHaveBeenCalledOnce();
  });

  it('never throws when a source errors — the source is just omitted', async () => {
    const svc = new FeedService(
      deps({
        readInbox: async () => {
          throw new Error('inbox down');
        },
        listGoals: () => {
          throw new Error('goals down');
        }
      })
    );
    const page = await svc.list('p1', { limit: 10 });
    expect(page.events).toEqual([]);
  });
});
