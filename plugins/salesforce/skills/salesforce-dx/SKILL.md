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

The Salesforce project tab lists every org the Salesforce CLI has authenticated (`sf org list`). Picking one saves `defaultOrg` for **SOQL**, Apex, LWC, Agentforce Preview, and the family tools. `zcc sf org` prints that same roster (no tokens) and the resolved target.

## SOQL Explorer (human)

The Salesforce plugin's per-project **SOQL** tab runs interactive REST/Tooling queries: schema rail, query editor (⌘/Ctrl+Enter), results grid, export, recent/saved queries, and BotVersion/BotDefinition examples. It does not perform DML. Open it from the project row menu or the Salesforce project tab.

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
