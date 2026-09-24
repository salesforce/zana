---
name: salesforce-dx
description: Playbook for ZCC Salesforce DX tools. Use when querying an org, running Apex tests or anonymous Apex, inspecting LWCs, compiling Agentforce .agent files, or checking Salesforce CLI/org health.
---

# Salesforce DX playbook

Prefer the family tools over guessing schema or `sf data query` dumps. Humans exploring org data should open the project's **SOQL** tab (project menu or command palette: Open SOQL Explorer) rather than asking the agent to page through large result sets.

```bash
zcc sf doctor
zcc sf org
zcc sf lint [path]
```

The Salesforce project tab lists every org the Salesforce CLI has authenticated (`sf org list`). Picking one saves the project's target for **SOQL**, Apex, LWC, Agentforce Preview, and the family tools. The plugin settings' `defaultOrg` is the shared fallback. `zcc sf org` prints that same roster (no tokens) and the resolved target.

For a new connection, use **Salesforce → Connect org → Sign in with browser**.
Choose Production / Developer Edition, Sandbox, or My Domain / SSO (a Salesforce
login URL); the alias is optional. The CLI saves authentication and the plugin
selects the new org for that project, preserving shared and CLI defaults. Existing
terminal logins can be loaded with **Refresh**. Never ask for a password or token
in the agent chat.

## SOQL Explorer (human)

The Salesforce plugin's **Data** tab runs interactive REST/Tooling queries in SOQL Explorer: schema rail, query editor (⌘/Ctrl+Enter), results grid, export, recent/saved queries, and BotVersion/BotDefinition examples. It does not perform DML. Open **Salesforce → Data** in the project, or use the SOQL agent side panel.

## `sf_soql`

Agents keep using this tool. It is bounded and confirm-gated; it is not the Explorer UI.

- `schema.search` / `schema.describe` before writing queries
- `query.validate` then `query.sample` (bounded) then `query.run`
- Unbounded queries, `ALL ROWS` / QueryAll, and exports require operator confirmation

## `sf_apex`

- `diagnose` for local class hints
- `test.run` with an explicit class (and optional methods) — never org-wide
- `logs.fetch` for recent debug logs
- `anon.run` always confirms; `allow_mutation` is intent, not approval

## `sf_lwc`

- Local `scan` / `inspect` / `diagnose` / `test.jest`
- No deploy, retrieve, preview, or component create

## `sf_agent`

- Edit `.agent` files in the **Agentforce Playground** thread side panel (Monaco + Agent Script LSP: diagnostics, hover, completions, go-to-definition, topic graph, dialects, examples). Open **Preview** beside the thread to simulate or live-test. `zcc sf lint [path]` lints a confined bundle.
- `diagnose` runs the Agent Script language service on a confined `.agent` file. Default `query` is `diagnostics`. Position queries (`hover`, `complete`, `definition`) need 0-based `line` and `column`. `symbols` returns the outline.
- `compile` / `inspect` a confined `.agent` authoring bundle
- `preview.start` / `preview.send` / `preview.end` for live preview; compact digest + artifact
- `eval.run` with a confined YAML/JSON `specPath` (`sf agent test run-eval`) or an org `aiEvaluationDefinitionName` (Connect Testing API)
- `lifecycle.list` / `lifecycle.publish` (inactive version, no retrieve) / `lifecycle.activate`
- Publish and activate always confirm. `allow_untested` is intent, not approval. Activate needs matching eval evidence unless the operator confirms untested activation.
- Org preview/publish/activate stay on this tool — the editor does not call the Salesforce runtime.

## Create and control the workbench

- `sf_workbench` action `capabilities` lists the supported semantic operations. Every action also has a CLI form: `zcc sf action <action> --input '<JSON>' --json` in the current registered project. `zcc sf tool sf_agent --input '<JSON>' --json` invokes the existing family tools with the same project and approval rules.
- Create a local agent with `draft.create`, input `{name, apiName, purpose}`. It writes a complete unversioned authoring bundle and returns its path. No org connection is needed. In non-DX projects it creates a confined `agentforce-drafts` child project. Optional `source` copies a retrieved script into a new local identity without its published metadata target.
- `source.list`, `source.retrieve` (`fullName`, `orgId`), `source.status` / `source.cancel` (`jobId`) match the org browser. `files.list` / `files.read` / `files.write` match the editor; writes require the `expectedSha256` from the last read.
- `studio.start/send/next/evaluate/end` drive the same simulated Preview/rehearsal service as the Studio. Session operations use `id`; start needs `source` and `engine` (`preview` or `rehearsal`). These do not enable live actions.
- `query.execute` runs a bounded query with the usual agent policy and returns a `resultId`. `query.show` on a Data view displays that server-owned result. Use `query.history/save/remove/explain/more/cancel`, `records.get`, `logs.get`, `metadata.list`, and `operations.start/list/report` for the other workbench workflows.
- For visible control, call `ui.views`, choose a specific `viewId`, then `ui.command` with `{viewId, command, input}`. Poll `ui.result` with the returned `commandId`. Only `state: completed, ok: true` proves that the view acknowledged the command. `viewState` is the committed view state. Closed or absent views are not successful reveals.
- Workbench `view.open` takes `{view: "agentforce"}` (or overview/data/apex/deployments). Agentforce supports `file.open` (`path`), `panel.open/close` (`tool`: files/agents/graph/preview/test/actions/org-preview), show/hide, `file.filter` and `editor.reveal` (1-based `line`). `state` with `includeSource:true` reads the current editor snapshot. Save a dirty draft before switching files.
- Data supports `query.set` (`query`, `expectedQuery` from the last state), `object.select`, `record.open`, `filter.set` and `query.show` (`resultId`). Apex/deployment forms use `form.set` and require their previous values, preventing concurrent human edits from being replaced. Logs and operations can select and filter existing results.
- Publish remains `sf_agent lifecycle.publish`, then activate separately if requested. A versioned retrieved authoring bundle must first become a local draft. The workbench's **Review publish…** starts a thread carrying that path and selected project context.
