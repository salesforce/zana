# Salesforce plugin

Official ZCC plugin (`zcc plugin install salesforce`). It is both the Salesforce
DX inner loop (org picker, doctor, SOQL Explorer, Agentforce Studio) and the **platform SDK** other plugins consume.

Install once and reuse the Salesforce CLI connection. Each project can select its
own target org; native side panels can pin a separate target without changing that
project. A project without a selection inherits the shared default.

## Install

```
zcc plugin install salesforce
```

Local Agentforce authoring works without Salesforce CLI or a connected org. The
plugin stays running; the project overview distinguishes local readiness from org
setup, missing CLI and connections that need attention. **Build an agent** opens
the local editor. **Check again** refreshes connection readiness after fixing CLI
or signing in externally, without changing any project's target.

Org operations require the Salesforce CLI (`sf`) on PATH. On a project's **Salesforce** tab,
choose **Connect org**, select Production / Developer Edition, Sandbox, or
My Domain / SSO, and choose **Sign in with browser**. An alias is optional.
For My Domain, enter the Salesforce login host (for example,
`https://company.my.salesforce.com` or `https://company--qa.sandbox.my.salesforce.com`).
Finish sign-in in your browser; the new org is selected for this project automatically.
The connection dialog can be closed while sign-in is pending; **Connect org**
reopens its progress. **Org details** keeps the existing connections separate
from sign-in, with search and explicit project-target selection.
The picker shows **Select org** until an actual target is resolved; it does not
silently choose the first listed connection. Selecting an existing org or signing
in from the project changes only that project's target. A shared default is optional.

Authentication is saved by Salesforce CLI, so the same connection works in your
terminal. Existing `sf org login web` connections appear in the org picker; use
**Refresh** after signing in externally. Connecting from **Plugins → Salesforce**
adds the connection and lets you choose whether to set it as the shared default.
Project login preserves other project targets and the CLI/shared defaults.
The browser and `sf` run on the Zana host; no password or token is entered in Zana.

To start a new project, choose **Add project → Salesforce project**. Log in first
(or choose **Use a connected org**), then confirm the project name and parent
folder. Zana creates the DX folder, registers the project with a cloud icon, sets its local CLI
`target-org`, and opens the Salesforce tab with that org selected. No folder is
created before sign-in succeeds and you choose **Create project**. If registration
or org configuration fails, **Finish setup** reuses the folder already created.
To change the icon later (or give an existing project a cloud), open the project
menu and choose an **Icon**. The project color is preserved.

## Using this plugin

| Surface | What it does |
| --- | --- |
| Plugins → Salesforce | CLI-connected org list, default alias, API version, DX root |
| Salesforce tab | Overview, Data, Apex & logs, Deployments, and Agentforce workbench |
| Add project → Salesforce project | Browser login → create a connected Salesforce DX project |
| Salesforce → Data | Schema, SOQL queries, saved history, retained drafts, and record inspectors |
| Agent side panels | Org, SOQL, object, record, Apex/logs, deployments, and operation history |
| Agentforce workspace | Salesforce AgentScript editor with configurable tool tabs on the right |
| Agentforce preview | Simulate or live Test against the selected org |
| Agent tools | `sf_soql`, `sf_apex`, `sf_lwc`, `sf_agent` |
| CLI | `zcc sf doctor`, `zcc sf org`, … |

Frontend panels call this plugin’s RPC (`soql.*`, `org`, `agentPreview.*`, `agentLab.*`). They
do not hold tokens. The server SDK owns org authentication.

From a project tab, deployment, retrieval and Anonymous Apex actions stage the
selected org and exact inputs in a thread for review. Opening the draft does not
run the action; approval still happens in the thread. **Debug logs → Refresh logs**
fetches newly generated logs without leaving the view. Data queries remain usable
if API usage or saved history cannot load; **Retry details** retries those requests.

Deployments keeps component selection beside results and history. Search metadata,
select components across types, and remove individual selections before previewing
or validating. Apex and deployments show their own activity by default; switch to
**All activity** to search other runs. On narrow panels, these sections stack.

Data separates query actions from result search and export. Drag the divider below
the editor to resize it, use the arrow keys when the divider is focused, or
double-click to reset. **Save query** and `Cmd/Ctrl+S` save the current query.
Debug logs has a filterable execution list and a text finder; **Next match** or
Enter moves through highlighted matches without altering the log.

