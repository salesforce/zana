---
name: salesforce-toolkit
description: Use the optional sf-agentic-tools provider for Salesforce, Agent Script, Flow, Code Analyzer, metadata and Data 360 operations through Zana's scoped gateway.
---

# Salesforce toolkit

Use `sf_tools` to discover and execute the pinned sf-agentic-tools SDK:

1. `{ "action": "list" }` lists the complete catalog and current provider mode.
2. `{ "action": "describe", "tool": "sf_flow" }` returns its input schema, action availability and prerequisites.
3. `{ "action": "call", "tool": "sf_flow", "input": { "action": "quality.rules" } }` executes an action.
4. `{ "action": "result.read", "runId": "<returned ID>", "pointer": "/data", "offset": 0, "limit": 20 }` retrieves retained evidence.

`sf_flow`, `code_analyzer` and `sf_metadata` also accept toolkit inputs directly.
Use the gateway for toolkit `sf_soql`, `sf_apex`, `sf_lwc`, all four
`agentscript_*` tools and eleven `data360_*` tools. In Both mode the original
`sf_soql`, `sf_apex`, `sf_lwc` and `sf_agent` contracts remain available directly.
Schemas differ: always describe the toolkit action before calling it.

The host supplies the registered local project and selected org. Use
`sf_workbench context.select` to change the target. Do not supply workspace,
target_org, credentials, artifactDir, resume paths or allowEffects. File inputs
and outputs must stay inside the project. Toolkit execution on a remote project
requires a future host adapter; discovery remains available.

Read diagnostics, artifacts and nextActions before retrying. Follow prerequisite
failures with the specific setup action. Do not claim an unavailable capability
worked. Effectful operations (tests, fixes, exports, publish, activation and live
preview) require the host approval interaction, even on sandbox orgs. Never
retry a refused operation with alternate authorization flags.

Results are bounded. Keep the returned runId to read evidence or provide it as
resumeId on a subsequent `call` (or a direct toolkit tool). IDs are valid only
for this plugin activation and original project/org. Up to 32 runs are retained.

CLI equivalent:

```sh
zcc sf tool sf_tools --input '{"action":"describe","tool":"sf_flow"}' --json
zcc sf tool sf_flow --input '{"action":"quality.rules"}' --json
```

Plugins → Salesforce → Agent tool provider selects Both (default), Built-in or
Toolkit. `sf_workbench` remains available in every mode. Built-in mode loads no
toolkit runtime and refuses stale toolkit calls; Toolkit mode refuses stale
calls to the original family tools. New agent catalogs reflect the selection.
