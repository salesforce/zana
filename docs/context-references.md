# Shared context references

Accepted implementation design · 31 October 2026.

## Problem and behavior

Selected content copied from participating plugin/module surfaces should paste as an inspectable inline badge in the shared thread composer and page assistant. Ordinary applications receive the copied text. Inline references preserve the meaning of “compare [this passage] with [that log].” Paste as plain text bypasses the badge. A reference can be inspected, removed, or converted to editable text. Sending always includes the exact copied snapshot, including unsaved edits.

## Shared contract

A versioned ContextReference contains label, text, and an optional file or plugin source locator. The domain owns validation, bounds and prompt serialization. The SDK exposes writeContextReference(copyEvent, reference), copyContextSelection(copyEvent, root, metadata), parsing helpers, and composer.insertContextReference(reference). Panel assistant drafts accept references arrays. Existing EditorSelection clipboard producers and the single-selection assistant draft API remain compatible.

The host owns the renderer, preview, conversion, limits and provider serialization. Plugin payloads contain data, never executable clipboard callbacks or custom HTML. Source labels are descriptive; they grant no filesystem access. Plain text from external sources is not automatically attributed or collapsed.

Limits: 100,000 characters per snapshot, 24 references and 400,000 snapshot characters per text input/draft. Server schemas validate that reference offsets match the exact host serialization, preventing invalid metadata from hiding message text. Rendered selections do not invent source-line mappings.

## Architecture

Source copy event → text/plain plus application/x-zcc-context-reference → shared composer inline node → expanded prompt text plus reference offsets → validated stored prompt input → provider text and compact timeline badges.

The sandboxed HTML runtime writes clipboard formats synchronously during the copy event. It cannot wait for a parent MessageChannel reply. DOM adapters confine both selection endpoints and leave form fields/editable widgets alone. The exact selection text is copied without comment-quote trimming or truncation. Invalid/oversized metadata falls back to native text copy/paste.

Structured references stay attached to canonical text prompt inputs so history replay and draft restoration can reconstruct badges without parsing Markdown or fetching the source again. Mode prefixes and command removal shift reference offsets together with mention offsets. Existing history without references remains readable.

## Scope and rollout

1. Source copy producers in Design Docs rendered text and HTML frames; shared composer support with legacy selection compatibility.
2. Generic SDK insertion/clipboard helpers, panel-draft references and Design Docs Ask agent/Add to thread adoption; source-free log/record snapshots supported by the same API.
3. Canonical prompt metadata, compact sent-message display and restoration; provider text remains ordinary text.

The interactive mock compares Current, Inline badges (recommended), and a context row. The product uses one layout, with no layout preference.

## Alternatives and tradeoffs

Per-plugin badge renderers duplicate behavior. A global clipboard watcher or a “last active composer” destination risks attaching unrelated content. Explicit scoped insertion and opt-in source adapters make destinations and origins clear. Live references that fetch latest content at send time are deferred: snapshots preserve exactly what the user selected. Compact display does not reduce token usage.

Source navigation is optional and must use existing authorized host navigation. A missing/deleted source must never prevent snapshot inspection or sending. Clipboard locators must not trigger background file reads.

## Validation

Focused parser/clipboard tests cover bounds, malformed versions, mismatched text, CRLF, legacy compatibility and copy confinement. Composer tests cover caret placement, multiple references, preview/focus, removal/conversion, undo/redo, plain paste, scoped drafts and serialization. Domain and projection tests cover metadata validation, prefix/command offset transformations, history and restoration. Built-Electron tests use actual iframe/Markdown copy/paste and isolated HOME to prove clipboard formats survive the real boundary. New/changed code requires at least 80% meaningful coverage; run focused tests, built-Electron scenarios and pnpm verify:fast. Read docs/live-zana-verification.md for any triggered seam checks.

## Implementation workspace

Branch: feat/context-references. Base: origin/main f4d2bc45c7c882d8fc968f00b5f301418a1f7ed7. Worktree: .worktrees/feat/context-references. The original checkout and its uncommitted work are preserved. The original side-assistant changes not on main are not copied wholesale; necessary behavior is implemented against this base.

## Implemented behavior

- Shared versioned snapshots and bounds live in the domain, with a dependency-free `@zana-ai/zcc-domain/context-reference` entry for embedded pages. The SDK publishes clipboard helpers, scoped insertion and typed panel-draft references; its README and plugin-authoring guide include adoption examples.
- Design Docs rendered text and sandboxed HTML opt into native copy metadata. Ask agent carries compact references into its draft; Add to thread targets the owning mounted conversation. Legacy editor selections still paste successfully.
- The shared composer provides inline inspection, removal, conversion to text, and separate undo steps. Plain paste stays editable. Exact snapshots expand into provider text; verified offsets preserve compact sent messages and history restoration. Surrounding text keeps the normal render cap and image handling.
- Unsent page-assistant text and snapshots are excluded from persisted panel layout. Source metadata is descriptive: this implementation does not fetch a newer source or add source-navigation controls.

