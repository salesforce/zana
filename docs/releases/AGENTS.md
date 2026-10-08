# Release Coupling Notes

## Release artifacts published to GitHub feed

**Invariant:** Release body = in-app "What's new" preview.

**Why:** Auto-updater reads GitHub release feed anonymously. Update banner shows release notes in-app before user accepts update.

**Guard:** `scripts/check-release-notes.mjs` in `.github/workflows/release.yml` `verify` job; `scripts/check-release-notes.test.ts` test-locks `MAX_UPDATE_NOTE_CHARS`.

**When changing:**

### Cut a release
- Push `vx.y.z` tag → `.github/workflows/release.yml` builds Apple Silicon + Intel + Windows x64 → **draft** release on `salesforce/zana`.
- Human publishes draft.
- Local `pnpm run release:mac` packages host arch only (`--publish never`) — must not upload.

### Release notes format
- Write `docs/releases/<version>.md` **before** tagging.
- Workflow copies via `body_path` into draft.
- Update banner reads `UpdateInfo.releaseNotes` (with `fullChangelog`); `apps/desktop/src/update-release-notes.ts` converts to bounded markdown subset in main.
- Constraints: no images, tables, or raw HTML; <32 KB.
- Enforced by `scripts/check-release-notes.mjs` (size + tag/`package.json` match).
- Size cap test-locked to `MAX_UPDATE_NOTE_CHARS` in `scripts/check-release-notes.test.ts`.
- Editing notes after draft exists = must edit GitHub release body too.

### Checklist
- Full procedure: `docs/desktop-release-pipeline.md`.
