# Help video publishing

Read [README.md](README.md) before adding/revising Help videos.

- Every published video starts with the Zana intro (`docs/media/zana-intro/`,
  see `docs/media/AGENTS.md`); frame 0 shows the logo, not an empty background.
- Publish catalogue metadata in `catalogue.json` and immutable, hash-named MP4,
  JPG and VTT files in `media/`. Preserve video IDs across revisions.
- Future video additions are content-only commits merged into `main`; do not
  edit the renderer's bundled list or cut an app release merely to publish.
- Keep sizes/hashes accurate, use compatibility bounds when necessary, keep old
  assets available, and validate with `pnpm exec tsx scripts/check-help-videos.ts`.
- No arbitrary asset URLs, HTML/JavaScript payloads, Git LFS pointer files,
  credentials, or unpublished/private footage in this public feed.
