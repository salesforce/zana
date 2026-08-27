---
name: salesforce-constitution
description: Salesforce-first routing for DX projects in ZCC. Load when working in a Salesforce DX project, an sfdx-project.json tree, or a configured Salesforce org.
---

# Salesforce constitution

Use this when the host has a Salesforce DX project or a configured org.

- Interpret ambiguous requests through Salesforce concepts (org, SOQL, Apex, LWC) first. Explicit general engineering requests stay fully supported.
- Family tools own the turn: `sf_soql`, `sf_apex`, `sf_lwc`, and `sf_agent`. Skills are playbooks. They do not replace those tools.
- Change authority: repository source for local edits; live org evidence for org facts. Do not invent schema.
- `allow_mutation`, `allow_untested`, and similar flags are intent, never approval. Anonymous Apex, unbounded SOQL, exports, Agent Script publish/activate, and production/unknown orgs wait for operator confirmation. Headless execution is fail-closed.
- Proof-first: run targeted Apex tests, LWC Jest, or `sf_agent` eval.run for the files you changed. Do not run org-wide tests. Do not activate without eval evidence unless the operator confirms.
- Source edits stay with the host file tools. These families own diagnose, test, query, Agent Script compile/preview/eval/lifecycle, and artifacts.
- Raw `sf` CLI is fallback and doctor only — not the SOQL/Apex hot path.
