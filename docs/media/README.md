# Media sources

Each folder here is the editable source of one video: its render script, narration,
opener and outputs. The folder's README says what the video shows and how to redo it.
Published Help videos are copied from here into `content/videos/` (see
`content/videos/README.md`).

| Folder | Video | Recording spec |
|---|---|---|
| `guided-start/` | Your first project in 30 seconds | rendered from `guided-start.html` by `render.mjs` |
| `zana-everywhere/` | Use Zana everywhere | rendered by `render.py` (Pillow, shares `mobile-connect/` helpers) |
| `squads/` | How to use a Squad | `e2e/demo-squads.spec.ts` |
| `mobile-connect/` | Zana Mobile connection walkthrough | rendered by `render.py` (Pillow) |
| `zana-slack/` | Zana for Slack | rendered by `render.py` (Pillow, shares `mobile-connect/` helpers) |
| `zana-tour/` | Zana tour, plus exec and dev cuts | `e2e/demo-zana-tour.spec.ts` |
| `unified-side-panels/` | Unified plugin side panels (silent) | dev-build screen capture |

## The narrated-recording pipeline

Most narrated videos share one recipe (`squads/`, `zana-tour/`):

1. **Narration:** `narration.json` holds `{ id, line }` entries. `python3 render.py --audio`
   synthesizes each line with edge-tts (Microsoft Ava Multilingual Neural,
   `en-US-AvaMultilingualNeural`, `-5%`), caches it in `audio-neural/`, and writes
   `durations.json`.
2. **Recording:** a Playwright demo spec runs an isolated Electron build. It calls
   `say(id)` in the same order as `narration.json`, waits for each line to finish, and
   writes `timeline.json`. Set `ZCC_DEMO_NARRATION`, `ZCC_DEMO_TIMELINE` and
   `ZCC_E2E_RECORD_VIDEO`. Agents are deterministic fakes (fake ACP, or fake Pi with
   `FAKE_PI_SCRIPT`), so no model is called.
3. **Opener:** `intro.html` is a deterministic `render(t)` animation that ends on the
   recording's first frame. `intro.cjs` captures it frame by frame. `INTRO_LINES` in
   `render.py` must match its `VO` timings and `DURATION`.
4. **Mix:** `python3 render.py --mix <rec>` trims the recording at the black flash, joins
   the opener with a crossfade, and places each line at its timeline time. It ducks the
   `music.cjs` bed under the voice, normalizes to -16 LUFS / -1.5 dBTP, and writes the
   mp4, the SRT/VTT captions and `poster.jpg`.

Requirements: `python3 -m pip install edge-tts` (plus `Pillow` for still-rendered
videos), `ffmpeg`, and Playwright Chromium.

Plugin videos keep their sources in the plugin repo. The Agentforce videos ("How to build an
Agentforce Agent in Zana" and "Agentforce Studio in Zana") live in
[zcc-plugin-salesforce](https://github.com/grebmann1/zcc-plugin-salesforce) under `media/`,
with their specs in its `e2e/`. Only the published copies are here, in `content/videos/`.

Recordings and renders under `artifacts/` (release highlights, older demos) are
gitignored scratch. The finished copies are kept in the shared "Zana - Media" folder
(`Help videos/`, `Release videos/`, `Demos/`).