## Optional agent tool providers

**Plugins → Salesforce → Agent tool provider** selects `both` (default),
`builtin` or `toolkit`. Both exposes the original family tools plus the toolkit.
Built-in keeps the original contracts and never imports the toolkit runtime.
Toolkit hides and disables the original family tools. `sf_workbench` remains
available for project/org selection, authoring, approvals and native panels.
Start a new agent turn/thread after switching to refresh its catalog; stale calls
to a disabled provider fail closed.

`sf_tools` provides `list`, `describe`, `call` and `result.read` for all 21 toolkit
tools, including Agent Script and Data 360. Flow, Code Analyzer and metadata also
have direct tools. Toolkit SOQL/Apex/LWC use the gateway to preserve existing
contracts in Both mode. The CLI accepts the same inputs via `zcc sf tool`.

Execution pins the registered local project and selected org. Effectful calls
use host approval. Results are bounded and referenced by opaque run IDs; evidence
is retained for at most 32 runs, with a 32 MiB/256-file limit per run, and removed
on plugin unload. Remote projects cannot execute the local toolkit adapter.

The integration is independently removable: `toolkit-adapter.ts` implements the
host bridge; `tool-provider-contract.ts` is its SDK boundary; `toolkit-runtime.ts`
lazily loads the execution package. The original Salesforce SDK and workbench
never depend on sf-agentic-tools. Other plugins consume `SalesforcePluginSdk`
from this plugin's `/sdk` export (`toolCatalog`, `toolDescribe`, `toolInvoke`,
`toolReadResult`) instead of importing toolkit internals.

The pinned v0.2.0 release is vendored with its manifest, SHA-256 and license under
`vendor/`. `build-toolkit.mjs` verifies it and builds a standalone SDK plus its
runtime resources; release packages ship `toolkit-runtime`, with no dependency
on the source checkout or node_modules. CLI prerequisites such as Salesforce CLI
and Java are discovered at runtime; consult each action's prerequisites.

## Agentforce Studio

The Studio is agent-centric. Agent tabs run along the top, one per open agent; clicking an agent in the explorer opens or focuses its tab (● unsaved, ▶ preview running). Each agent keeps its own workspace (tabs, bottom panel, rail tab, Assistant thread) and restores it when you switch back. Closing an agent tab moves to the next open agent.

- **View tabs** of the active agent: **Script**, **Preview**, **Tests** (Local, Org tests, Simulations, Rehearse), **Graph** and **Org preview**. Referenced Apex, Flow, Lightning Type and LWC open as read-only tabs of that agent.
- **Side rail** (the standard ZCC side panel beside the Studio): **Assistant** (one thread per agent), **Actions** and **Comments**. Cards and commands in the Assistant open Studio tabs instead of a thread panel. Close, hide and resize the panel with its own controls; the detached Studio window has its own panel with its own saved tabs. In a narrow window the panel covers the page until you close it.
- **Bottom panel** of the active agent: **Problems**, **Comments**, **Trace**, **Output**.
- **Studio window.** The Studio window shows Agentforce only; its header has a **Salesforce ↗** link to the general tools (Overview, Data, Apex & logs, Deployments) in the main window. While the Studio is detached, the main-window Salesforce tab keeps those tools and a card with **Show window** / **Bring back**.
- **No Release tool.** The Studio has no Release tab or Publish button. Agents publish, activate and deactivate through `sf_agent lifecycle.*`, which confirms in their thread.
- **Zana threads.** A thread's **Agent** side panel is bound to one agent: **File** (read-only, diff against disk, proposals to accept or reject, problems), **Preview**, **Tests**, **Graph**, **Actions**, **Comments** and **Open in Studio**. It has no editor and no Playground. There is also a standalone **Preview** thread panel.
- **One shared document per agent file.** The Studio editor holds an edit lease; every other surface reads the same live text, and agent edits (`editor.proposeEdit`) arrive as proposals any surface can accept. See [AGENTFORCE_STUDIO.md](./AGENTFORCE_STUDIO.md).

