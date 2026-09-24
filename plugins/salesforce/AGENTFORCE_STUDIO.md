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
  180,000 characters and each agent reply at 32,000 characters. End/dispose
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
- Reviewed light, dark and narrow layouts. Screenshots are in
  [`artifacts/agentforce-studio`](../../artifacts/agentforce-studio/).
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

1. Repository scenario suites with import, save and exact rerun.
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
builds/native-ABI switches in this shared checkout. Screenshots are saved under
`artifacts/agentforce-studio/actions-*.png`. The installed path plugin was reloaded
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
