# BB upstream update — September 22, 2026

ZCC now has seven targeted changes derived from an independent review of the
reported BB update. This is a source update in the existing ZCC checkout. It is
not a merge of BB's main branch or a deployment to the installed application.

## Source and scope

- Fetched `origin` in `/Users/grebmann/zcc-workspace/bb` and independently confirmed
  the reported range: `068711b42047b2487d9214782035cba2b708d00f` →
  `18960354e462d514c0d6071ba1ed0f8f2acd625c`.
- That range contains **70 commits**, touching 546 files. The 47,067 added and
  10,899 removed lines include generated artifacts and BB's sidebar migration.
- BB's local main remains at `9e16411141788c67954bceb753bb64ac1dc7057f`, 260 commits
  behind its fetched remote. That is the state of the BB checkout, not a count of
  missing ZCC fixes. This review covers the new 70-commit delta; it does not claim
  a fresh audit of all 260 commits.
- Fetched ZCC's own origin; no new commits were available beyond its starting
  `a604f2e7` baseline. Existing release, mobile and other concurrent edits were
  preserved.
- Commit inventory, changed-file inventory and selected patches are saved locally
  in `.zcc/references/bb-18960354e/`. Adapted source attribution is in
  `third-party/bb/`.

## Applied changes

| Change | What ZCC now does | Source |
| --- | --- | --- |
| Prompt attachments | Shares one 35 × 1024 × 1024-byte limit across composer admission, upload preflight, HTTP multipart parsing, stored images/files and uploaded-image timeline previews. Voice uploads retain their own limit. BMP/AVIF previews now match already accepted attachment formats. | [#4046](https://github.com/get-bb/bb/commit/76ae202c8746693221d6de8c825c996bd03280d8) |
| Path matching | Ranks a matching leaf filename ahead of longer partial leaf matches and uses shorter paths before lexical tie-breaking. | [#3993](https://github.com/get-bb/bb/commit/5ba6e4917204c558af711515b57801e80df91ce9) |
| Fallback titles | Truncates at 40 graphemes without splitting emoji, flags, combining marks or ZWJ sequences. Tests also prove skill-only, Chinese and Japanese prompts reach ZCC's existing title generator. | [#3995](https://github.com/get-bb/bb/commit/3275f6c6b2d79d6f55c9e40d53fe406e6d7d52bb), [#3990](https://github.com/get-bb/bb/commit/bb8fc9e239521210896860ef918a816afe8ce5a5), [#3887](https://github.com/get-bb/bb/commit/36d8aaaec1c451356bb61358182ce6958ffc0478) |
| Marketplace requests | Applies a 15-second timeout across headers and body, enforces the existing 1 MiB cap while reading the stream, and cleans up readers/timers on success and failure. Redirect rejection remains enforced. BB's exact custom-HTTP 304 crash was absent; this fixes corresponding bounds in ZCC's native-fetch implementation. | [#3962](https://github.com/get-bb/bb/commit/33bad652335bcdb8d2aba639e642679913eba5c9) |
| Browser machine selector | Resolves `open --machine` as an exact ID first, then a unique machine name. Missing/ambiguous names fail before host RPC. Adds `zcc.sdk.hosts.list()` with only authoritative ID/name data, documented in the SDK reference. | [#4037](https://github.com/get-bb/bb/commit/0613621b39d26008bd406bd7a9c6401a3faaa358) |
| Codex writer handoff | Retries only the recognized active-writer refusal during thread construction, after 100/400/1000 ms (four attempts maximum). Other failures remain immediate. Covers stop, discard, settings rebuild, transient contention and exhausted retries. | [#3460](https://github.com/get-bb/bb/commit/48bc6a7e9c8819a62ff3d486c803ff186e3afe55) |
| Provider CLI status | Shows “Latest unknown” when a latest-version lookup is missing, including the machine inventory summary, instead of claiming “Current” or “Up to date”. Existing update, unsupported, missing and externally managed states retain their precedence. | [#3985](https://github.com/get-bb/bb/commit/3a534b74f9b2436ee0bd695623a3b77fbad739f6) |

## Changes evaluated but not imported

| BB change family | ZCC finding / decision |
| --- | --- |
| Bundled thread-list plugin and sidebar migration (#4023–4029, #4031, #4035–4036, #4039, #4041, #4048, #4051, #4061, #4063) | A coordinated architectural migration, including new plugin DTOs, selection state, sections and loading behavior. ZCC's sidebar also owns Projects and CLI Agents. Importing the deletion of BB's built-in list would break ZCC; a dedicated migration design is required. |
| Frontend `useSdk()` and Plugin SDK 0.5.8 (#4027, #4033) | BB's SDK version and public frontend API are not ZCC's compatibility contract. Only the required, tested server SDK host-list capability was added. |
| Protocol version 216 | BB's protocol numbering is independent of ZCC's. Copying the number does not implement the corresponding schema/daemon migration. No arbitrary version bump was made. |
| Connect account limit 500 (#4002) | Belongs to BB's hosted account service. ZCC uses its own relay/account integration and does not contain the equivalent Connect service. |
| Failed queued-message retries (#3939) | ZCC already persists failed deferred messages and exposes manual recovery. BB's automatic retry changes depend on different queue state, dispatch attempts and retry timestamps. Automatic retry remains a separate change requiring acknowledgement/deduplication rules to avoid duplicate agent work. |
| Current skill snapshots on each new thread (#3986) | A real remaining difference: ZCC caches runtimes by environment/catalog and retains an existing runtime while it has threads. Proper adoption needs per-thread skill roots, provider-process identity and cleanup/retention changes; no superficial cache eviction was added. |
| Active-start admission before readiness waits (#4038) | BB's dispatch-attempt machinery differs. ZCC has its own conversation admission/queue checks. The patch is not directly portable; this review does not claim exhaustive race-equivalence. |
| Provider title generation (#3990, #3887) | ZCC already submits any nonempty prompt to its generator, without BB's word-count gate. Added regressions instead of duplicating the generator implementation. |
| Claude dollar-skill normalization (#3952) | ZCC's structured skill trigger schema is slash-only. No reachable dollar-trigger case was found to justify changing the Claude bridge. |
| Installed-plugin list truncation (#4053) | The bug is in BB's resource infinite-scroll sentinel/count pairing. ZCC's plugin hub uses a different list; the failing component pair is absent. |
| Marketplace layout and install polish (#4056, #4057, #4052, #4050, #4047, #4045, #4042, #3647) | User-facing design changes target BB's plugin shelf/details routing. ZCC owns its plugin hub layout; these are candidates for a focused ZCC UX pass, not safe mechanical imports. The details/configuration rewrite (#3646) was itself reverted by #4032 within this range. |
| Sidebar rename/archive/reorder, compose target and palette polish (#3975, #3982, #3989, #3945–3947, #3991, #4010, #4021, #3933, #3938, #4040) | Tied to BB sidebar state/components and its migration. Keep separate from ZCC's existing mixed navigation and concurrent board changes. |
| Mobile background resync / foreground notifications (#3997, #4001) | ZCC's product WebSocket and native-shell integration differ. Requires a ZCC lifecycle test and design rather than copying BB's WebSocketManager patch. Existing mobile work was preserved. |
| Browser tab focus restoration (#4016) | BB's own host-tab restoration path; not the machine-selector defect addressed here. No broad browser lifecycle rewrite was imported. |
| Remove parent permission clamping (#4018) | Not adopted as part of an upstream maintenance update. ZCC's main-authorized permission boundary remains its own design. |
| Image geometry persistence revert (#4008) | Reverts BB-specific persistence code. ZCC's image preview path was reviewed independently and its actual attachment-read cap fixed. |
| Bundle size, Zod locale and boot budget changes (#3996, #4000), frontend bundle naming (#3768) | Build/distribution changes need ZCC bundle measurements and compatibility checks; not prerequisites for these fixes. |
| Grok Extra High (#3984), unified machine enrollment (#3940), automation-list run action (#3994), mobile plugin previews (#3871), reduced-motion runtime glyphs (#3923), model submenu height (#4003), unread divider (#4007) | These target different ZCC provider, machine, Scheduler, plugin, composer or timeline implementations. No blanket feature-parity claim is made; each needs a focused ZCC UI/runtime assessment. |
| Contributor approval (#4004) | BB repository administration; no ZCC product change. |

## Validation

Isolated built-Electron tests exercise the changed source; attached live suites
exercise the already-running installed/dev stacks and are reported separately.

- `pnpm typecheck`: passed on the final implementation.
- Focused suites: 140 checks passed across 12 files; provider/SDK regression pass:
  26 checks across four files. A broader coverage run exercised 172 checks across
  25 files, including the entire Codex bridge suite.
- Follow-up integration pass: **208 checks passed** across 12 files, covering
  product HTTP, plugin lifecycle, Browser Automation, displayed images and host
  file reads.
- Final targeted image-reader / timeline / provider-CLI presentation checks:
  **31 / 23 / 33 passed** respectively. Title regressions: 10 passed.
  These runs overlap; the counts must not be summed as unique tests.
- V8 coverage mapped onto added executable lines in the focused production
  coverage modules: **95/96 statements (99.0%) and 49/51 branches (96.1%)**. This
  is measured patch coverage, not whole-file coverage of large legacy modules.
  The changed HTTP call site is additionally exercised by the Electron test.
- `pnpm test:e2e -- e2e/prompt-attachment-limit.spec.ts`: passed. A real PNG padded
  to exactly 35 MiB is pasted into the composer, sent and decoded in the timeline;
  image/PDF bytes round-trip through HTTP; a PDF one byte over is rejected. This
  check found the separate old 10 MiB preview-reader cap, which was then fixed.
- `pnpm test:e2e -- e2e/browser-machine-selector.spec.ts`: passed. Both machine
  name and ID reach the real desktop broker through the installed plugin SDK;
  an unknown name is rejected before that boundary. The fixture uses a missing
  desktop instance deliberately; actual BrowserView operations are covered by
  the attached Browser suite below.
- `pnpm test:e2e -- e2e/codex-writer-lock.spec.ts`: passed. The built provider
  exchanges JSON-RPC with a hermetic Codex executable, displays an entire response
  over 20 KiB, releases the session, encounters a real lock-file refusal and
  completes the follow-up after a retry. Both responses are expanded and checked
  in the actual timeline. The fixture seeds only its isolated HOME's shell files
  so production login-shell PATH repair continues to select the fake executable.
- `git diff --check`: passed.

Attached checks (the two running instances have different capabilities):

| Check | Target | Result |
| --- | --- | --- |
| `live:mode-reasoning` | Installed app, `:8780` | **54 active cases passed**, one intentionally gated counterpart skipped. Covers both Modern threads and CLI Agents, including expected unattended-policy refusals. |
| `live:memory` | Dev app, `:8781` | **Two active checks passed**, including memory CLI isolation and catalog retrieval by a hidden model thread; one gated counterpart skipped. Repeated after the successful mode suite with console interception disabled. The current suite uses the Claude provider, despite older repository prose naming Codex. |
| `live:browser` | Installed app, `:8780` | **Active test passed in 15.23 seconds**: create/acquire, loopback CDP, JPEG capture, release/close and bounded cookie-import probe; one gated counterpart skipped. Console interception disabled; no preflight skip. |

The initial mode run against `:8781` passed 23 Modern cases but failed all 31 CLI
Agent cases with `host_disconnected`. The complete installed-app rerun passed.
The dev instance has no registered desktop window, so its browser run was a
preflight skip. Conversely, the installed instance has no Memory plugin, so its
Memory run was a preflight skip. **Neither of those nominal green test summaries
counts as verification.** Disabling Vitest console interception exposed the skip
messages; the valid results above use the instance with each prerequisite.

The first attach attempt without a server URL refused ambiguous 8780/8781
discovery; subsequent runs explicitly selected their target. The same suites
were invoked directly via the control SDK's Vitest command with
`--disableConsoleIntercept` for the final Memory/Browser verification.

The update has not been committed, pushed, published or installed into the live
application. Existing and concurrent changes in this shared checkout remain
separate from this report's scope.
