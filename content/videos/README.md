# Help videos: publish from the repository

`catalogue.json` is the authoritative, public Help video catalogue. Installed
clients fetch it from `https://raw.githubusercontent.com/salesforce/zana/main/content/videos/catalogue.json`.
Adding a video is a content commit, independent of desktop app releases.
Clients need the initial app version that implements this fetcher; earlier
bundled-only versions cannot discover remote additions.

## Add or revise a video

1. Produce an H.264/AAC MP4 with fast-start metadata, a JPG poster and UTF-8
   WebVTT captions. Keep each MP4 under 48 MiB. Check the actual duration with
   `ffprobe -v error -show_entries format=duration -of csv=p=0 <video.mp4>`.
2. Calculate the SHA-256 and byte length of **each** file. Copy it into `media/`
   as `<video-id>-<full-sha256>.mp4`, `.jpg` or `.vtt`. These files are immutable:
   changed bytes always get a new filename. Do not use Git LFS pointers here.
3. Add/update the entry in `catalogue.json`. Use the existing entries as the
   format reference. The array sets the display order. Preserve the `id` when
   replacing a cut so watched history survives. Each `src`, `poster` and
   `captions` object contains a repository-relative `path`, `sha256` and `bytes`.
   Include `minAppVersion` and/or `maxAppVersion` (exact `x.y.z` bounds, inclusive)
   when a tutorial depends on app functionality. Keep older clients in mind.
4. Run `pnpm exec tsx scripts/check-help-videos.ts` and review the video,
   captions, poster, title, duration and supported versions.
5. Merge the assets and catalogue into `main` together. **Do not tag an app
   release just to add a video.** GitHub may briefly cache the old manifest;
   clients recheck on Help opening with a five-minute freshness interval.

The app validates the bounded catalogue in its host, only downloads files
declared by that catalogue from this repository, verifies SHA-256 and size,
then serves correct media/caption types and byte ranges from its own origin.
Remote clients use the same endpoints. No GitHub token is required.

## Offline use, failure and rollback

The shipped baseline remains immediately available. Valid remote catalogues
are saved locally; downloaded media is reused offline within a 192 MiB cache.
Unwatched remote videos require connectivity to download. Failed updates keep
the last good catalogue. A failed revised bundled clip can use its offline
copy; other unavailable clips expose Retry video.

Roll back by restoring the earlier catalogue entry. Keep old media files
available for clients that still have the previous catalogue. Versioned media
can later move to another delivery mechanism without changing stable video IDs;
that requires an explicit host implementation change, not arbitrary remote URLs.

## Bundled baseline

`apps/app/src/lib/help-videos.ts` and `apps/app/src/assets/` hold the shipped
offline basics. They are **not** the publication mechanism for future videos.
Changing only the public catalogue/media must work without changing renderer
source. When deliberately updating the bundled baseline, also update the media
and metadata together, then update `apps/app/src/lib/help-video-baseline.json`
with the actual bundled file hashes. This separate snapshot identifies local
cuts and must not change for content-only publications.

Verification: `pnpm exec vitest run packages/server-contract/src/help-videos.test.ts apps/server/src/services/help-video-catalogue.test.ts apps/server/src/http/help-videos-api.test.ts apps/app/src/lib/help-video-catalogue.test.ts apps/app/src/components/help/HelpMenu.test.tsx scripts/check-help-videos.test.ts` and
`pnpm test:e2e -- e2e/help-videos.spec.ts e2e/help-videos-remote.spec.ts`.
