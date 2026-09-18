# Zana — a simulated product walkthrough

A 3:10 walkthrough rendered from a working, scripted replica of Zana. It shows project setup, agent launch and monitoring, GUS tickets, and creating a custom Focus Board plugin.

## Watch or try it

- **Zana-simulated-demo.mp4** — the shareable video, with narration, captions in the picture, and chapters. 1920 × 1080, 24 fps, H.264 / AAC.
- **watch.html** — a local video player with chapter buttons.
- **index.html** — the replayable app simulation. Open it in a browser, press Play, and turn Sound on for narration. Play, pause, restart, scrub, or jump to a chapter.
- **Try the plugin** pauses the story and opens the interactive Focus Board. Toggle priorities or add a task. Changes are confined to the current demo tab and reset when the scripted playback restarts.
- **Zana-simulated-demo-share.zip** — the video, player, transcript, captions, and complete offline interactive demo. Unzip before opening the HTML files.

The interactive demo needs no server, install, login, or internet connection. It is designed for a desktop or laptop display.

## Story

| Start | Chapter |
| --- | --- |
| 0:00 | Welcome |
| 0:07 | Create a project |
| 0:23 | Launch an agent |
| 0:46 | Monitor the work and answer a question |
| 1:25 | Filter, watch, and act on GUS tickets |
| 1:59 | Create a plugin |
| 2:58 | Closing |

The project, names, tickets, outputs, test results, and installation sequence shown in the story are fictional. The app window carries a “Simulated demo” label. The Focus Board's interactive controls are implemented in the replica; this package does not install a plugin into Zana.

## How it was made

The UI is HTML, CSS, and JavaScript with a deterministic clock. Every prompt, streamed response, tool result, status transition, and cursor movement is replayed from that clock. Cursor movement is drawn inside the page. Capture runs in a separate **headless Chromium process**; it does not operate the physical desktop cursor or the live Zana app.

The narration uses macOS's Samantha voice. Audio timestamps produce the captions. Frames are rendered at exact 1/24-second intervals, encoded with FFmpeg, and combined with the narration. Production app source files are unchanged.

## Edit and rebuild

From the repository root, using its installed Playwright dependency, macOS `say`, Python 3, and FFmpeg:

```sh
# Update narration.json, then regenerate voice and captions.
python3 artifacts/zana-simulated-demo/make_audio.py

# After layout changes, align cursor targets and inspect chapter screenshots.
node artifacts/zana-simulated-demo/inspect.mjs --calibrate

# Verify state transitions, replay, and interactive controls.
node --experimental-test-coverage artifacts/zana-simulated-demo/timeline.test.mjs
node artifacts/zana-simulated-demo/verify.mjs

# Render the full video without opening a visible browser.
node artifacts/zana-simulated-demo/render_video.mjs

# Validate, create the poster, and rebuild the share package.
python3 artifacts/zana-simulated-demo/package_demo.py
node artifacts/zana-simulated-demo/verify_package.mjs
```

`timeline.js` owns the story and cursor keyframes. `app.js` renders the views and implements the player and interactive plugin. `style.css` owns layout. `narration.json` contains the timed voice script. `demo.seek(seconds)` renders any moment deterministically for capture and debugging.

## Verification

- 10 deterministic timeline tests passed; timeline line, branch, and function coverage are all 100%.
- Browser checks exercise all story transitions, question submission, GUS handoff, plugin add/toggle behavior, blank inputs, HTML escaping, task limit, playback controls, audio, chapter navigation, and capture mode.
- Combined browser JavaScript byte coverage: 99.51%.
- No external HTTP requests or browser script errors during verification.
- `render/verification.json`, `render/render-report.json`, and `render/media-validation.json` contain the reports.

The replica's checks verify the demo itself. The fictional test results visible within its story are not claims about a generated production application or an installed Zana plugin.
