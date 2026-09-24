# Fairy website deployment

- PR: https://github.com/salesforce/zana/pull/191
- Branch: `design/fairy-website`
- Revision: `268af7a2a9d8092178967b33aec4e14c31d43ea7`
- Production: https://zana-ide.com/
- Heroku app: `zcc`; release **v26**, succeeded 2026-09-20 10:03:42 UTC
- Image config: `sha256:d6ccd4c28f979c0675108ab509712d20275704caf7a78848049903dfc6649c08`
- Registry manifest: `sha256:dce96ceb3eafc8c2f041c63bbadbd59cf3d49e684058ffc90c9fb5e319c9a09e`
- Previous release: v25 (available for rollback)

The Docker build used the exact PR snapshot, linux/amd64, the existing `node relay/front-door.mjs` entry point, and `PUBLIC_BASE_URL=https://zana-ide.com`. No Heroku configuration values were changed.

Validation: 162 website tests passed against the release snapshot; production Linux container build passed; container and public route checks passed for homepage, Features, Plugins, marketplace, getting-started docs, all three SVG illustrations, marketplace JSON, robots canonical origin, and the PNG social preview. The local pairing route retained its expected 503 when no host was connected, with no redirect into Next.

Only the website changes are in the PR. Shared-checkout app edits, README/deck work, and generated documentation changes remain outside the PR.

GitHub CI run 35503985733 passed the full repository typecheck and unit tests (4m18s). Credential scanning, SAST, and Salesforce CLA checks passed. Production `/api/healthz/` returned `{ "ok": true }`.
