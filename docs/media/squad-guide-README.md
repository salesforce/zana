# Squad guide videos

Narrated, 1920x1080 light-theme recordings that support the Squad guide pages, in the style of the
Zana 2.5 highlights video: opener card, numbered section title bar ("01 Thread tabs", a one-line
subtitle and a right-side hint), bottom caption bar, closer card, music bed, -16 LUFS / -1.5 dBTP,
SRT/VTT and a poster. It reuses the `squads/` pipeline (`docs/media/README.md`, `docs/media/squads/README.md`); this page
covers only what is different.

## Layout

```
docs/media/squad-guide-tools/        shared, do not copy per video
  render.py                          --audio / --check / --mix  (adapted from squads/render.py)
  card.html + card.cjs               opener and closer card (Squad icon, headline, chips, VO captions)
  video.example.json                 copy to start a new video
docs/media/squad-guide-<n>/          one folder per video
  video.json                         size, fps, version, opener/closer text, chips, VO timings
  narration.json                     [{ id, caption, line }]  caption = on screen, line = spoken
  audio-neural/                      generated: cached speech, durations.json (gitignored scratch if large)
  squad-guide-<n>.mp4, .en.srt, .en.vtt, transcript.txt, poster.jpg   generated
e2e/demo-squad-guide-<n>.spec.ts     the recording
e2e/sdk/demo-video.ts                say()/caption()/section()/flash()/finish() helper
e2e/sdk/demo-video-core.ts           pure logic (size parsing, narration ordering, config checks)
```

## Requirements

`python3 -m pip install edge-tts`, `ffmpeg`/`ffprobe`, Playwright Chromium, Node. Record in a built
app (`pnpm build`), not a dev build, so labels match what users see.

## Steps

1. `cp docs/media/squad-guide-tools/video.example.json docs/media/squad-guide-<n>/video.json` and edit.
   `opener.lines[].at` are the seconds each opener line starts; `opener.revealAt` is when the app
   starts rising; `opener.duration` is the opener length. Write `narration.json` (ids unique).
2. `python3 docs/media/squad-guide-tools/render.py docs/media/squad-guide-<n> --check`, then `--audio`
   (needs network for edge-tts; writes `audio-neural/durations.json`).
3. Write the spec with the helper. Say lines in `narration.json` order; the helper throws if the
   order or captions differ and holds each line until it has been spoken.

   ```ts
   const demo = await createDemoVideo(page);
   await demo.flash();                                  // render.py trims the recording here
   await demo.section({ number: 1, title: 'Thread tabs', subtitle: '...', hint: '...' });
   await demo.say('open-board');
   await demo.finish();                                 // waits out the last line, writes the timeline
   ```
   The spec must size the window too: `setContentSize(w, h)` with `parseRecordSize(process.env.ZCC_E2E_RECORD_SIZE)`.
4. Record:
   ```
   ZCC_E2E_RECORD_SIZE=1920x1080 \
   ZCC_DEMO_NARRATION=$PWD/docs/media/squad-guide-<n>/audio-neural/durations.json \
   ZCC_DEMO_TIMELINE=$PWD/e2e/.artifacts/squad-guide-<n>/timeline.json \
   ZCC_E2E_RECORD_VIDEO=$PWD/e2e/.artifacts/squad-guide-<n> \
   pnpm test:e2e -- e2e/demo-squad-guide-<n>.spec.ts
   ```
   `ZCC_E2E_RECORD_SIZE` defaults to 1440x900 (existing demos unchanged).
5. Mix: `python3 docs/media/squad-guide-tools/render.py docs/media/squad-guide-<n> --mix e2e/.artifacts/squad-guide-<n>`.
   `--fps 60` is supported by the script but UNTESTED, and Playwright may not capture real 60 fps.
6. Check size, length, loudness and captions, then look at a contact sheet. Publishing is a separate,
   owner-approved step (`content/videos/README.md`).

## Notes

- The section title bar is an overlay at the top of the page, so it covers the app's top 64 px
  (scaled with the frame). Pick shots accordingly, or call `demo.clearSection()`.
- Card previews without a full render: `node docs/media/squad-guide-tools/card.cjs stills <dir> --config <video.json> --mode opener --app <frame.jpg> --at 3 --at 8`.
- No secrets or real project names on screen; use the demo project.
