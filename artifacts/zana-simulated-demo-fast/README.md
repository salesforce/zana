# Zana — shorter cut with neural narration

A **2:10** version of the simulated walkthrough: one minute shorter than the original 3:10 cut, with a shorter conversational script and locally generated Kokoro `af_heart` narration.

## Watch and share

- **Zana-demo-fast.mp4** — 1080p, 24 fps, H.264 / AAC, narration, captions in the picture, and chapters.
- **voice-preview.m4a** — the first 13 seconds of the new voice.
- **watch.html** — video player with chapter navigation.
- **index.html** — the full replayable simulation and interactive Focus Board. Open in a desktop browser. Play, pause, seek, restart, turn Sound on, or choose Try the plugin.
- **Zana-demo-fast-share.zip** — offline video and interactive demo package. Unzip before opening the HTML files.

## What changed

The edit removes idle time, shortens the opening and closing, and makes simulated typing faster. Results, questions, and decisions retain reading time. All five workflows remain: create a project, launch an agent, monitor work, follow GUS tickets, and create a plugin.

The narration was rewritten as a person explaining the app to a colleague. It uses shorter sentences, contractions, and natural phrasing. A local neural voice replaces the previous macOS system voice. Speech is newly generated, with no pitch change or audio time stretching; captions follow the new audio timestamps.

| Start | Chapter |
| --- | --- |
| 0:00 | Welcome |
| 0:04 | Create a project |
| 0:14 | Launch an agent |
| 0:28.5 | Monitor the work |
| 0:55 | GUS tickets |
| 1:17.5 | Create a plugin |
| 1:59 | Closing |

This is a scripted replica with fictional data and simulated agent and installation actions. The in-page cursor is drawn inside the demo. The actual desktop, live agents, and GUS account are not controlled. The interactive plugin's changes stay in the current demo tab.

## Source and regeneration

`story-timeline.js` preserves the original story. `timeline.js` maps the shorter presentation clock onto those actions, keeping each click and output aligned. `app.js` uses the presentation clock for playback and the original clock for the fictional story. `narration.json` contains the new script; `make_neural_audio.py` creates the local speech and captions.

The isolated speech runtime and model cache are in `../demo-voice-cache/`, outside the share package. The original video remains in `../zana-simulated-demo/`.

From the repository root:

```sh
artifacts/demo-voice-cache/.venv/bin/python artifacts/zana-simulated-demo-fast/make_neural_audio.py
node --experimental-test-coverage --test artifacts/zana-simulated-demo-fast/timeline.test.mjs artifacts/zana-simulated-demo-fast/pacing.test.mjs
node artifacts/zana-simulated-demo-fast/verify.mjs
node artifacts/zana-simulated-demo-fast/render_video.mjs
python3 artifacts/zana-simulated-demo-fast/package_demo.py
node artifacts/zana-simulated-demo-fast/verify_package.mjs
```

Verification reports are saved in `render/`. The 14 timing tests pass with 100% line, branch, and function coverage for both timing modules. Browser interaction checks pass with 99.65% JavaScript byte coverage and no external requests or script errors. The 19 narration phrases contain 225 words, do not overlap, and use no audio time stretching. Media checks verify the full video decodes and contains exactly 3,120 frames, 130 seconds of audio/video, and seven chapters. The share ZIP is also extracted and tested offline.

See [CREDITS.md](CREDITS.md) for the voice model and runtime sources.
