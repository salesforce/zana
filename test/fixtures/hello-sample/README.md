# Hello Sample Extension

A minimal dummy extension fixture for testing the live-load lifecycle.

## Purpose

This extension demonstrates:

1. **Live installation** — can be installed into `~/.zcc/extensions/hello-sample` without rebuilding the app
2. **Minimal surface** — just a manifest + tiny main/renderer contributions
3. **Lifecycle verification** — proves install → enable → load → uninstall works end-to-end

## Structure

- `extension.json` — manifest declaring the extension's id, version, permissions, and entry points
- `main.mjs` — minimal main process setup with ping/getStatus capabilities
- `renderer.js` — minimal renderer contribution with a simple UI

## Installation for Manual Testing

```bash
# Copy to runtime extensions directory
mkdir -p ~/.zcc/extensions
cp -r test/fixtures/hello-sample ~/.zcc/extensions/

# Or use the app's "Install from folder" UI
```

## Automated Tests

This fixture is used by:

- `src/main/__tests__/extension-lifecycle.test.ts` — unit tests for install/uninstall
- `e2e/marketplace-lifecycle.spec.ts` — e2e test for full UI-driven lifecycle
