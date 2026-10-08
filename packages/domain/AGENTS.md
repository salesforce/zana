# packages/domain — Coupling Notes

Load-bearing invariants for shared domain types and feed infrastructure.

## Feed categories (feed-categories.ts)

Declare every inbox event type's feed impact in `FEED_CATEGORIES` registry.

### Invariants

1. `report`/`idea`/`question`/`goal` are `grouped: false` and must stay so — they are high-value artifacts the feed exists to surface. Never eligible for auto-scheduler / auto-close folding nor LLM noise classifier.

2. Default is SIGNAL on purpose — unclassified/new entry surfaces loudly as `report` rather than silently swallowed as noise. Missing registry entry is visible over-surface, never silent drop.

3. `classifyEntry` precedence is fixed: question → auto-close → heartbeat → goal → quiet-scheduled → report. The `auto-close:` prefix wins over `scheduled`.

### Why

Inbox splits SIGNAL (inline solo rows) from NOISE (folded per-project sections). Decision lives in one registry — `classifyEntry(entry)` maps entry → `FeedCategoryId`, each category's `grouped` boolean decides fold vs inline. `inbox-grouping.ts` (`groupByBucketThenProject`) is pure layout engine over that decision.

### Implementation

- `FEED_CATEGORIES` registry declares each category with `grouped` value
- `classifyEntry` recognises entries from implicit signals: `dedupeKey` prefix (`auto-close:`/`heartbeat:`/`goal:`), `scheduled`+`notify` pair, `question` presence
- `inbox-grouping.ts` emits `groupedSections[]` in `GROUPED_CATEGORY_ORDER`
- `InboxSidebar.tsx` generic `FoldedSection` renders each with no per-category markup
- Folded sections reuse historically-named `inbox-scheduled-*` CSS classes in `global.css` as one shared visual treatment (don't rename without updating `FoldedSection`)
- Activity Feed (`feed-service.ts`, `FeedEventKind`) is separate per-project history timeline with its own taxonomy — re-imports `AUTO_CLOSE_KEY_PREFIX`/`isAutoCloseEntry` from registry but keeps its own `deriveFromInbox` mapping; don't conflate

### Guard

- `feed-categories.test.ts` — registry invariants
- `inbox-grouping.test.ts` — layout engine purity

### When changing

Add new inbox concept → declare `FeedCategory` with deliberate `grouped` value AND teach `classifyEntry` to recognise it. See `feed-categories.ts` header comment.

Rename CSS classes → update `FoldedSection` component.

Touch registry precedence → verify both guard tests pass.

See also: `apps/server/src/services/feed/AGENTS.md` for feed-noise classifier (overlay on this registry).
