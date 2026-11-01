# Squads

`squads.mp4` is a 90-second narrated video: an 11-second animated opener, then
the screen recording. 1440 × 900, 30 fps, H.264/yuv420p with AAC audio and
fast-start playback. `presentation.html` is an
11-slide deck about the feature that embeds the video on slide 9 (← → or click
to navigate, F for fullscreen).

The opener follows the Zana demo cut (`zana-demo-v2-full.mp4`): light grid
backdrop, the tasks one agent used to queue, a kinetic headline, the cards
collapsing into the Zana mark with a ring burst, the **Squads** wordmark with
its Orchestrator, two Worker tabs and Reviewer, then the app rising to full
screen on the recording's first frame. A synthesized music bed with the same
sound effects runs under the whole video, ducked beneath the voice.

The walkthrough:

1. **Settings → Squads**: the built-in catalogue.
2. **Ask an agent**: a Modern thread (OpenCode) in `atlas-site` asked to "Set up a
   Docs Squad". It writes `.zcc/teams/docs-squad.json`, and the Squad appears in
   Settings → Squads tagged **Project · atlas-site**.
3. **Or build it yourself, New squad**: name, icon, description; slots for Orchestrator, Squad Worker
   (Medium) × 2 tabs and Code Reviewer; crown the orchestrator; opening prompt and
   the run options (default project, worktree isolation, routing, planning, launch
   approval). Save, then expand the row.
4. **New agent → Squad**: goal, Squad, Project, **Infer plan from goal**, launch.
5. Board and Flow view while workers take tasks.
6. The Squad's question in the Inbox (**Needs your answer**), answered once.
7. Squad details: **COMPLETED**, 4/4 work units.

Captured from an isolated build with `e2e/demo-squads.spec.ts`. Personas are the
built-ins; the Squad's agents are the deterministic e2e fake coordinator, and the
agent that sets up the Docs Squad is the fake ACP agent playing a scripted reply
(`FAKE_ACP_SCRIPT`) through a real client file write. No model was called. The project (`atlas-site`) and goal are samples.

Voice: **Microsoft Ava Multilingual Neural**, `en-US-AvaMultilingualNeural`, at
`-5%`, natural pace. The spec holds each caption until its line has been spoken.
The track is normalized to -16 LUFS with a -1.5 dBTP target.

## Files

- `squads.mp4`, `squads.en.srt` / `.vtt`, `poster.jpg`: video and captions.
- `intro.html` / `intro.cjs`: the opener (`render(t)`) and its frame-by-frame capture.
- `music.cjs`: music bed and sound effects, from the Zana demo cut.
- `presentation.html`: the deck; uses `crop-*.jpg` and the video.
- `narration.json`: caption ↔ spoken line pairs; `narration.txt`, `voiceover.wav`.
- `preview-*.jpg` / `contact-sheet.jpg`: key frames.
- `audio-neural/`: cached speech and `durations.json`.
- `render.py`: narration synthesis and final mix.

## Render

Requires Python with edge-tts, Node with the repo's Playwright, ffmpeg and ffprobe.

```sh
python3 docs/media/squads/render.py --audio
ZCC_DEMO_NARRATION=$PWD/docs/media/squads/audio-neural/durations.json \
ZCC_DEMO_TIMELINE=$PWD/e2e/.artifacts/demo-squads/timeline.json \
ZCC_E2E_RECORD_VIDEO=$PWD/e2e/.artifacts/demo-squads \
  pnpm test:e2e -- e2e/demo-squads.spec.ts
python3 docs/media/squads/render.py --mix e2e/.artifacts/demo-squads
```
