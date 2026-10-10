# Salesforce plugin

Official ZCC plugin (`zcc plugin install salesforce`). It is both the Salesforce
DX inner loop (org picker, doctor, SOQL Explorer, Agentforce playground /
preview) and the **platform SDK** other plugins consume.

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

The Salesforce AgentScript editor stays in the center. The right side panel starts
with **File explorer**; use **+** to add **Agents**, **Graph view**, **Preview**, **Tests**,
**Actions**, or **Org preview**. Close individual tabs, hide the panel, or resize
it with the divider (drag, arrow keys, double-click to reset). On narrow surfaces,
tools stack below the editor. The tab layout is remembered per project.

**Agents** browses Agent Script authoring bundles in the selected org. The bot
button beside the filename opens it directly. Search for an agent, choose its
source version, then **Retrieve & open**. Source versions are authoring bundle
versions and can differ from published BotVersion numbers. Sources are retrieved
in an isolated temporary DX project and copied into
`agentforce/<org-id>/<bundle-name>/` in the current project. Existing local copies
and draft recovery are preserved; retrieval never overwrites local edits or
publishes changes to the org. Legacy agents without an authoring bundle are not
listed. Org changes refresh the catalog and cancel pending retrievals.

**Graph view** follows the current draft. **Preview** tries that draft in a
conversation; **Tests** runs scenarios and AI customer role-play. Switching tabs
or hiding the panel keeps conversations and test setup in place. Closing a tool
ends its session. **Org preview** selects a saved authoring bundle separately.

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

Open **Salesforce → Agentforce**, or the Agentforce playground beside
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
the playground stays open. Editing after a run shows a stale-snapshot notice.
**Stop** cancels in-flight requests and prevents additional turns; closing the
playground also closes its local handles. Draft Preview has no documented remote
DELETE contract: Salesforce owns remote expiry. Server handles expire after
30 minutes of inactivity and do not survive a plugin restart. Export evidence
before leaving; saved scenario suites and cross-run comparison are future work.

The separate **Org preview** panel retains the CLI workflow for saved authoring
bundles and published agents. Published agents always execute live actions and
therefore require the existing live-action confirmation, even when a caller
omits the live flag. The Studio does not share that live-action path.

### Studio layout, side-panel mode and Assistant

The Studio adapts to the width of its container, so the same component serves the full tab and the thread side panel:

- **Wide (>= 620 px):** activity strip, explorer, editor tabs (agents and read-only Apex/Flow), a bottom panel (**Problems**, **Comments**, **Trace**) and a right rail (**Assistant** plus the tool tabs). Cmd/Ctrl+P opens quick open.
- **Compact / side panel (< 620 px):** one tool at a time. A tool strip switches between **Code, Preview, Tests, Graph, Actions, Data, Deploy, Comments** and **Agents**; the explorer becomes a file switcher and the bottom panel a sheet. The editor iframe stays mounted across tier changes, so drafts and cursor survive resizing. Data results become cards and Deploy a vertical stepper below about 520 px.
- A context strip shows the active file, selection, problems and last preview run.

**Assistant** is the right rail (a pane in compact mode). **Ask the agent** offers *Review, Fix problems, Address comments, Write scenarios, Explain selection, Generate action* and *Harden guardrails*, or a free request. Each action starts or reuses a linked thread with a role (author, editor, reviewer, tester, assistant); linked threads are listed and open inline. Sharing the view (`share`) lets agents read the editor context through `sf_workbench view.state`. Edits an agent makes arrive as **proposals**: a diff in the editor that you accept, reject or partly accept per hunk; a newer proposal or closing the editor settles an older one as rejected.

**Comments** are anchored to line ranges with the quoted text, and can be added by you or an agent, then resolved with a note.

**Preview** has one engine switch:

| Engine | Runs | Trace |
| --- | --- | --- |
| Rehearse | AI rehearsal (Models API) | None: shown as an approximation, `available: false` |
| Simulate | Salesforce Preview API, simulated actions | Planner trace per turn (up to 200 steps, previews clipped, sensitive paths redacted); steps link to source lines |
| Live | CLI `agent preview` with real actions | Not available (the trace needs a Simulate session) |