Through the CLI, `panel.open` / `panel.close` take a Studio tool id (`agents`, `files`, `graph`, `preview`, `test`, `actions`, `org-preview`, `comments`); `panel.show` / `panel.hide` toggle the side panel. `view.state` lists the shown tools under `panels.tabs` and switched-away tools under `panels.kept`.

**Agents** browses Agent Script authoring bundles in the selected org. The bot
button beside the filename opens it directly. Search for an agent, choose its
source version, then **Retrieve & open**. Source versions are authoring bundle
versions and can differ from published BotVersion numbers. Sources are retrieved
in an isolated temporary DX project and copied into
`agentforce/<org-id>/<bundle-name>/` in the current project. Existing local copies
and draft recovery are preserved; retrieval never overwrites local edits or
publishes changes to the org. Legacy agents without an authoring bundle are not
listed. Org changes refresh the catalog and cancel pending retrievals.

**Graph** follows the current draft. **Preview** tries that draft in a
conversation; **Tests** runs scenarios and AI customer role-play. Switching tabs
keeps conversations and test setup in place. Closing a view tab ends its session. **Org preview** selects a saved authoring bundle separately.

**Actions** groups declarations by subagent and opens Apex source or Flow maps
beside the editor. The Project/Org switch distinguishes local source from
deployed Apex or an active Flow version. Inputs & outputs compares parameter
names; Used by reveals the call and its bindings. Click an action in the graph
or Cmd/Ctrl-click its target in the editor to inspect it. The editor stays
visible, and previews remain available in their tabs.

Flow maps use Salesforce’s official Metadata Visualizer, with pan/zoom, collapsible
branches and clickable element details. **Expand Flow** opens a larger canvas;
close it or press Escape to return to the editor. It follows the app theme and
shows the selected project source or named-org version. The viewer is read-only
and runs locally. If it cannot render a Flow, the basic map and **Source** remain
available.

Open **Salesforce → Agentforce**, or the **Agent** side panel beside
a thread. **Build** provides the editor, live diagnostics and a conversation map.
The divider between the editor and Rehearse/Test is draggable. Arrow keys resize
it when focused, and double-click resets it. The width stays set across workflow
changes. Monaco applies semantic syntax colors in both light and dark themes.
The included starters pass the installed language server without diagnostics.

File and example edits recover when you switch files or leave and return to the
project tab. Recovery keeps the 12 most recent drafts locally, up to 180,000
characters each; a visible warning tells you if recovery cannot save a draft.
Use **Save as…** to turn an example into a `.agent` or `.afscript` project file.
Choose an existing folder and a new filename: existing files are never overwritten.
Normal Save checks the original disk revision, including after draft recovery;
if another tool changes the file, use Save as to preserve both versions.

**Rehearse** starts a conversation from an exact snapshot of the current editor,
including unsaved changes. Choose an engine:

- **Salesforce Preview** compiles the draft through Salesforce's Preview API and
  uses the real planner with simulated actions. Requires an Agentforce-enabled
  org and access to the named-user bootstrap/Preview endpoints. Nothing is
  published or activated, and real actions are never enabled in the Studio.
- **AI rehearsal** asks a Salesforce Models API model to interpret the script.
  Actions are imaginary. It is useful for wording, scope and conversational
  exploration; it does not validate compilation or Agentforce runtime behavior.

**Test** runs an AI customer with a persona, goal, opening message, success
criteria and a budget of 1–8 turns against either engine. Choose a preset or edit
the scenario. The customer and evaluator use the selected org's Models API,
which requires the relevant API scopes, model permissions and Einstein request
capacity. The default model is `sfdc_ai__DefaultGPT4OmniMini` (Salesforce-managed); expand
**AI model & usage** to use another model API name enabled in your org.

Results include conversation text, response latency, Preview plan IDs, org and
source fingerprint. An AI assessment includes evidence and is always advisory;
it is never activation evidence. API errors, empty replies, evaluator failures,
and stopped conversations cannot produce a passing assessment. **Export run**
downloads the tested source, scenario, transcript and assessment as JSON.

