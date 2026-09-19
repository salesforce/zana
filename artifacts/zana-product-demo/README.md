# Zana — product walkthrough with CLI Agent

A **2:28** narrated walkthrough with a simulated UI based on the current Zana app. It keeps the conversational Kokoro voice and concise pacing, with an additional CLI Agent sequence.

## Watch and share

- **Zana-product-demo.mp4** — 1920×1080, 24 fps, H.264 / AAC, visible captions, and eight chapters.
- **Zana-product-demo-share.zip** — the MP4, offline player, interactive demo, captions, transcript, and voice credits.
- **watch.html** — video player with chapter navigation.
- **index.html** — replay, pause, scrub, navigate chapters, enable narration, or try the Focus Board.
- **voice-preview.m4a** — a short sample of the same locally generated stock AI voice.

## Product fidelity

The visual reference is the installed Zana app and the current repository: light-theme tokens and shell spacing in `apps/app/src/styles/global.css`, the home composer and launch selector, and `AgentTerminalModal.tsx`. The replica uses the actual sidebar ordering, compact Projects and session rows, Modern / CLI Agent selection, a subtle grid background, provider/model/reasoning controls, and project/environment context. The Agents board uses Board / List / Flow controls and groups Thread and CLI Agent cards by project.

The CLI sequence selects CLI Agent, types a review task, opens a Codex terminal window, shows commands and output, expands to full screen, streams test results, and returns to the shared board. The terminal follows the current light theme, with monospace text, prompt, status line, model, and project path.

The earlier project, Modern thread, question/answer, changes, preview, GUS, and custom plugin workflows remain. The earlier videos are preserved in their original artifact folders.

| Start | Chapter |
| --- | --- |
| 0:00 | Welcome |
| 0:04 | Create a project |
| 0:14 | Launch a Modern agent |
| 0:28.5 | Monitor the work |
| 0:51 | CLI Agent and terminal TUI |
| 1:13 | GUS tickets |
| 1:35.5 | Create a plugin |
| 2:17 | Closing |

This is a scripted replica with fictional projects, tickets, agent output, tests, and installation actions. The terminal is simulated. The interactive plugin's changes stay in the current demo tab. Cursor motion is drawn inside the replica; rendering is headless. No real agent or ticket is changed to produce the video.

## Regenerate

`product.css` applies the current product styling. `app.js` renders the fictional UI. `story-timeline.js` retains the original story actions; `timeline.js` retimes them and adds the CLI segment. `narration.json` contains the script. Local speech runtime/model files are in `../demo-voice-cache/` and are excluded from the share ZIP.

From the repository root:

```sh
artifacts/demo-voice-cache/.venv/bin/python artifacts/zana-product-demo/make_neural_audio.py
node artifacts/zana-product-demo/inspect.mjs --calibrate
node --experimental-test-coverage --test artifacts/zana-product-demo/timeline.test.mjs artifacts/zana-product-demo/pacing.test.mjs
node artifacts/zana-product-demo/verify.mjs
node artifacts/zana-product-demo/render_video.mjs
python3 artifacts/zana-product-demo/package_demo.py
node artifacts/zana-product-demo/verify_package.mjs
```

## Verification

The 16 timing tests pass, with 100% line and function coverage and 99.02% combined branch coverage. Browser interaction verification passes with 99.53% JavaScript byte coverage, no page errors, and no external requests. It checks CLI selection/launch, terminal output, full-screen entry/exit, return to the board, GUS handoff, plugin interaction, playback, narration, and responsive capture. Cursor coordinates are measured from the actual replica controls.

Media and extracted ZIP verification reports are in `render/media-validation.json` and `render/package-verification.json`. `package_demo.py` checks all 3,552 frames decode, duration, codecs, dimensions, audio, and eight chapters before creating the ZIP atomically. The package test opens the extracted video and interactive demo offline and exercises chapter seeking, CLI playback, and plugin interaction.

See [CREDITS.md](CREDITS.md) for the stock AI voice and model license.
