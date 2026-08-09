# __EXT_TITLE__

A Zana Command Center extension that contributes an **agent preset** — a reusable
Quick-Agent configuration (system prompt + model + opening prompt) that shows up
in the host's Advanced Quick-Agent launcher.

## What's inside

- `extension.json` — the manifest. The `agentPreset` block IS the feature:
  `label`, `description`, `icon`, `model`, `initialPrompt`, and the
  `systemPrompt` that defines the agent's role. It needs no code.
- `dist/renderer.js` — a small companion panel explaining the preset. Optional —
  drop `entry.renderer` + `projectTab` for a panel-less, preset-only extension.
- `permissions: []` — no capabilities requested, so it installs consent-free.

## Develop

Edit the `agentPreset` block in `extension.json` (especially `systemPrompt`),
then hit **Reload from source** in the Extensions hub. Launch the preset from the
Advanced Quick-Agent launcher.

## Install from a repo

Push to a git repository, then anyone can install it via **Settings → Extensions
→ Install from repo…**.
