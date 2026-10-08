# apps/server/src/services/feed — Coupling Notes

Load-bearing invariants for feed-noise classifier and Activity Feed service.

## Feed-noise classifier (feed-noise-classifier.ts)

Optional LLM demotion (`builtin:feed-noise-classifier`) background-demotes ambiguous routine `report` into folded "Routine" section. Default OFF; `feedNoiseClassifierEnabled` in `AppConfig` + Settings "Feed-noise classifier" toggle.

### Invariants

1. Advisory overlay, never mutation — `classifyEntry` stays pure and never returns `routine`. LLM verdict is non-persisted `ReadonlySet<string>` of entry ids passed as 3rd arg to `groupByBucketThenProject(entries, now, routineIds)`, which re-buckets id `report`→`routine` only (any other category left untouched). Missing/failed verdict just leaves everything inline — classifier can only ever demote a report, never promote or hide anything else.

2. Deterministic gate precedes LLM — `isDemotionCandidate` (main-side) only ever feeds micro-call comment-only reports (rejects `question`, docs-bearing, `auto-close:`/`heartbeat:`/`goal:` dedupeKeys, and `scheduled`). Model physically cannot see docs/idea/question/goal entry to demote it.

### Why

Micro-call (haiku) shaves last bit of noise by demoting routine "task done" notes. Mirrors `inbox-summary.ts` shape: DI'd `readEntries`/`runClassify` deps, reads main's own store (Rule 1), capped at `FEED_NOISE_MAX_ENTRIES = 60`, never throws → empty set on failure.

### Implementation

Wire path:
- IPC `inbox:classifyNoise` (gated on `feedNoiseClassifierEnabled` in `apps/desktop/src/ipc/inbox.ts`, returns empty result when off)
- → preload `window.cc.inbox.classifyNoise`
- → renderer's throttled `useFeedNoise`/`maybeRefreshFeedNoise` store hook in `apps/app/src/stores/live.ts` (twin of `useInboxSummary`, keyed by `inboxContentSignature` + `INBOX_SUMMARY_AUTO_MIN_MS` floor)
- → `InboxSidebar` passes cached `routineIds` into `groupByBucketThenProject`

The `routine` `FeedCategory` (`grouped: true`) declared in registry but explicitly documented as overlay-only (never emitted by `classifyEntry`).

### Guard

- `feed-noise-classifier.test.ts` — overlay purity
- `packages/domain/src/feed-categories.test.ts` — registry invariants include `routine` overlay constraint
- `packages/domain/src/inbox-grouping.test.ts` — layout handles overlay input

### When changing

Modify demotion logic → verify deterministic gate still protects high-value categories.

Touch wire path → verify IPC gating, throttle floor, and empty-result fallback.

See also: `packages/domain/AGENTS.md` for feed category registry (source of truth for `classifyEntry` + precedence).

## Activity Feed (feed-service.ts)

Separate per-project history timeline (`FeedEventKind`) with own taxonomy. Re-imports `AUTO_CLOSE_KEY_PREFIX`/`isAutoCloseEntry` from feed-categories registry but keeps own `deriveFromInbox` mapping. Don't conflate with Inbox feed categories.
