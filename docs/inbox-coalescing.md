# Inbox coalescing (Phase 1)

Recurring producers used to push one inbox entry per event. A 5-minute
schedule reporting "no changes" created ~288 rows/day; they were visually
collapsed but still churned the list, leaked read-state keys, and — worst —
evicted the global 5000-entry FIFO, silently deleting the user's important
manual entries within ~17 days.

## The change

A push may carry an optional `dedupeKey`. When present, the store folds it
into the **most-recent live entry** sharing the same `(projectId, dedupeKey)`
instead of appending:

- the existing entry keeps its `id`, gets its `ts` / `docs` / `comments`
  refreshed, and `occurrences` is incremented;
- the entry is moved to newest position (chronological-by-last-write);
- an `updated` event fires instead of `appended`.

Because the rewrite swaps a line rather than growing the file, a chatty
producer now occupies **one self-refreshing row** — which also keeps the JSONL
small instead of leaning on the retention cap to trim it. The sidebar shows a
`×N` badge so one row visibly stands for many occurrences.

Manual agent `inbox_push` calls stay un-keyed and never coalesce.

## Keys

| Producer | dedupeKey |
| --- | --- |
| Scheduler run-complete notice | `sched:${projectId}:${taskId}` |
| Heartbeat runaway-cap notice | `heartbeat:${sessionId}` |

## Touch points

- `src/shared/types.ts` — `InboxEntry.dedupeKey`, `InboxEntry.occurrences`,
  `cc.inbox.onUpdated`.
- `src/main/inbox-store.ts` — `coalesce()` in both the JSONL and memory stores;
  `onUpdated` subscription.
- `src/shared/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts` — `updated`
  event wiring.
- `src/renderer/store.ts` — `useInbox.upsert` + `onUpdated` subscription.
- `src/renderer/components/InboxSidebar.tsx` + `global.css` — `×N` badge.
- `src/main/scheduler.ts`, `src/main/heartbeat.ts` — set `dedupeKey`.

## Phase 2 — tiered retention

The single global 5000-entry FIFO let a chatty quiet producer evict the user's
manual/`loud` entries as history rolled over. Retention is now **two
independent caps**:

- **Protected** — manual / agent / `loud` scheduled entries: `maxEntries`
  (default 5000).
- **Quiet** — `scheduled && notify !== 'loud'`: `quietMaxEntries`
  (default 500).

`compact()` keeps the newest of each tier independently and re-emits survivors
in original file order. A noisy job can only ever evict other quiet notices —
never a blocked-task question. The quiet classifier mirrors the renderer's
badge/collapse rule exactly, so "what looks low-priority" and "what retention
sacrifices first" are the same set.

## Phase 3 — bounded persisted markers

The read / answered / saved / keep maps in localStorage are keyed by entry id
and never shrank — ids of deleted or evicted entries leaked forever. Retention
eviction was also silent (no event), so the renderer never learned an entry was
gone.

`compact()` now emits a `pruned` event carrying the evicted ids (mirroring
`agent-message-log.onPruned`), wired through `inbox.onPruned`. The renderer
prunes all four persisted maps on both `onRemoved` (single delete) and
`onPruned` (retention), via the shared `pruneInboxMarkers()` helper, keeping
those maps bounded by the live entry set.

## Not yet done

In-memory source-of-truth store (serving `read()` from RAM instead of a full
re-parse), load-time `bucketFor` staleness recompute, and promoting `notify` to
a general `level` so manual pushes can be quiet vs loud — deferred; the current
phases deliver the noise + correctness wins without that surface-area change.
