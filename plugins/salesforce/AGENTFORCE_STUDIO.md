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
- **Start is the approval.** A click on Start or Send in Preview sends `startedByUser: true`, which approves that run on any org without asking in a thread. Host commands (`preview.start`/`preview.send` from an agent) never set it, and `sf_workbench` strips it from agent input, so an agent-driven run still asks in its thread.
- **Graph bridge.** The host to playground `graph` message carries `content`, `visible`, `theme` plus optional `compact`, `focus` (node id or label, at most 200 characters) and `focusSeq` (integer; bump it to re-focus the same node). The validator rejects other types.
- **Trace.** `agentLab.trace {id, planId}` reads `GET .../preview/sessions/{sid}/plans/{planId}` for Simulate sessions only. Rehearsal returns an approximation notice, Live and expired runs return `available: false` with a reason; nothing is fabricated. Results are cached per session and bounded to 200 steps. Live (CLI) trace remains unverified against a real org.
- **Suites.** `tests/<Agent>.scenario.json` (see the README for the format); `studio.suites.run` runs cases sequentially under the lab's AI budget and compares runs by `runId`.
- **Limits.** One `contributeInstructions` provider exists per plugin and its text is a snapshot at session start, so a running thread may need a fresh turn to learn new directives and verbs. A guardrail to operation link needs the agent to emit `::sf-operation` after approval.

## Studio window

The Salesforce tab is `detachable`: **Open in new window** in its toolbar moves it into its own OS window, one per project. The host owns the window (main authorizes the project and plugin, saves bounds per view, and de-dupes a second open into a focus); the plugin owns what it shows.

- **One live owner.** While the window is open the main tab does not mount the workbench, so only one surface holds the editor, preview sessions and leases. It shows `SalesforceStudioDetachedCard` instead: the project's org and target source, plus what the window shares through `studio.view.get` (open agent, unsaved edits, problem count, last preview run). It re-reads the shared view every 5 s and the org on a context change. **Focus Studio window** raises the window; **Bring back here** closes it. Closing the window by any route brings the tab back.
- **Activity bar.** Inside the window (`useZccContext().surface === 'plugin-view'`) the tab strip becomes a vertical activity bar ordered Agents, Data, Apex, Deploy, Home, and the Studio opens on Agents. It keeps its last view under `salesforce:studio-window:<projectId>`, apart from the main tab's `salesforce:project-tab:<projectId>`. No thread sits beside the window, so **Open beside agent** is hidden.
- **Cross-window org sync.** `context.select`, `project.connect` and a finished browser sign-in publish `context.changed` with `{ projectId, changeId, origin? }`. Each window tags its own context RPCs with a random `CONTEXT_ORIGIN`; `useContextChangeRelay` turns another window's change into the local `sf:context-changed` event, skips its own echo, and dedupes by `changeId` (last 32). Listeners are unchanged.
- **Drafts.** Agent drafts persist per edit in `localStorage`, which both windows share, so bringing the tab back keeps unsaved work.
- **Following the driving thread.** `sf_workbench ui.command` stamps each command with the thread that sent it (`from: { threadId, title? }`, resolved on the server from the tool context; commands that come straight from a panel name no author). Once one arrives, the document bar shows a **Following <thread>** chip with Pause. A reveal (`file.open`, `editor.reveal`, `trace.focus`, `graph.focus`) does not apply if the user edited within the last 2 s or following is paused. It waits as a toast (**Show** / **Dismiss**) and is acknowledged with `viewState.held: 'typing' | 'paused'`. A reveal the Studio would refuse is never held, so the agent gets the error at once: bad input, or a `file.open` while the draft has unsaved edits or a save is running ("Save the current draft before switching files."). Edits within 1 s after a reveal are treated as the reveal's own. Proposals, preview runs and panel changes always apply, because they do not move the cursor. `state` reports `follow: 'on' | 'paused'` and any `heldReveal`.
- **Opening an agent from another window.** While the Studio window is open, an agent card or a trace step in Preview opens the agent there instead of in a second editor. It sends `view.open` `{view: 'agentforce', path, line?}` on the window's own workbench lease (`studio-window-route.ts`), waits up to 3 s for the window to acknowledge it, then focuses the window. With no live window lease, or no acknowledgement (a window that just closed keeps its lease until it expires), it falls back to opening in place. A closing window drops its lease on `pagehide`. The server marks commands from a panel `user: true`. Only those may carry a `path` on `view.open`, and the follow gate never holds them. An agent's `ui.command` still opens files with `file.open`.
- **Presence.** Each lease poll reports `{visible, focused}` (`document.visibilityState`, `document.hasFocus()`). `ui.views` returns `window`, `visible` and `focused` per view and lists the focused window first, then visible views, then the most recently focused. A hidden window polls every 10 s, half the 20 s lease. An agent that picks the first Agentforce view reaches the window the person is looking at.
- **Window title.** `useWindowTitle` names the window after what it shows: `Agentforce · <agent> — <project> · <org>`, or `Salesforce · <view>` outside Agentforce. A production org adds a red **Production** badge, which also leads the OS title, and an unknown org an **Unknown org** warning. A selected org the CLI no longer lists counts as unknown. The main tab never sets a title.