Switching Build/Rehearse/Test preserves the editor and each conversation while
the Studio stays open. Editing after a run shows a stale-snapshot notice.
**Stop** cancels in-flight requests and prevents additional turns; closing the
agent tab also closes its local handles. Draft Preview has no documented remote
DELETE contract: Salesforce owns remote expiry. Server handles expire after
30 minutes of inactivity and do not survive a plugin restart. Export evidence
before leaving. Tests offers a saved-source versus editor-draft comparison for scripted cases.

The separate **Org preview** panel retains the CLI workflow for saved authoring
bundles and published agents. Published agents always execute live actions and
therefore require the existing live-action confirmation, even when a caller
omits the live flag. The Studio does not share that live-action path.

### Studio layout, side-panel mode and Ask agent

The Studio adapts to the width of its container, so the same component serves the project tab and its own window:

- **Wide (>= 620 px):** agent tabs on top, explorer, the active agent's view tabs (Script, Preview, Tests, Graph, Org preview, read-only Apex/Flow) and a bottom panel (**Problems**, **Comments**, **Trace**); Actions, Comments and the Assistant are in the host side panel. Cmd/Ctrl+P opens quick open. Where the host gives no side panel (the browser surface), Studio falls back to its own tool rail.
- **Compact (< 620 px):** one tool at a time. A tool strip switches between **Code, Agents, Graph, Preview, Tests, Actions, Comments** and **Org preview**; the explorer becomes a file switcher and the bottom panel a sheet. The editor iframe stays mounted across tier changes, so drafts and cursor survive resizing.
- A context strip shows the active file, selection, problems and last preview run.

**Ask agent** is a menu in the top bar. It offers *Review, Fix problems, Address comments, Write scenarios, Explain selection, Generate action* and *Harden guardrails*, or a free request, plus what the agent sees (file, selection, problems, the `share` switch) and the five most recent agents on this file, which you can reopen or unlink. A request opens in the side panel's composer prefilled with the brief, so you pick the harness and send it; existing conversations open in the side panel too. Without a host side panel, the action starts or reuses a linked thread with a role (author, editor, reviewer, tester, assistant) and goes to it. Sharing the view (`share`) lets agents read the editor context through `sf_workbench view.state`. Edits an agent makes arrive as **proposals**: a diff in the editor that you accept, reject or partly accept per hunk; a newer proposal or closing the editor settles an older one as rejected.

**Comments** are anchored to line ranges with the quoted text, and can be added by you or an agent, then resolved with a note.

**Preview** has one engine switch:

| Engine | Runs | Trace |
| --- | --- | --- |
| Rehearse | AI rehearsal (Models API) | None: shown as an approximation, `available: false` |
| Simulate | Salesforce Preview API, simulated actions | Planner trace per turn (up to 200 steps, previews clipped, sensitive paths redacted); steps link to source lines |
| Live | CLI `agent preview` with real actions | Not available (the trace needs a Simulate session) |

Open a step to reveal its line. **Save as scenario** appends the run to the agent's suite and pins the case to that run (`pinned: {runId, at}`), so the table can say where a case came from.

**Scenario suites** are repo files at `tests/<AgentName>.scenario.json` (written with the same confined, SHA-checked path rules as agent files):

```json
{ "cases": [
  { "id": "refund-delayed", "name": "Delayed refund",
    "utterances": ["Where is my order A-1042?", "I want a refund"],
    "expect": { "topic": "returns", "actions": ["Create_Return"], "contains": ["refund"], "criteria": "Agent stays polite and confirms the order." } }
] }
```

A suite holds 1-50 cases with unique ids and 1-8 utterances each. `expect` is optional: `contains` is deterministic, `topic` and `actions` need a Simulate trace, and `criteria` adds an advisory AI verdict. Results are stored per case (`pass`, `fail`, `inconclusive`) outside the repo and shown as chips in Preview and the explorer.

The activity rail's **Tests** workbench lists **Local cases · Project** above **Org tests**, with shared **This agent / All agents**, search and **Has runs** filters. The side panel opens the same catalogue with the **Browse tests** header action. **Test cases** replays saved scenarios for the selected agent, **Batch simulations** runs multiple AI customer conversations across scenarios and repeats, and **Role-play** explores one AI customer conversation with its setup, chat and traces. Selecting a local suite reuses the case editor and its Simulate, org eval, import, export and fix actions. Simulate uses the current editor source for the open agent, including unsaved changes; for another agent it reads the saved project source. Suites without a matching agent file remain readable. Local suites load independently, so an org connection or read failure does not hide them. Saving local cases does not publish a Testing Center definition.