Open a step to reveal its line. **Save as scenario** appends the run to the agent's suite.

**Scenario suites** are repo files at `tests/<AgentName>.scenario.json` (written with the same confined, SHA-checked path rules as agent files):

```json
{ "cases": [
  { "id": "refund-delayed", "name": "Delayed refund",
    "utterances": ["Where is my order A-1042?", "I want a refund"],
    "expect": { "topic": "returns", "actions": ["Create_Return"], "contains": ["refund"], "criteria": "Agent stays polite and confirms the order." } }
] }
```

A suite holds 1-50 cases with unique ids and 1-8 utterances each. `expect` is optional: `contains` is deterministic, `topic` and `actions` need a Simulate trace, and `criteria` adds an advisory AI verdict. Results are stored per case (`pass`, `fail`, `inconclusive`) outside the repo and shown as chips in Preview and the explorer.

**Chat cards.** Agents can emit directives that render as live cards: `::sf-agent{path="..." line="42"}` (open the file at a line; optional `tool`, `apiName` and `readOnly` open a tool or a dependency), `::sf-preview{runId="..." turn="2"}` (open a run) and `::sf-operation{id="..."}` (live deploy/test status). Guardrail rows deep link into the same panel params.

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
- **Agentforce playground / preview** resolve the selected org with `sdk.connect`
  (`org` RPC) and run live Test / publish / activate through `sdk.request`,
  `sdk.execSf`, and `sdk.confirm`.

A later plugin (GUS, Data Cloud, …) should look like the example above — not
like a second copy of `ConnectionManager`.

### New agents and agent control

Use **Agentforce → Agents → New agent**. Enter a name, API name and optional purpose; the editor opens a complete local draft with its companion metadata. Creation works without an org connection. Existing DX projects use their default package; other projects get an `agentforce-drafts` DX child folder. Existing names are never overwritten. Local agents appear above the org inventory; **Review publish…** carries the draft into a thread for validation and confirmed inactive publication.

The UI and automation share the same operations. `sf_workbench` with `action: capabilities` lists them. The CLI equivalent is `zcc sf action <action> --input '<JSON>' --json`; family tools are also available through `zcc sf tool <sf_agent|sf_soql|sf_apex|sf_lwc> --input '<JSON>' --json`. Commands use the current registered project context. Tool-origin approval rules still apply.

File paths, including evaluation `specPath`, are relative to the registered project. For drafts in `agentforce-drafts`, compile, preview, evaluation and publication resolve that confined DX child as the CLI working directory. `zcc sf lint [path]` also works from the parent project. An explicit source path must identify that exact bundle; a different file with the same name is never substituted. Retrieved versioned sources must first be copied with `draft.create` before publication.

Workbench controls use explicit, short-lived view IDs. List `ui.views`, submit `ui.command`, and poll `ui.result` for the renderer acknowledgement and committed `viewState`. Controls cover workbench tabs, Agentforce files/panels, Data queries/records, Apex forms/logs and deployment selections/history. Dirty source and changed query/form values refuse conflicting replacements. No active view means no claimed UI success. `query.execute` returns a server-owned result ID that the Data view can display with `query.show`.


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
| What the user is viewing, review comments, suites, planner trace | `sf_workbench view.state`, `comments.list/add/resolve`, `suites.list`, `preview.trace` | Local reads; `preview.trace` reads the org; shared view only |

Studio-specific `ui.command` verbs (Agentforce view): `editor.proposeEdit` (`path`, `expectedSha256`, `content` or `edits`, `summary`; the user accepts hunks and the result reports `accepted`, `rejected` or `partial`), `preview.start` and `preview.send` (`text`, `engine`: start or send in the selected engine), `trace.focus` (`runId`, `turn`, `step`), `graph.focus` (`node`) and `layout.set` (`compact`). `ui.result` accepts `waitMs` (up to 20 000) to wait for the acknowledgement instead of polling; proposals report their outcome through the same result once resolved.

These are semantic workflow controls. Pixel-level gestures such as dragging graph nodes or resizing panes remain manual, and a closed workbench must be opened before it can acknowledge display commands. A view that targets another org is refused; align it with the project's selected org first. Existing running conversations may need a fresh turn/session to receive new tools.
