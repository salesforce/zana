# Agentforce Studio design and verification

The studio is a full-width workbench owned by the Salesforce plugin. Monaco stays
mounted while the user moves between Build, Rehearse, and Test. On narrow panels
the conversation takes the available width; Build restores the editor. The host
still owns panel placement. No core plugin-specific logic was added.

Both studio dividers match ZCC's 1px split line with an invisible 11px drag target,
accent hover/drag state and keyboard focus outline. The editor/conversation divider supports pointer capture across the iframe,
keyboard resizing and double-click reset. Its split persists across studio
workflows. Semantic highlighting is explicitly enabled in Monaco: registering
the upstream semantic provider alone leaves only strings/comments colored.

Standalone workbench reads (schema, queries, records, logs, metadata and operation
reports) no longer require an agent thread. They use the existing project/org
resolver and bounded read APIs. Agent tools and write operations retain their
separate approval policies.

## Surfaces

Three surfaces share one document per agent file.

1. **Studio** (`agentforce` view of the Salesforce project tab, or the detached Studio window). The only editor.
   - Agent tabs along the top, one per open agent; the explorer lists Agents first, then the active agent's topics, uses and tests. Each agent has a workspace (`Workspace` in `src/app/studio/studio-layout.ts`: editor tabs, active tab, bottom tab, rail tab, Assistant `threadId`), keyed by path, restored on switch and pruned with `agents`.
   - View tabs of the active agent: Script, Preview, Tests (Local, Org tests, Simulations, Rehearse), Graph, Org preview, plus read-only Apex, Flow, Lightning Type and LWC tabs.
   - Host side rail: **Assistant** (one thread per agent), **Actions**, **Comments** (`RailTab`). Only Actions and Comments are registered as host panel tools (`PANEL_TOOLS` in `studio-tool-bridge.ts`); Graph, Preview, Tests and Org preview are view tabs.
   - Bottom panel: Problems, Trace, Output, Last test run, Comments.
2. **Assistant rail routing** (`src/app/studio/studio-intents.ts`). Cards and buttons call `routeStudioIntent` with a `StudioIntent` (`agent`, `preview`, `tests`, `graph`, `org-preview`, `actions`, `comments`). A click inside a registered Studio, or in the Assistant rail in the same `plugin-panel-host-layout`, is handled by that Studio's tab (`studio`). Else a Zana thread gets the `agent` panel (`thread`), else the Studio window (`studio-window`) or project tab (`project-tab`). `::sf-agent`, `::sf-preview`, `::sf-simulation` and guardrail rows route this way.
3. **Zana thread `agent` panel** (`src/app/AgentThreadPanel.tsx`, action `agent`, scopes `thread` and `agent-session`). Bound to one agent: File (read-only, diff against disk, proposals accept/reject, problems), Preview, Tests, Graph, Actions, Comments, **Open in Studio**. Params, all strings: `path` (required `.agent`/`.afscript`), `view` (`file` default, `preview`, `tests`, `graph`, `actions`, `comments`), `line`, `runId`, `turn`, `node`, `projectId`. The old `playground` thread panel action is gone; a standalone `preview` panel remains.

The Studio window shows Agentforce only (`SalesforceProjectTab.tsx`; other views are refused). Its header has **Salesforce ↗** (`salesforce-tools-link.tsx`), which routes to the project tab in the main window. While detached, the main-window tab hides the Agentforce view, keeps Overview, Data, Apex & logs and Deployments, and shows `SalesforceStudioDetachedCard`; `view.open agentforce` is refused there.

## Shared document

`lib/agent-doc-contract.ts` (types, RPC names, caps) and `lib/agent-script-document.ts` (server store). Client hook: `src/app/agent-doc/useAgentScriptDoc.ts`.