**Shared scenarios.** The **Scenarios** tab is the agent’s reusable library of customer personas, goals, openings, success criteria, turn limits and typed starting variables. Apply any variable preset saved for this agent and org, then save the scenario. **Try in Role-play** selects one setup; **Add to batch** copies it into Batch simulations. Run setup edits stay local until **Save as shared scenario** is used. Library updates require the revision you read, and runs keep their selected revision and values. Removing a shared definition does not remove earlier runs or regression cases.

**Assistant-authored tests.** Use `sf_workbench scenarios.list`, `scenarios.save` and `scenarios.remove` to manage the shared library without an org action. A new definition uses `agentPath`, `name`, `persona`, `goal`, `opening`, `criteria`, `maxTurns` and optional typed `contextVariables`; updates also require `id` and `expectedRevision`. Reuse the returned scenario fields and variables with `studio.start` or `simulations.start`, adding `origin: {id, name, revision}` from the saved definition to preserve its source revision in run snapshots. Ask the assistant to create several regression cases with `sf_workbench suites.save`, run them with `suites.run`, explore one customer with `studio.start`, or test multiple customer scenarios with `simulations.start`. Read `capabilities` for the exact inputs. Before updating a suite, read `suites.list`, preserve its existing cases and supply `expectedSha256`. Each saved case accepts typed `contextVariables`. Each simulation scenario accepts its own `contextVariables`, which replace matching batch-level defaults by name; `false`, `0`, empty text and explicit `null` are preserved. In **Batch simulations**, expand **Adjust for this batch** to edit **Starting variables** inside a copied scenario. The result shows the effective values pinned to that conversation, and **Use scenarios from this batch** restores the batch defaults and per-scenario overrides for another run.

**Reuse variable presets.** Presets saved in **Preview → Context** or **Role-play → Setup → Initial variables** are shared for the same agent and org. Select **Variable preset** inside a batch scenario's **Starting variables**, or in **Test cases → case details → Variables**. Applying a preset copies its typed values, so you can override them independently. In a saved case, click **Save case variables** to persist changes before replaying it. Preset refreshes keep chosen copies and unsaved edits intact; select the preset again to use its latest values. Batch defaults can use the same catalogue under **Run settings → Batch context preset**.

**Tests** opens on the agent's case table; **Role-play** switches to the AI role-play lab. Each row shows what the case expects and its last result per column:

| Column | Runs | Notes |
| --- | --- | --- |
| Simulate | The editor source, unsaved changes included, through Salesforce Preview | Stored per case; expand a row for expected vs actual and the agent's turns |
| Org eval | `sf agent test run-eval` against the agent published on the org | Per case when the CLI reports cases, else totals. Multi-turn cases replay the final message with complete recorded history from a matching saved-source Simulate run; earlier replies are fixed context. Use Simulate to regenerate every turn. A pass is eval evidence for `sf_agent` Activate. Production and unknown orgs need **Allow reads…** (one `org.read` approval) first |
| Proposal | An agent's pending proposal, in Simulate | Shown while a proposal is open. Results are not stored |

While a suite runs, Tests shows the current case, conversation turn, stage, completed-case count and elapsed time. Rows move from Queued to Running to their result as each case finishes. Reopening Tests recovers an active run. Org eval shows elapsed time while waiting for Salesforce; its case results arrive at the end.

**Import YAML / JSON** reads an `sf agent test` spec (`testCases`, `tests` or `utterances`, up to 256 KB) into the suite; ids that already exist get a `-2` suffix. **Write eval spec** writes `tests/<AgentName>.eval.yaml` from the suite.

**Compare saved vs draft** runs the same cases and context on both source snapshots in Simulate. It shows improved, regressed and inconclusive cases, both replies, observed actions and maximum response latency. Progress identifies the source currently running. Results do not replace the usual suite results or save the draft. Changing source or cases marks the comparison stale. Comparisons cover at most 20 cases and use fresh responses; one trial does not establish statistical improvement.

**Additional assertions.** Add case offers a maximum response latency (1–300000 ms, checked on every scripted reply) and up to ten action-field assertions as JSON:

