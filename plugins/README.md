# Built-in modules (`plugins/`)

This directory contains app features compiled into the trusted Electron process.
They are distinct from runtime disk extensions, which are discovered from
`~/.zcc/extensions/<id>/` and run through the permission broker.

## Current built-in

| Module | Why it is built in |
| --- | --- |
| `slack/` | Uses in-process timers for the live bot poll loop and a trusted fetch capability. |

## Authoring

Built-ins and disk extensions consume the published `@zana-ai/zcc-extension-sdk` APIs.
For disk-extension manifests, packaging, permissions, and the runtime isolation
model, see [`docs/extensions-authoring.md`](../docs/extensions-authoring.md).

Do not add a runtime extension to `MAIN_MODULES` or `APP_MODULES`; package it
with an `extension.json` manifest and install it through the extension workflow.
