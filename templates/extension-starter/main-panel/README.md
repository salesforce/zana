# __EXT_TITLE__

A Zana Command Center extension with a **renderer panel + a main-process
backend**. The panel calls a main-side capability (`gitVersion`) that runs
`git --version` through Zana's brokered, permission-gated exec capability.

## What's inside

- `extension.json` — the manifest. Declares `permissions: ["exec"]` with
  `permissionScopes.execAllowlist: ["git"]`, so the backend may run **only** the
  `git` binary. Installing this extension prompts you to approve that.
- `dist/main.mjs` — the main-process module. Runs headless with no raw Node access;
  reaches the OS only through the brokered `ctx.exec` capability. Exposes the
  `gitVersion` capability to the renderer.
- `dist/renderer.js` — the panel UI. Calls `host.call('gitVersion')`.

## Develop

Edit the files, then hit **Reload from source** in the Extensions hub — no app
relaunch needed. If you add a new permission to `extension.json`, the next reload
re-prompts you to approve it.

## Install from a repo

Once you've pushed this to a git repository, anyone can install it in Zana:
**Settings → Extensions → Install from repo…**, paste the repository URL. Zana
clones it, shows the permissions it requests, and installs on your approval.