## Verification results

- TypeScript typecheck and `git diff --check`: passed.
- Focused suite after interactive QA fixes: **306 tests across 19 files passed**, including the published SDK consumer compile check. Coverage across the ten measured context/composer/clipboard implementation files: **86.11% statements, 80.62% branches, 81.11% functions, 87.66% lines**.
- Source guards: **305 tests across 82 files passed**.
- Built Electron: **8 scenarios passed** using `pnpm test:e2e -- e2e/context-references.spec.ts e2e/design-docs-panel-agent.spec.ts e2e/plugin-authoring-live.spec.ts e2e/packaged-provider-startup.spec.ts`. The new scenario crosses the real OS clipboard from both Markdown and an HTML iframe, checks paste as text and undo, sends through the fake provider, restores history, and reopens the saved conversation after reload. Each app uses isolated HOME and build output.
- `pnpm verify:fast` ran the broad changed dependency graph: 18,067 tests passed; its initial four failures included two source/documentation guards corrected and rechecked by the focused run. The remaining two failures are unchanged Node 26 expectations in `native-tool-policy.test.ts` (deep JSON nesting) and `payload-size.test.ts` (exact gzip byte counts). Rechecking those two files under Node 24 passed all 54 tests. The broad Node 26 run is therefore **not reported as green**.

The initial implementation was kept isolated on `feat/context-references`. Integration is authorized after verification. The original checkout's source and uncommitted work are preserved. TinyNod is optional and has not been enabled for this repository; its absence is not a clean review.

## Follow-up UI verification

`pnpm test:e2e -- e2e/context-references.spec.ts` passed both scenarios in a freshly built Electron app using isolated HOME and the real OS clipboard. The second scenario reproduces a document beside a regular thread: copy/paste, inspect exact snapshot and provenance, Escape focus restoration, scoped Add to thread, conversion, removal, undo, ordinary external text, compact sent messages, and restoration of both the document and saved badges after reload. Screenshots of the composer, preview, sent message and restored conversation were inspected. A fake provider echoes the expanded prompt, proving the snapshot reaches the provider; no live model behavior is claimed.

This check found and fixed an insertion bug: inspecting a badge can leave its editor atom selected, causing explicit insertion to replace that reference. Scoped insertion now adds after a selected atom, with a regression test. Screenshot review also prompted wrapping long preview lines; the Electron test verifies the preview has no horizontal overflow while its exact text remains unchanged.

After these fixes, TypeScript and `git diff --check` passed; the focused suite passed 306 tests. The follow-up source guard run passed 304 tests across 81 files. The earlier broad Node 26 verification caveat above remains.

## Integration validation

Rebased onto `origin/main` at `b6d717095c4449d196ed8f316dc62c1efb0b6e5d`, including the intervening Design Docs Ask agent fix. The existing `initialSelection`, panel `selection`, and draft-selection behavior remain available alongside reference arrays. Combined legacy and new payloads share the same aggregate limits.

- TypeScript and `git diff --check` passed after integration.
- **363 focused tests across 22 files passed**, including legacy/new draft compatibility, aggregate limits and published SDK consumer compilation. Coverage: **86.13% statements, 81.25% branches, 81.11% functions, 87.68% lines**.
- **10 built-Electron scenarios passed** with the four-spec command above, including the selection-specific Ask agent scenario added on main. Actual clipboard copy/paste, scoped insertion, conversion, undo, sending, history reload, packaged-provider recovery and plugin authoring passed in isolated builds.

The normal pre-push verification and GitHub checks run against the integrated branch before merge. Their final results and merge identity are recorded in the Design Doc and project handoff.

### Merge-gate follow-up

Added direct regression coverage for rich prompt-history restoration (including malformed history, stale responses and failed loads), new/existing thread snapshot submission, plugin insertion ownership and teardown, scoped versus legacy SDK access, Add to thread success/rejection, iframe selection insertion, edited-message offsets, and timeline/steer metadata. The CI changed-code statements/branches check passes locally against the combined coverage reports, including every modified production file.

The first Linux CI run exposed top-level CDP keyboard dispatch failing to copy the sandboxed iframe selection. The test now explicitly focuses the frame, checks focus and exact selection, then invokes Electron's native Copy command for that focused frame. It still checks the actual OS clipboard, metadata paste and saved snapshots. The updated two-scenario built-Electron suite passed locally; Linux CI must pass this path before merge.