```json
[{"action":"LookupOrder","side":"output","field":"status","operator":"equals","value":"Shipped"}]
```

Operators are `equals`, `contains`, `less_than` and `greater_than`. Every recorded invocation must pass. Only bounded, redacted scalar trace fields are available; unavailable, redacted or incomplete evidence is inconclusive. Context overrides, latency and action-field assertions stay in Simulate: org export refuses to silently drop these checks. Generated specs are capped at 256 KB. A matching captured history is required for multi-turn export, and only the exported final-turn checks become org evaluation evidence.

**Custom simulation scenarios.** Create reusable setups in **Scenarios**, then select them in **Batch simulations**. Expand **Adjust for this batch** for local changes to names, personas, goals, openings, success criteria, turn budgets and variables, or to add a one-off scenario. Use **Save as shared scenario** to keep that local setup in the library. Repeats are limited to 12 conversations total. A completed batch can restore its scenario definitions for another run; batches retain the context snapshot used during execution.

**Source navigation and Flow.** Comment and trace source links visibly select Script, including keyboard activation. Agent discovery skips build/cache folders, prioritizes source directories, retains explicitly opened files and reports incomplete scans. The official Flow canvas has **Reset Flow view** to refit after resizing and reset pan, zoom and selection.

### Repeatable sandbox smoke

With the app running, select the sandbox in this registered project and run:

```sh
node scripts/agentforce-studio-smoke.mjs --org <sandbox-alias> --project <registered-project-id> --agent <project-relative-path.agent>
```

The command verifies the exact project and known sandbox target twice, reads and diagnoses the source, compiles it, runs two Simulate turns, retrieves a real runtime trace and closes its session. Missing prerequisites, transport failures and cleanup failures exit nonzero; they never count as skipped passes. It uses the installed plugin, so rebuild/restart Zana before using it to verify newly changed runtime code. No publish or activation is part of this smoke.

**Make this pass** starts a bounded fix loop on the failing Simulate cases and hands them to a linked thread. The agent proposes edits with `ui.command editor.proposeEdit` and checks each candidate with `sf_workbench suites.run` and the `loopId`. Each run spends one attempt (3 by default, at most 5), covers only the loop's cases, runs in Simulate and is not stored. The loop ends when they pass, the budget is spent, you press Stop, it idles for 30 minutes or a new loop starts on the same file. A loop never saves, publishes or runs an org eval. Save first: the agent starts from the file on disk.

**Chat cards.** Agents can emit directives that render as live cards: `::sf-agent{path="..." line="42"}` (open the file at a line), `::sf-preview{runId="..." turn="2"}` (open a run; optional `path` names the agent whose Preview opens it), `::sf-operation{id="..."}` (live deploy/test status), and `::sf-simulation{batchId="..."}` (live Simulation lab lanes; opens Tests › Simulations on the batch). Cards and guardrail rows route through Studio intents (`src/app/studio/studio-intents.ts`): a click inside a Studio or its Assistant rail opens that Studio's tab, in a Zana thread it opens the thread's **Agent** panel, anywhere else the Studio window (if open) or project tab.

See [the design and verification notes](./AGENTFORCE_STUDIO.md) for API boundaries,
research sources and test commands.

## Reusable UI and side panels

See [UI.md](./UI.md) for browser-only components, native panel registration, target
resolution, resource descriptors, and a complete consumer example. Both Modern
threads and CLI agent sessions expose these panels from their native panel picker.

## SDK for other plugins

Reuse contract, method table, and how to extract the session kernel into
another repo: **[`SDK.md`](./SDK.md)**.

`zcc.services` is experimental. Declare a dependency and `use` a live proxy —
`import type` from `@zcc-ext/salesforce/sdk`. Do **not** npm-import
`ConnectionManager` or `createSalesforceSdk`.

```json
{
  "zcc": {
    "requires": ["salesforce"]
  }
}
```

