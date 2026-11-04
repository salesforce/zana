# Your first project in 30 seconds

The intro clip on the first step of the first-run walkthrough
(`apps/app/src/components/WalkthroughIntroVideo.tsx`): 1920 × 1080, 30 fps,
30 seconds, H.264/yuv420p, no audio, fast-start playback.

1. **Project** — Welcome; the Default Project is already there. **+ Add project** →
   **Open existing folder** picks `~/Documents/coffee-shop` in a macOS sheet.
2. **Harness** — the model picker switches from Claude Code to Codex · GPT-5.5.
3. **Design doc** — the prompt asks for a design doc first; `design_doc_create`
   posts the doc card and the doc opens in the side panel as it is written.
4. **Preview** — Codex writes `index.html` and `styles.css`; the side panel flips to Preview.
5. **Inbox** — `inbox_push` lands a work report; the Inbox shows it.

This is an illustrated walkthrough in the dark product theme (sidebar, title-bar
tab, composer, Harness/Model picker, side panel and Inbox match the built app). The folder,
project and report are samples; no agent ran to produce it.

## Files

- `guided-start.html`: editable source — a self-contained animated mock with a
  scrubber (`window.__seek(t)` jumps to a time).
- `render.mjs`: frame-exact renderer.
- `poster.jpg`: frame at 0:27.5.
- Shipped copies live in `apps/app/src/assets/onboarding/`
  (`guided-start.mp4`, `.jpg`, `.en.vtt`). The clip is also listed in the
  Help → Videos catalogue (`apps/app/src/lib/help-videos.ts`); add new clips there.

## Render

Requires the repo's Playwright Chromium and ffmpeg. From the repo root:

```sh
node docs/media/guided-start/render.mjs --stills   # key frames to a temp dir
node docs/media/guided-start/render.mjs            # writes the shipped mp4, poster, captions
```

Captions in `render.mjs` mirror the on-screen captions; update both together.
