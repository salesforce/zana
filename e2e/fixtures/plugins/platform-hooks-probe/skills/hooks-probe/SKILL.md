---
name: hooks-probe
description: Drive the Platform Hooks Probe fixture plugin's agent tool and dispatch-policy surfaces during a manual or automated platform-hooks test pass. Use only inside the platform-hooks-probe E2E fixture project, never in a real project.
---

# hooks-probe — platform-hooks-probe fixture skill

This skill exists only for the `platform-hooks-probe` E2E fixture plugin
(`e2e/fixtures/plugins/platform-hooks-probe/`). It is contributed via that
plugin's `zcc.skills` manifest entry and is deployed only into a project where
the fixture is installed and enabled. It is never a real-plugin skill and must
never be referenced outside the fixture's own E2E specs or manual test runs.

## Agent tool

Call `platform_hooks_probe_marker` (no arguments) to record one invocation.
Each call appends a `{source:'modern-tool', invocationId, at}` entry to the
bounded marker file at `.zcc-hooks-probe/tool-marker.json` in the current
project and increments its `count`. The Hooks Probe panel's "Tool Policy"
section reflects the same file.

## Dispatch policy

The fixture's dispatch-admission hook reads an in-memory selection set from
the panel's "Dispatch Policy" section (`proceed` / `wait` / `reject`). This
skill does not change that selection — only the panel UI does. If a prompt in
this project is unexpectedly held or rejected, check that section before
assuming a bug.

## Scope

This skill is a test aid, not product documentation. Do not generalize advice
from it to other plugins' tools or hooks.
