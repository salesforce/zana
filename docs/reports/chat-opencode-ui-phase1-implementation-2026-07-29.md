# Chat OpenCode UI Phase 1

Date: 2026-07-29

## Implemented

- Added a semantic Chat tool presentation registry using exact tool names.
- Grouped consecutive `Read`, `Grep`, `Glob`, `ls`, and `List` calls into one
  expandable Gathering/Gathered context row.
- Added compact semantic rows for edit/write, web, task, and generic tools.
- Added an inline Bash/shell disclosure with command, status, duration, output,
  and copy action.
- Added a dedicated failed-tool error card rather than relying on a red generic
  row and the raw inspector.
- Applied the semantic presentation to live and persisted tool activity.
- Retained the raw Tool Inspector as a secondary debugging surface.
- Wired the existing Streamdown renderer into live assistant output so partial
  Markdown, unfinished fences, and tables render incrementally. Persisted turns
  retain the existing rich Markdown renderer with Mermaid/images/find support.
- Added render containment for tool rows and reduced-motion behavior for the
  nine-dot activity animation.

## Deferred

- Ordered durable message parts. Current persisted turns still group reasoning,
  text, artifacts, and tools into fixed fields.
- Inline before/after patches for Write/Edit.
- Structured compiler/LSP diagnostics.
- Full-output references beyond the current bounded payload preview.
- Timeline virtualization.

## Verification

- `npm run typecheck`: passed.
- Focused renderer tests: 4 files, 17 tests passed.
- `git diff --check`: passed.
