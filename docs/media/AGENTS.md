# Making Zana videos

Read [README.md](README.md) for the per-video folders and pipelines.

- **Every Zana video opens with the Zana intro** in `zana-intro/`. In about 3.5 s, plugin tiles orbit the
  Zana mark, plug into it and snap in. Then the "Zana" wordmark and a gradient title rise, and the camera
  zooms through into the video's first frame.
  - Match the theme to the video: `light` for light videos, `dark` for dark ones.
  - The title is the video's title, or a short tagline.
- **Frame 0 shows the Zana logo in the middle.** Never start on an empty background, a blank app or a
  half-faded frame: thumbnails and players before playback show frame 0. The poster is the intro's
  logo lockup (`ZanaIntro.POSTER_AT`).
- **HTML-rendered videos** (a `render(t)` mock captured by Playwright, like `plugin-power/`) load
  `../zana-intro/zana-intro.js` and run their own timeline on `t - ZanaIntro.DURATION`:
  `ZanaIntro.mount(stage, { theme, tagline, accent })`, then call `intro.render(t)` every frame.
  Shift captions, chapters and narration by the same amount.
- **Recorded or already-rendered videos** get the intro prepended:
  `python3 docs/media/zana-intro/prepend.py in.mp4 out.mp4 --title "…" --vtt in.vtt --vtt-out out.vtt --poster out.jpg`.
  - It picks the theme from the video's brightness; pass `--theme` to force one.
  - It matches the size and fps, ends the intro on the video's first frame, adds the intro sound
    effects when the video has audio, and shifts the captions by 3.5 s.
  - Do not prepend twice. Run it on the source cut, not on a video that already has the intro.
- Narration for Zana videos uses Ava (`en-US-AvaMultilingualNeural` via edge-tts), the voice of Zana the
  fairy. Start the first line after the intro's whoosh, or speak the tagline over it (as `plugin-power/` does).
- Publish to Help through `content/videos/` (see its README); website and bundled copies are updated
  together with the catalogue so every surface shows the same cut.