### Quick fixes shipped with the window

- **Chat cards.** `::sf-preview` reopens the stored run read-only in Preview (`agentLab.get`).
- **Compile.** The Compile button compiles in place (`agentScript.compile`) instead of handing off to chat. The result shows under Problems, and a failed compile becomes a row at the line the compiler names. The `sf agent validate` fallback passes the org read gate, so a headless compile on a production or unknown org is refused.
- **Open in Agentforce Builder.** The toolbar's external-link button (`agentBuilder.open`) opens the saved file's bundle in Chrome, behind the same org read gate. The builder routes by id, so it resolves the bundle's version id (`1bZ…`, from `listMetadata AiAuthoringBundle`) and its project id (`1bY…`, from `GET v66.0/nextgen-authoring/bundle-versions/<versionId>` → `bundleId`), then runs `sf org open --path 'AgentAuthoring/agentAuthoringBuilder.app#/project?projectId=…&projectVersionId=…' --browser chrome`. If either lookup fails it falls back to `sf org open agent --authoring-bundle <apiName>`, which uses the CLI's `projectName` route; that route doesn't open the bundle. The CLI's frontdoor URL carries a session, so it never leaves the plugin and is redacted from error text.
- **Eval specs.** YAML eval specs count their cases (`testCases`, `tests` or `utterances`, block or flow lists). The CLI still parses the spec.
- **Deactivate.** `sf_agent lifecycle.deactivate` (`apiName`) confirms on every org kind and fails closed without a thread. The Release tool has the button.
- **Gates and threads.** `agentLab.*` passes the production/unknown-org gate, and side panels pass their `threadId`.

### Release lane

The **Release** tool (rocket, after Tests) puts Save, Compile and Publish in one lane and lists the agent's org versions, newest first, with Activate and Deactivate. The document bar's **Publish** and an agent card's **Review publish…** open it. `release.state`, `release.prepare` and `release.run` back it (`lib/release.ts`, contract in `lib/release-contract.ts`).

