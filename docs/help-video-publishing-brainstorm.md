---
id: "6021a048-d297-4eaf-ab10-3e9b6de60792"
title: "Publish Help videos independently of app releases"
summary: "Original brainstorm plus implementation follow-up: repo-backed Help video catalogue, immutable media and bundled offline fallback; one initial app update enables future content-only publishing."
tags: ["idea", "help", "videos", "distribution", "squads"]
source: "agent"
createdAt: 1793375349653
---
# Publish Help videos independently of app releases

Brainstorm from 30 October 2026. The original brainstorm is retained below. The follow-up implementation uses this public repository as the content origin: see [the publishing workflow](../content/videos/README.md) and [agent instructions](../content/videos/AGENTS.md). The current Squad cut is 1:30. Publication requires merging the content to `main`; installed clients need the initial fetcher-enabled app update.

## What exists

The screenshots show two videos. The current working checkout already contains a third catalogue entry, `how-to-use-a-squad`, titled “How to use a Squad”, duration 1:41, with English narration and captions. Its MP4 (about 8.6 MB), poster and VTT are present under `apps/app/src/assets/squads/`. The catalogue addition and related tests are uncommitted, and the assets are untracked at inspection time. This proves the local integration exists; it does not prove the running installed app contains it.

Today `apps/app/src/lib/help-videos.ts` imports all media through Vite and exports a static `HELP_VIDEOS` array. HelpMenu, HelpVideoLibrary and the watched-state store consume that static list. Uploading another MP4 somewhere cannot add a tile in this implementation. The renderer CSP also restricts connections and falls back to self for media, so simply substituting arbitrary remote URLs is insufficient. The curated Help release-notes browser likewise reads bundled files; it is not an existing dynamic content service to reuse unchanged.

## Recommended direction

Keep the existing player and menu. Treat the video catalogue as remotely published content, retaining a bundled baseline for first launch and offline use.

- Host a small, versioned JSON manifest plus immutable/versioned MP4, JPG and VTT assets on a controlled HTTPS static origin. Use an owned website URL as a stable entry point, even if media uses separate object storage/CDN infrastructure.
- Keep stable video IDs for watched history, and a separate revision for replacement cuts. Include title, description, group/order, duration, sound/caption information, media references and optional minimum/maximum supported app versions. Validate the manifest schema and cap size and entry count.
- Fetch through a host-owned service, using a fixed approved origin and bounded requests; resolve media through a narrow host-authorized path. Choose either controlled-origin playback with explicit CSP/CORS support or same-origin serving of cached/fetched media. Do not add a generic arbitrary-URL proxy. Exercise desktop and remotely connected browser playback, seeking, captions and downloads.
- Refresh when Help opens, with a freshness interval and conditional requests. Render bundled or last-known-good content immediately; a slow or unavailable network must not block Help. Apply a valid catalogue update consistently to menu, player and watched-state lookup without resetting an active clip.
- Publish only new/revised assets first; update the manifest last. A bad manifest retains the previous working catalogue. Versioned assets make rollback straightforward.
- Download video bytes only when requested. Explicitly saved/cached remote clips can work offline; uncached new clips need an internet connection and a useful unavailable/retry state. Bound any persistent media cache. Keep the onboarding clip bundled.

## Alternatives

| Approach | Benefit | Tradeoff |
| --- | --- | --- |
| Bundle everything, as today | Predictable offline playback | Every catalogue addition requires an app release |
| Fully hosted catalogue and media | Small app and immediate publishing | New installations depend on network availability for all videos |
| Hosted catalogue plus bundled baseline | Independent publishing with working offline basics | Requires catalogue validation and clear cache/fallback behavior |

Recommend the hybrid approach. Start with reviewed JSON plus a publishing command; consider a CMS/editor only if publishing volume makes it worthwhile.

## Publisher workflow

1. Produce an MP4, poster and caption file, reusing the existing Squad generation workflow.
2. Add/update a manifest entry in a content repository.
3. Validate schema, asset availability/types, supported app version and captions.
4. Upload assets, then publish the manifest.
5. Compatible apps discover the change on their next Help refresh. Roll back by restoring the previous manifest.

No desktop installer or app version bump is part of that workflow after support ships.

## Migration limitation

One initial app update is necessary to teach existing clients how to fetch the catalogue. Clients with the present bundled-only implementation cannot discover a third tile remotely. A separately hosted web gallery is a possible interim viewing destination for those users, but does not modify their existing Help menu.

## Useful next implementation slice

Add a bounded catalogue service and shared dynamic catalogue store; seed it from bundled entries; wire HelpMenu, HelpVideoLibrary and watched IDs to it; implement controlled delivery of remote assets; publish the three current videos to a content origin. Test offline fallback, malformed/oversized catalogue, compatibility filtering, stable watched IDs, refreshed selection, captions, seeking and saving through the built Electron boundary and connected browser. Do not mix unrelated changes already present in the checkout into this work.

## Technical references

- [MDN: HTTP range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests) — partial requests enable media seeking and resumed downloads.
- [MDN: HTTP conditional requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Conditional_requests) — validators avoid downloading unchanged catalogue content.
