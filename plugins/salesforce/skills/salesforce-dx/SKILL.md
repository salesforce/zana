---
name: salesforce-dx
description: Playbook for ZCC Salesforce DX tools. Use when querying an org, running Apex tests or anonymous Apex, inspecting LWCs, compiling Agent Script, or checking Salesforce CLI/org health.
---

# Salesforce DX playbook

Prefer the family tools over guessing schema or `sf data query` dumps.

```bash
zcc sf doctor
zcc sf org
```

## `sf_soql`

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

- `compile` / `inspect` a confined `.agent` authoring bundle (source edits stay with file tools)
- `preview.start` / `preview.send` / `preview.end` for live preview; compact digest + artifact
- `eval.run` against a local eval spec JSON file
- `lifecycle.list` / `lifecycle.publish` (inactive version) / `lifecycle.activate`
- Publish and activate always confirm. `allow_untested` is intent, not approval. Activate needs matching eval evidence unless the operator confirms untested activation.