```ts
import type { SalesforceSdk } from '@zcc-ext/salesforce/sdk';
import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';

export default function plugin(zcc: ZccPluginApi) {
  if (!zcc.services.has('salesforce')) {
    zcc.status.needsConfiguration('needs plugin: salesforce');
    return;
  }
  const sf = zcc.services.use<SalesforceSdk>('salesforce');

  zcc.agents.registerTool({
    name: 'gus_query',
    description: 'SOQL against the shared Salesforce session',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    execute: async (input: { query: string }) => {
      const page = await sf.query(input.query);
      return { alias: page.org.alias, records: page.records };
    }
  });
}
```

`connect()` / `request()` / `query()` return `PublicOrgView` only — never `accessToken`.
Prefer `query` / `queryMore` / `describeGlobal` / `describeSObject` / `limits` for REST.
Use `request({ alias })` when you must hit a non-default org. Use `execSf` for CLI
escape hatches (`sf agent …`, `sf project generate`). Mutations go through
`confirm({ kind: 'org.write', … }, threadId)` and fail closed. A `preview` that is a
JSON object (build it with `jsonPreview` from `lib/preview-json.ts` so long arrays are
elided instead of cut) renders as fields, a component table for source paths or
`Type:Name` members, and a highlighted `warning`; any other text is shown verbatim.

```ts
const org = await sf.connect();
const decided = await sf.confirm(
  {
    orgAlias: org.alias,
    orgId: org.orgId,
    orgKind: org.kind,
    kind: 'org.write',
    summary: `PATCH Account ${id}`
  },
  threadId
);
if (!decided.approved) return;
const { response } = await sf.request(`/sobjects/Account/${id}`, {
  method: 'PATCH',
  body: { Name: 'Renamed' }
});

const { sobjects } = await sf.describeGlobal();
sf.onOrgChange((next) => {
  // defaultOrg changed (or connect failed → null) — drop caches, re-query
  void next;
});
```

Frontend org pickers should keep calling `callPluginRpc('salesforce', 'orgs' | 'org' | 'status')`.
Do not share React components across plugin bundles.

Missing / disabled Salesforce throws `service_unavailable`. Start `degraded` or
`needsConfiguration` instead of crashing host `start()`.

## First-party consumers

This plugin is the first consumer of its own SDK:

- **SOQL Explorer** (`SoqlExplorer`) calls `sdk.query` / `sdk.queryMore` /
  `sdk.describeGlobal` / `sdk.describeSObject` / `sdk.limits` (and `sdk.request`
  for explain).
- **Agentforce Studio / Preview** resolve the selected org with `sdk.connect`
  (`org` RPC) and run live Test / publish / activate through `sdk.request`,
  `sdk.execSf`, and `sdk.confirm`.

A later plugin (GUS, Data Cloud, …) should look like the example above — not
like a second copy of `ConnectionManager`.

### New agents and agent control

Use **Agentforce → Agents → New agent**. Enter a name, API name and optional purpose; the editor opens a complete local draft with its companion metadata. Creation works without an org connection. Existing DX projects use their default package; other projects get an `agentforce-drafts` DX child folder. Existing names are never overwritten. Local agents appear above the org inventory; **Review publish…** carries the draft into a thread for validation and confirmed inactive publication.

The UI and automation share the same operations. `sf_workbench` with `action: capabilities` lists them. The CLI equivalent is `zcc sf action <action> --input '<JSON>' --json`; family tools are also available through `zcc sf tool <sf_agent|sf_soql|sf_apex|sf_lwc> --input '<JSON>' --json`. Commands use the current registered project context. Tool-origin approval rules still apply.

File paths, including evaluation `specPath`, are relative to the registered project. For drafts in `agentforce-drafts`, compile, preview, evaluation and publication resolve that confined DX child as the CLI working directory. `zcc sf lint [path]` also works from the parent project. An explicit source path must identify that exact bundle; a different file with the same name is never substituted. Retrieved versioned sources must first be copied with `draft.create` before publication.

Workbench controls use explicit, short-lived view IDs. List `ui.views`, submit `ui.command`, and poll `ui.result` for the renderer acknowledgement and committed `viewState`. `ui.views` reports each view's `window`, `visible` and `focused`, and lists the window the user is focused on first; with the Studio in its own window, prefer that view. Controls cover workbench tabs, Agentforce files/panels, Data queries/records, Apex forms/logs and deployment selections/history. Dirty source and changed query/form values refuse conflicting replacements. No active view means no claimed UI success. `query.execute` returns a server-owned result ID that the Data view can display with `query.show`.


