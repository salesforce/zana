import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendConversationThreadEvent,
  createConversationThread,
  createEnvironment,
  listConversationThreadEvents,
  listConversationThreadsByProject,
  listVisibleConversationThreads,
  openDatabase,
  upsertHost,
  type ZccDatabase
} from './index.js';

/**
 * Phase 4 of the BB 0.40 catch-up: measure thread-open and thread-list/search
 * before importing FTS, expand-on-demand bodies, or product `/ws` ping/pong.
 *
 * These queries already have caps (`VISIBLE_CONVERSATION_THREAD_LIMIT = 200`)
 * and indexed thread_id/sequence lookups. If they stay well under 100ms on a
 * 200-thread / 2_000-event fixture, BB's FTS and timeline-windowing batches
 * are not worth the schema/protocol cost.
 */

const THREAD_COUNT = 200;
const LARGE_EVENT_COUNT = 2_000;
/** Well above measured ~1ms thread-open; CI still fails if a read becomes slow. */
const SLOW_MS = 100;

let db: ZccDatabase | null = null;
let dir: string | null = null;

afterEach(() => {
  db?.close();
  db = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function timed<T>(fn: () => T): { result: T; ms: number } {
  const start = performance.now();
  const result = fn();
  return { result, ms: performance.now() - start };
}

describe('conversation thread read cost', () => {
  it('lists and opens a 200-thread / 2k-event fixture without needing FTS', () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-db-perf-'));
    db = openDatabase(join(dir, 'zcc.sqlite'));
    const host = upsertHost(db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    const environment = createEnvironment(db, {
      projectId: 'proj-perf',
      hostId: host.id,
      path: '/tmp/proj-perf'
    });

    const threads = db.transaction(() => {
      const created = [];
      for (let i = 0; i < THREAD_COUNT; i += 1) {
        created.push(
          createConversationThread(db!, {
            projectId: 'proj-perf',
            hostId: host.id,
            environmentId: environment.id,
            providerId: 'claude-code',
            title: i === 7 ? 'alpha search needle' : `thread ${i}`
          })
        );
      }
      return created;
    });
    const largeThreadId = threads[0]!.id;
    db.transaction(() => {
      for (let i = 0; i < LARGE_EVENT_COUNT; i += 1) {
        appendConversationThreadEvent(db!, {
          threadId: largeThreadId,
          type: i % 4 === 0 ? 'item/agentMessage/delta' : 'item/completed',
          payload: {
            threadId: largeThreadId,
            text: `event body ${i} ${'x'.repeat(80)}`
          }
        });
      }
    });

    const visible = timed(() => listVisibleConversationThreads(db!));
    const byProject = timed(() => listConversationThreadsByProject(db!, 'proj-perf'));
    const open = timed(() => listConversationThreadEvents(db!, largeThreadId));
    const search = timed(() =>
      listConversationThreadsByProject(db!, 'proj-perf').filter((thread) =>
        (thread.title ?? '').toLowerCase().includes('needle')
      )
    );

    expect(visible.result).toHaveLength(THREAD_COUNT);
    expect(byProject.result).toHaveLength(THREAD_COUNT);
    expect(open.result).toHaveLength(LARGE_EVENT_COUNT);
    expect(search.result).toHaveLength(1);

    // Skip FTS / expand-on-demand / product `/ws` ping unless a read is slow.
    // Pairing relay already pings; the visible thread list is capped at 200 rows.
    console.info(
      `thread-read cost ms: visible=${visible.ms.toFixed(1)} byProject=${byProject.ms.toFixed(1)} open=${open.ms.toFixed(1)} search=${search.ms.toFixed(1)}`
    );
    expect(visible.ms).toBeLessThan(SLOW_MS);
    expect(byProject.ms).toBeLessThan(SLOW_MS);
    expect(open.ms).toBeLessThan(SLOW_MS);
    expect(search.ms).toBeLessThan(SLOW_MS);
  });
});