- **Approvals.** Each button asks the host for a sheet with `experimental_requestApproval`. The server builds the binding (`releaseBinding`) and builds it again from disk and the org on `run`, then consumes the single-use token with `zcc.ui.experimental_consumeApproval`. A token fits one action, one org (`target` = org id), one source SHA (Publish) or one BotVersion id (Activate, Deactivate), for 5 minutes. A changed file, a new active version or a reused token returns `approval_invalid`.
- **Production and unknown orgs.** The sheet makes the person type the org alias. Activate also needs passing eval evidence for exactly that version (by BotVersion id or version number), or `prepare` returns `eval_required`. On sandboxes an untested activation is allowed, and the sheet says so.
- **Reading versions.** Sandboxes list versions right away. Production and unknown orgs show **Load versions…**: one `org.read` approval lets this project read that org for 30 minutes (`ReadGrants`, at most 64 grants). The grant also lets the Compile button use the org there.
- **Viewing a version.** **View** on a version row opens its Agent Script read-only under the list, with **Diff with draft** against the editor's text (unsaved edits included). Line endings and a final newline do not count as changes. `release.versionSource {versionNumber}` backs it. It reads the version list first, so production and unknown orgs need the same read grant. It retrieves the newest 10 `AiAuthoringBundle`s of that agent into a temporary folder, never into the project, and picks the newest bundle whose `<target>` is `<apiName>.v<N>`. Only one read runs at a time, it is aborted on restart, and the folder is removed afterwards. Switching file or org closes the viewer, and a step that finishes after the switch leaves the new view alone. Bundles and the diff are capped (64 KB metadata, the editor's source limit, 1500 lines to diff). Versions built before the new Agentforce Builder have no authoring bundle, and the pane says so. Not yet checked against a real org.
- **What runs.** `run` calls the same `sf_agent` lifecycle code an agent uses, with an sdk that passes exactly the one approved envelope (`withApprovedEnvelope`). Anything else goes through the normal guardrail, which refuses without a thread. A successful Publish records `{revision, at}` so the lane can say whether the file changed since.
- **Without the desktop app.** When no host can draw the sheet, the pane says so and offers **Ask the agent**, which starts a thread with the matching `sf_agent lifecycle.*` prompt.
- **Agents.** `panel.open {tool: 'release'}` passes the org-read gate. Agents keep publishing and activating through `sf_agent`, which confirms in their thread.

`e2e/salesforce-studio-window.spec.ts` covers open, de-dupe, the window title, lease presence, an agent opened from the main window landing in the Studio window, the status card, an org picked in the window reaching the main card and the title, and Bring back from the card, from the title bar and by closing the window. `e2e/agentforce-studio.spec.ts` views a version and diffs it with the draft. It has not yet passed in a run: Electron could not start inside the agent sandbox.

### Tests table and fix loop

The **Tests** tool (`studio/TestsPane.tsx`) opens on the agent's case table. **Role-play** switches to the existing lab, mounted on first use and kept mounted after that so a running role-play survives the switch.

- **Columns.** Simulate (the editor source, stored per case), Org eval (`sf agent test run-eval` on the published agent, per case when the CLI reports cases, else totals) and Proposal (an agent's pending proposal, run with `store: false`). A row expands into expected vs actual and the agent's turns, with Run in Simulate, Ask why and Remove.
- **Specs.** `studio.suites.import` reads an `sf agent test` YAML or JSON spec into the suite (`lib/eval-spec.ts`, 256 KB cap, ids de-duplicated). `studio.suites.spec` writes `tests/<Agent>.eval.yaml`; multi-turn cases keep their first turn and are named in the reply. `studio.suites.eval` writes that spec, runs it and stores per-case outcomes when the CLI reports them. A pass is eval evidence for the Release lane.
- **Production and unknown orgs.** A headless eval there is refused. The pane offers **Allow reads…**, which takes one `org.read` approval from the Release service and retries.
- **Pinned cases.** **Save as scenario** records `pinned: {runId, at}` on the new case. The table shows a Pinned chip naming the run.
- **Fix loop.** **Make this pass** starts a loop (`lib/fix-loop.ts`) on the failing Simulate cases and opens a thread with the prompt from `fixLoopPrompt`. The agent proposes edits and runs `sf_workbench suites.run` with the `loopId`. The server claims the loop for that project and file, forces Simulate, runs only the loop's cases, never stores them, records the attempt and returns `next`. Budget 3 attempts by default (at most 5, 20 cases). A loop ends as `passed`, `exhausted`, `stopped` (Stop, or a new loop on the same file) or `expired` (30 idle minutes). The server keeps 8 loops. Changes reach the pane as `sf.studio.changed` with `kind: 'loop'`. The button waits for a save, because the agent starts from the file on disk. Agents cannot start a loop or an org eval.

`e2e/agentforce-studio.spec.ts` imports a spec into the table before the role-play steps. It has not passed in a run yet, for the same sandbox reason.