| Workflow | Agent / CLI operation | Policy |
| --- | --- | --- |
| Org selection, browser login, project setup, health | `sf_workbench context.*`, `org.*`, `project.create`, `doctor` | Registered project; browser owns sign-in |
| Local new/edit/copy, org source retrieval | `sf_agent draft.*`, `files.*`, `source.*` | Confined files, revision checks; org reads mediated |
| Parse, graph data, Apex/Flow action source | `sf_agent source.parse`, `source.query`, `actions.source` | Local by default; org action source mediated |
| Preview, role-play, scenarios, evaluation | `sf_agent studio.*`, `preview.*`, `eval.*` | Existing org/runtime policy |
| Compile, publish, activate | `sf_agent compile`, `lifecycle.*` | Publication confirmation; activation is separate |
| Schema, queries, history, explain, records, export | `sf_soql` family; `sf_workbench query.*`, `records.get` | Bounded queries; sensitive reads/exports mediated |
| Apex tests, anonymous Apex, log inspection | `sf_apex`; `sf_workbench operations.*`, `logs.get` | Targeted tests and existing mutation confirmation |
| LWC source and Jest | `sf_lwc` | Confined local project |
| Metadata preview, validation, retrieve, deploy, job results | `sf_workbench metadata.list`, `operations.*` | Explicit components/tests and existing write confirmation |
| Show a view/file/query/record/log/job, manage Agentforce tools | `sf_workbench ui.views`, `ui.command`, `ui.result` | Explicit mounted view; project and org must match; acknowledgement required |
| What the user is viewing, review comments, suites, fix loops, planner trace | `sf_workbench view.state`, `comments.list/add/resolve`, `suites.list`, `suites.run`, `loop.status`, `preview.trace` | Local reads; `suites.run` and `preview.trace` read the org; a `loopId` spends one attempt of a loop the user started; shared view only |

Studio-specific `ui.command` verbs (Agentforce view): `editor.proposeEdit` (`path`, `expectedSha256`, `content` or `edits`, `summary`; the user accepts hunks and the result reports `accepted`, `rejected` or `partial`), `preview.start` and `preview.send` (`text`, `engine`: start or send in the selected engine), `trace.focus` (`runId`, `turn`, `step`), `graph.focus` (`node`) and `layout.set` (`compact`). `ui.result` accepts `waitMs` (up to 20 000) to wait for the acknowledgement instead of polling; proposals report their outcome through the same result once resolved.

These are semantic workflow controls. Pixel-level gestures such as dragging graph nodes or resizing panes remain manual, and a closed workbench must be opened before it can acknowledge display commands. A view that targets another org is refused; align it with the project's selected org first. Existing running conversations may need a fresh turn/session to receive new tools.

### Studio reliability and evidence

Studio runs saved or editor snapshots up to 10 MB. Semantic `studio.start`, `source.parse` and `source.query` also accept a confined `path` and optional `expectedSha256` to pin the saved revision.

`suites.run`, `suites.start` and `suites.compare` return a background `jobId` promptly. Poll `suites.result`; the completed payload is under `result`. Use `suites.stop` to cancel, and reuse the same `requestId` when retrying a start request. Handles survive closing the view for the current plugin session; after a restart, inspect saved suite results before launching another run. Runs cover up to 50 cases, comparisons up to 20. Completed ordinary cases are saved incrementally; candidate and comparison runs stay separate.

Tests show deterministic checks separately from the AI opinion. `expect.forbiddenActions` rejects named actions (`["*"]` forbids all). Action field checks support string, numeric, Boolean and null equality. `expect.stateChecks: [{variable: "orderExists", value: false}]` checks final scalar variable updates from a complete trace. Missing, redacted or partial runtime traces leave action checks inconclusive; an AI pass never substitutes for required action evidence. The judge receives bounded, redacted runtime evidence alongside the transcript.

Cases can declare `prerequisites: ["Account selected", "Address form saved"]`. They remain **Setup required** until the user confirms preparation for that view session. Message replay does not submit forms, load arbitrary replay JSON as mock configuration, or finish asynchronous backend work. Org replay export requires a prepared Simulate run matching the current case and source. Simulated signature output does not prove live delivery.