- **RPCs** (`AGENT_DOC_RPC`, scoped to the current project, path must be a safe `.agent`/`.afscript`): `agentDoc.open`, `update` (`clientId`, `rev`, `text`, `diagnostics?`), `saved` (`clientId`, `sha256`, `text`), `lease` (`take` to take over), `release`, `propose`, `resolve` (`accept`, `reject`, `applied`), `close`. Failures return `{ok:false, code, error, doc?}`; codes include `stale`, `leased`, `conflict`, `dirty`, `too_many_open`, `proposals_full`, `already_resolved`.
- **Lease.** The Studio editor is the only writer. Updates need the current `rev` (else `stale`) and the lease; a live lease held by another client returns `leased` unless `take`. The lease lapses after 45 s (`AGENT_DOC_LEASE_TTL_MS`); the hook renews it about every 15 s.
- **Proposals.** Agent edits (`editor.proposeEdit`) become `AgentDocProposal`s (`pending`, `accept-requested`, `accepted`, `rejected`). Accepting while the editor holds the lease is applied by the editor; a non-holder's accept becomes `accept-requested` and the editor applies it. With no live lease the server applies it to the disk text (`applyProposalText` in `lib/agent-doc-apply.ts`, shared with the renderer) and writes with the proposal's `expectedSha256`; a changed file returns `conflict`, a dirty doc `dirty`.
- **Caps.** 32 open documents (LRU), 20 proposals per document, 1 MiB of text (larger files are `tooLarge` with `text: null`), 12 persisted dirty buffers and 2 MiB per project.
- **Persistence.** Dirty buffers are kept in the plugin kv under `agentdoc:buffers:<projectId>`, serialized per project.
- **Realtime.** Every change publishes `sf.agentDoc.changed` `{projectId, path, rev, kind}`; clients re-open on a newer `rev`.

## Research and decisions

The local `sf-pi/extensions/sf-agentscript` implementation informed the named-user
authentication bootstrap, server compilation payload, fresh-preview `v0` sentinel,
sticky session host, bounded trace evidence and local preview end semantics.
The new implementation shares no sf-pi runtime dependency.

[Salesforce's preview reference](https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_agent_preview_start.html)
distinguishes simulated authoring bundles from published agents, which always
run live actions. The studio deliberately offers draft simulation. The older
CLI preview panel continues to serve explicit live workflows.

[LangSmith's multi-turn simulation guidance](https://docs.langchain.com/langsmith/multi-turn-simulation)
separates customer simulation from target behavior and evaluation, with an
explicit turn limit. [Synthflow simulations](https://docs.synthflow.ai/simulations)
similarly emphasize customer scenarios and measurable criteria. These informed
the persona/goal/criteria form and evidence-backed, advisory assessment.

The [Salesforce Models REST API](https://opensource.salesforce.com/einstein-platform/docs/apis/models)
provides the customer, approximate script actor, and evaluator via
`generationDetails.generations[].content`. A model must be enabled in the org.
No credentials or model keys are entered in the renderer.

## Boundaries

- `agentLab.*` RPCs enter the existing `ProjectContexts` resolver. Session handles
  are bound to the resolved project. The renderer supplies source text, never
  a filesystem anchor, token, or destination URL.
- Org credentials bootstrap at the org's HTTPS Salesforce origin. All SFAP calls
  target the fixed production/test/dev Salesforce hosts. Redirects are rejected,
  requests time out after 60 seconds and bodies are capped at 2 MiB. Only a 404
  on an unpinned request walks the known hosts; failed POSTs are not replayed.
- Preview start pins `enableSimulationMode: true` and `bypassUser: false`.
  Subsequent sends retain their original org credential and host. The source
  SHA-256 identifies the exact editor snapshot, including whitespace.
- At most 12 sessions/start operations exist. Per-session calls are serialized,
  AI calls capped at 50, automated turns at 8, manual turns at 20, source at
  10 MB (`AGENT_SOURCE_MAX`) and each agent reply at 32,000 characters. End/dispose
  aborts pending requests. Sessions expire lazily after 30 idle minutes.
- The server owns the transcript used by the customer/evaluator. Renderer-sent
  transcripts are ignored. Missing/malformed/failed output marks the run
  incomplete. An evaluator verdict is labeled advisory and never enters the
  activation evidence store.
- The iframe bridge requires both the expected origin and the actual frame
  window. Snapshot messages are bounded and separate from file writes.

## Verification

```sh
pnpm exec vitest run plugins/salesforce/src
pnpm exec tsc --noEmit -p tsconfig.json
pnpm exec tsc --noEmit -p plugins/salesforce/playground/tsconfig.json
pnpm --filter @zcc-ext/salesforce build
pnpm run build
pnpm run test:e2e:only -- e2e/agentforce-studio.spec.ts e2e/salesforce-workbench.spec.ts
```

`agentforce-studio.spec.ts` installs a fixture using the real plugin factory and
transport; only upstream fetch is redirected to a deterministic HTTP server.
It exercises real Monaco edits, snapshot transfer, plugin RPC, auth bootstrap,
compilation, a >20 KiB response, manual preview, AI rehearsal and role-play,
evaluation, failures, cancellation and responsive light/dark layouts in the
built Electron app. It uses no Salesforce credentials or model spend.

Verified on 2026-09-20:

- 304 tests across 52 Salesforce test files passed.
- New lab/transport/UI coverage: 95.22% statements, 92.74% branches,
  95.31% functions, 98.75% lines.
- Follow-up splitter coverage: 100% statements, 93.75% branches; workbench service:
  98.11% statements, 88% branches.
- Both TypeScript checks and the plugin/production app builds passed.
- Both built-Electron specs passed. The studio spec also drives
  the existing CLI preview from a project tab and verifies a complete 23 KiB
  child-process response through RPC to the UI.
- The studio spec checks actual semantic keyword colors in both themes and
  dragging across the Monaco iframe. The workbench spec covers standalone
  production-org schema, queries without LIMIT and record inspection.
- Reviewed light, dark and narrow layouts.
- Corrected all three starter scripts against the actual language service and
  fixed sibling transitions being drawn as a misleading chain in the graph.

Real org rollout remains a separate acceptance step: select a development org,
start a manual Salesforce Preview conversation, run a short two-turn role-play,
and inspect/export its evidence. This needs Preview and Models API entitlements.
Deterministic fixtures do not prove target-org availability or model behavior.
Only the production GUS org was connected during implementation, so no live
Preview or Models API calls were made against it. Built bundles are updated in
this checkout. The installed Salesforce plugin was reloaded in the user's app;
syntax colors and keyboard resizing were also checked in its live studio.

## Follow-up priorities

1. ~~Repository scenario suites with import, save and exact rerun.~~ Shipped as the Tests table (below).
2. Run comparison and changes in outcome for a specific source/version.
3. Planner trace drill-down, variable seeds and graph-to-source navigation.
4. Generic app inference capability for customer/evaluator models, avoiding a
   Models API entitlement dependency while preserving tool-free role-play.
5. Exact-version release contracts and activation evidence, following sf-pi's
   fail-closed release lifecycle rather than treating a rehearsal as approval.

## Action explorer

Actions now appear below the project files, grouped by their owning start agent,
subagent or topic. The official parser supplies declarations, parameter types,
source locations and explicit calls; model bindings are read from the CST header
of the corresponding AST node. Scope forms part of each action's identity.
The explorer follows the current draft, including unsaved changes.

Open an action from the explorer, its conversation-map node, or by Ctrl/Cmd-clicking
its `target:` line. Related tabs share the editor area; the agent's Monaco model,
undo history, draft and Rehearse/Test conversation remain mounted. The tab strip
keeps at most eight related sources. “Used by” distinguishes explicit runs from
model availability and reveals the original definition or binding in the script.

Implementation previews are read-only:

- Apex uses a separate Monaco model with Apex syntax colors and reveals the
  invocable method. Org contracts come from the registered Actions API, not a
  guess from the Apex source. Managed or permission-restricted classes can still
  show a contract when source is unavailable.
- Flow uses Salesforce’s official Metadata Visualizer for connectors, decision
  labels, fault paths, loops, and scheduled/asynchronous branches. Select an
  element for its properties, collapse branches, or pan/zoom. **Expand Flow**
  opens a larger canvas while preserving the agent editor and conversation.
  Referenced subflows and Apex classes are available under **Related implementations**.
  XML/JSON remains available in Source. Parser or frame failures show the existing
  basic map (capped at 120 steps/300 edges with a visible notice).
- Inputs & outputs compares declared names with local Flow variables or the org
  contract. It explicitly leaves local Apex contracts unverified. A matching
  name is not a claim that types or runtime behavior are compatible. Call-site
  input/output bindings are shown verbatim under Used by.
- Last preview explains that the current integration has messages and plan IDs,
  not verified action execution events. Simulation is not evidence that an
  implementation ran. No action telemetry is fabricated.

Source selection is explicit: Project is a local snapshot; Org is deployed Apex
or the active Flow version in the named org. Switching orgs invalidates visible
results immediately and ignores late replies. Source is fetched only on demand.
The backend derives the root from the registered project context, confines every
candidate with realpath, honors DX package directories and namespaces, rejects
ambiguous matches until selected, skips symlink cycles, caps scans at 6,000 entries
and 16 levels, caps source files at 750 KB and HTTP responses at 2 MB, and admits
at most four concurrent source requests. It never fetches an entire org's metadata.

Action verification adds parser, source resolver, Flow model, component and bridge
coverage, plus a built-Electron action journey. The Electron test exercises the
actual file resolver, bounded HTTP reader, RPC and Monaco iframe; it checks a
complete deployed source larger than 20 KiB, both editor themes, read-only behavior,
Flow branches and dependency navigation, graph/target links, a narrow window and
preserved unsaved draft plus active Preview conversation. Upstream Salesforce
responses are deterministic fixtures; no Apex or Flow executes during these tests.

Action explorer verification on 2026-09-20: the full Salesforce suite passed
329 tests in 56 files, followed by the added cyclic-Flow keyboard regression
(8/8 action component tests). Focused action/model/source/bridge coverage recorded
97.63% statements and 92.76% branches; the final Flow map pass covers 96.15%
statements and 94.11% branches. The plugin build, root typecheck and playground
typecheck pass. The final action journey passed in built Electron using a private
copy of the production build and SQLite binary, isolating it from concurrent
builds/native-ABI switches in this shared checkout. The installed path plugin was reloaded
successfully. Real org source permissions and API availability remain unverified.


### Official Flow viewer implementation

The plugin pins `@salesforce/metadata-visualizer-web` 1.7.0 (BSD-3-Clause).
`build-flow-visualizer.mjs` generates self-contained light/dark HTML assets and
copies the package license. No CDN or external rendering service is used.
`flow-visualizer-bundle.ts` makes one guarded adaptation to the pinned bundle:
it omits `contentCenterX` so the SDK uses its full-layout centering fallback,
instead of centering the main branch and clipping scheduled/fault branches.
An unexpected or duplicate integration point fails the build and requires
review on SDK upgrades. The viewer remounts the immutable snapshot after resizing
settles to recalculate fit at the current size. The compact toolbar also offers
Fit view and Expand Flow. Electron verifies the diagram bounds stay inside the
canvas after resizing automatically.
The backend parses only the already-authorized local XML or org metadata
snapshot through a read-only virtual filesystem. The SDK never receives disk
access. Input is capped at 750 KB, depth 40 and 25,000 metadata tags; interactive
models are capped at 500 nodes, 1,000 edges and 2 MB, then fall back to the basic map.
DTD/entity declarations are rejected before parsing.

The iframe has only `allow-scripts`, an opaque origin and a CSP that denies
network access. Its message handler checks both frame identity and origin,
returns only the parsed data and synthetic source name, and exposes no edit or
execution commands. Source provenance/version stays in the host UI. Timers,
message listeners and theme observers are removed on unmount. A missing frame
handshake falls back after ten seconds. This is a visual source inspector, not
Flow Builder or a Flow execution preview.

Verification on 2026-09-24: 533 Salesforce tests in 75 files; focused viewer,
filesystem, parser and action-panel coverage is 100% lines and 93.72% branches.
Root typecheck and plugin build pass. Two built-Electron journeys cover local
and org source, expanded-view focus restoration, light/dark and narrow layouts,
element details, fault/loop/scheduled branches, related implementations, blocked
frame fallback and unchanged source files. Real org permissions remain outside
these fixture-based checks.


## Studio layout and agent collaboration

All Studio CSS uses one `--sf-*` token set (`src/app/studio/studio-tokens.ts`) mapped onto host tokens: `bg`, `surface`, `elevated`, `sunken`, `text`, `muted`, `border`, `accent`, `soft`, `on-accent`, `danger`, `success` and `warn`. Every style string that uses them begins with `STUDIO_TOKENS`, so panels render correctly standalone or inside the Studio. The older `--sf-as-*`, `--af-*` and `--sf-soql-*` aliases are gone.

Layout follows the container width (`useWidthTier`, breakpoints 400, 620, 960): wide shows explorer, editor tabs, bottom panel and right rail; compact shows one tool at a time with a tool strip. The Monaco iframe is never remounted when the tier changes. Panel params (`path`, `line`, `tool`, `apiName`, `readOnly`) have a single parser, `parseAgentforcePanelFocus` in `agentforce-panel-params.ts`, shared by chat cards, guardrail links and `AgentScriptPanel`.

Agent collaboration:

- **Shared view.** The panel publishes path, SHA, cursor, selection, tool, last run and up to 50 diagnostics (`studio.view.publish`). Agents read it with `sf_workbench view.state` only while sharing is on.
- **Proposals.** `editor.proposeEdit` is rejected if the open file or its SHA differs. The editor shows a diff; the user resolves hunks. A newer proposal, a file switch or closing the editor settles pending ones as rejected with a note.
- **Comments.** `comments.list/add/resolve` (`studio.comments.*`) store anchored review items; changes broadcast on `sf.studio.changed`.
- **Preview commands.** `preview.start` and `preview.send` reach `PreviewWorkbench` through a controlled `command` prop (`{ seq, type, text?, engine? }`). Each `seq` runs once, after the selected engine matches; `send` starts a session first if none is running. Failures show in the workbench error banner. Preview offers Simulate and Live only (`PREVIEW_ENGINES`); Rehearse is hidden for now, so `engine: 'rehearse'` is rejected and a stale Rehearse selection runs Simulate. The lab rehearsal engine and the Tests role-play still use it.
- **A click is the approval.** Start, Send and End in Org preview and Preview, Compile, Open in Builder, Simulate and Run in Tests, and suite runs send `startedByUser: true`. On the server, `clickedSdk` (`lib/release.ts`) treats that click as the org-read approval, so nothing is asked in a thread. It approves org reads only: publish, activate and deactivate still confirm. Host commands (`preview.start`/`preview.send` from an agent) never set the flag, `sf_workbench` strips it from agent input, and fix-loop suite attempts never carry it, so agent-driven runs still ask in their thread.
- **Live without `default_agent_user`.** `sf agent preview` crashes on an authoring bundle whose config has no `default_agent_user` (employee agents and new drafts). `runAgentPreview` sends those previews, Simulate or Live, to the lab's Preview API instead (`live` sets `enableSimulationMode: false`) and remembers the session id so send and end follow it. It still mediates first, so an agent-driven Live start or send asks in its thread. Bundles that name a user stay on the CLI; if it still crashes on that field, the error says to add it.
- **Graph bridge.** The host to playground `graph` message carries `content`, `visible`, `theme` plus optional `compact`, `focus` (node id or label, at most 200 characters) and `focusSeq` (integer; bump it to re-focus the same node). The validator rejects other types.
- **Trace.** `agentLab.trace {id, planId}` reads `GET .../preview/sessions/{sid}/plans/{planId}` for Simulate sessions only. Rehearsal returns an approximation notice, Live and expired runs return `available: false` with a reason; nothing is fabricated. Results are cached per session and bounded to 200 steps. Live (CLI) trace remains unverified against a real org.
- **Suites.** `tests/<Agent>.scenario.json` (see the README for the format); `studio.suites.run` runs cases sequentially under the lab's AI budget and compares runs by `runId`.
- **Limits.** One `contributeInstructions` provider exists per plugin and its text is a snapshot at session start, so a running thread may need a fresh turn to learn new directives and verbs. A guardrail to operation link needs the agent to emit `::sf-operation` after approval.

## Studio window

The Salesforce tab is `detachable`: **Open in new window** in its toolbar moves it into its own OS window, one per project. The host owns the window (main authorizes the project and plugin, saves bounds per view, and de-dupes a second open into a focus); the plugin owns what it shows.

- **One live owner.** While the window is open the main tab does not mount the workbench, so only one surface holds the editor, preview sessions and leases. It shows `SalesforceStudioDetachedCard` instead: the project's org and target source, plus what the window shares through `studio.view.get` (open agent, unsaved edits, problem count, last preview run). It re-reads the shared view every 5 s and the org on a context change. **Focus Studio window** raises the window; **Bring back here** closes it. Closing the window by any route brings the tab back.
- **Agentforce only.** Inside the window (`useZccContext().surface === 'plugin-view'`) the Studio is the only view; other views are refused, and **Salesforce ↗** opens the general tools in the main window. It keeps its last state under `salesforce:studio-window:<projectId>`, apart from the main tab's `salesforce:project-tab:<projectId>`. No thread sits beside the window, so **Open beside agent** is hidden.
- **Cross-window org sync.** `context.select`, `project.connect` and a finished browser sign-in publish `context.changed` with `{ projectId, changeId, origin? }`. Each window tags its own context RPCs with a random `CONTEXT_ORIGIN`; `useContextChangeRelay` turns another window's change into the local `sf:context-changed` event, skips its own echo, and dedupes by `changeId` (last 32). Listeners are unchanged.
- **Drafts.** Agent drafts persist per edit in `localStorage`, which both windows share, so bringing the tab back keeps unsaved work.
- **Following the driving thread.** `sf_workbench ui.command` stamps each command with the thread that sent it (`from: { threadId, title? }`, resolved on the server from the tool context; commands that come straight from a panel name no author). Once one arrives, the document bar shows a **Following <thread>** chip with Pause. A reveal (`file.open`, `editor.reveal`, `trace.focus`, `graph.focus`) does not apply if the user edited within the last 2 s or following is paused. It waits as a toast (**Show** / **Dismiss**) and is acknowledged with `viewState.held: 'typing' | 'paused'`. A reveal the Studio would refuse is never held, so the agent gets the error at once: bad input, or a `file.open` while the draft has unsaved edits or a save is running ("Save the current draft before switching files."). Edits within 1 s after a reveal are treated as the reveal's own. Proposals, preview runs and panel changes always apply, because they do not move the cursor. `state` reports `follow: 'on' | 'paused'` and any `heldReveal`.
- **Opening an agent from another window.** While the Studio window is open, an agent card or a trace step in Preview opens the agent there instead of in a second editor. It sends `view.open` `{view: 'agentforce', path, line?}` on the window's own workbench lease (`studio-window-route.ts`), waits up to 3 s for the window to acknowledge it, then focuses the window. With no live window lease, or no acknowledgement (a window that just closed keeps its lease until it expires), it falls back to opening in place. A closing window drops its lease on `pagehide`. The server marks commands from a panel `user: true`. Only those may carry a `path` on `view.open`, and the follow gate never holds them. An agent's `ui.command` still opens files with `file.open`.
- **Presence.** Each lease poll reports `{visible, focused}` (`document.visibilityState`, `document.hasFocus()`). `ui.views` returns `window`, `visible` and `focused` per view and lists the focused window first, then visible views, then the most recently focused. A hidden window polls every 10 s, half the 20 s lease. An agent that picks the first Agentforce view reaches the window the person is looking at.
- **Window title.** `useWindowTitle` names the window after what it shows: `Agentforce · <agent> — <project> · <org>`. A production org adds a red **Production** badge, which also leads the OS title, and an unknown org an **Unknown org** warning. A selected org the CLI no longer lists counts as unknown. The main tab never sets a title.

### Quick fixes shipped with the window

- **Chat cards.** `::sf-preview` reopens the stored run read-only in Preview (`agentLab.get`); its optional `path` attribute names the agent whose Preview opens it. `::sf-agent` supports `path` and `line` only (the old `tool`, `apiName`, `readOnly` attributes are ignored).
- **Compile.** The Compile button compiles in place (`agentScript.compile`) instead of handing off to chat. The result shows under Problems, and a failed compile becomes a row at the line the compiler names. The `sf agent validate` fallback passes the org read gate, so a headless compile on a production or unknown org is refused.
- **Open in Agentforce Builder.** The toolbar's external-link button (`agentBuilder.open`) opens the saved file's bundle in Chrome, behind the same org read gate. The builder routes by id, so it resolves the bundle's version id (`1bZ…`, from `listMetadata AiAuthoringBundle`) and its project id (`1bY…`, from `GET v66.0/nextgen-authoring/bundle-versions/<versionId>` → `bundleId`), then runs `sf org open --path 'AgentAuthoring/agentAuthoringBuilder.app#/project?projectId=…&projectVersionId=…' --browser chrome`. If either lookup fails it falls back to `sf org open agent --authoring-bundle <apiName>`, which uses the CLI's `projectName` route; that route doesn't open the bundle. The CLI's frontdoor URL carries a session, so it never leaves the plugin and is redacted from error text.
- **Eval specs.** YAML eval specs count their cases (`testCases`, `tests` or `utterances`, block or flow lists). The CLI still parses the spec.
- **Deactivate.** `sf_agent lifecycle.deactivate` (`apiName`) confirms on every org kind and fails closed without a thread. The Studio has no button for it.
- **Gates and threads.** `agentLab.*` passes the production/unknown-org gate, and side panels pass their `threadId`.

### Release (no Studio tool)

The Studio no longer has a Release tool, Publish button or version viewer (`ReleasePane` is removed). The server side stays:

- `release.state`, `release.prepare`, `release.run` and `release.versionSource` (`lib/release.ts`, `lib/release-contract.ts`) are still registered. The Studio calls only `prepare`/`run` with `action: 'org.read'`: Tests and Org tests offer **Allow reads…** on production and unknown orgs, which takes one host-signed approval and grants this project org reads for 30 minutes (`ReadGrants`).
- Publish, Activate and Deactivate run through `sf_agent lifecycle.*`, which confirms in the agent's thread. Activate still needs passing eval evidence for that exact version; a Studio org eval pass records it.
- A click in the Studio is the org-read approval (`clickedSdk`, see above); publish, activate and deactivate still confirm.
- Not reachable from the UI: release lane buttons, the version list, **View** / **Diff with draft**. `panel.open {tool: 'release'}` is no longer a valid tool.

### Tests table and fix loop

The **Tests** tool (`studio/TestsPane.tsx`) opens on the agent's case table. **Role-play** switches to the existing lab, mounted on first use and kept mounted after that so a running role-play survives the switch.

- **Columns.** Simulate (the editor source, stored per case), Org eval (`sf agent test run-eval` on the published agent, per case when the CLI reports cases, else totals) and Proposal (an agent's pending proposal, run with `store: false`). A row expands into expected vs actual and the agent's turns, with Run in Simulate, Ask why and Remove.
- **Specs.** `studio.suites.import` reads an `sf agent test` YAML or JSON spec into the suite (`lib/eval-spec.ts`, 256 KB cap, ids de-duplicated). `studio.suites.spec` writes `tests/<Agent>.eval.yaml`; multi-turn cases replay their final turn with recorded alternating user/agent history and required topic evidence from a matching saved-source Simulate run. Earlier replies remain fixed context. Missing/stale history, unsupported local assertions and exports over 256 KB are refused. `studio.suites.eval` writes that spec, runs it and stores per-case outcomes when the CLI reports them. A pass is eval evidence for `sf_agent` Activate.
- **Production and unknown orgs.** A headless eval there is refused. The pane offers **Allow reads…**, which takes one `org.read` approval from the release service (`release.prepare`/`release.run`) and retries.
- **Pinned cases.** **Save as scenario** records `pinned: {runId, at}` on the new case. The table shows a Pinned chip naming the run.
- **Fix loop.** **Make this pass** starts a loop (`lib/fix-loop.ts`) on the failing Simulate cases and opens a thread with the prompt from `fixLoopPrompt`. The agent proposes edits and runs `sf_workbench suites.run` with the `loopId`. The server claims the loop for that project and file, forces Simulate, runs only the loop's cases, never stores them, records the attempt and returns `next`. Budget 3 attempts by default (at most 5, 20 cases). A loop ends as `passed`, `exhausted`, `stopped` (Stop, or a new loop on the same file) or `expired` (30 idle minutes). The server keeps 8 loops. Changes reach the pane as `sf.studio.changed` with `kind: 'loop'`. The button waits for a save, because the agent starts from the file on disk. Agents cannot start a loop or an org eval.

`e2e/agentforce-studio.spec.ts` covers spec import, role-play, official Flow reset, cache-safe discovery, keyboard source navigation, saved-source versus draft comparison, custom scenarios and narrow/light layouts through the built Electron boundary. See the README for the repeatable real-sandbox smoke command and current evaluation fidelity limits.

## Evidence and background run contracts

Semantic `suites.run`, `suites.start` and `suites.compare` return job handles; poll `suites.result` for the completed payload and fix-loop `result.next`. Use a stable `requestId` per logical attempt. `suites.stop` aborts the active session; ordinary completed case evidence is saved incrementally. Handles are bounded and owned by the current plugin session/project, while saved results survive reload. The native compatibility `studio.suites.run` callback remains for older clients; current UI and semantic actions use background jobs.

Deterministic expectations include required/forbidden actions, scalar action inputs/outputs, final scalar variable state, reply text and response latency. Partial/missing trace evidence stays inconclusive. AI grading receives bounded redacted trace evidence and remains a separately labelled opinion. Cases with prerequisites are blocked until prepared for that view session; message replay does not silently configure historical reference fixtures or perform form/async setup.
