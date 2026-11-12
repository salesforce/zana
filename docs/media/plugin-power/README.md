# Zana is built from plugins. Including yours.

A 33.5-second silent clip (a 3.5 s logo intro, then the 30 s walkthrough; 1920 × 1080, 30 fps, H.264/yuv420p, captions, fast-start) about
how modular Zana is. It uses the same illustrated style as `guided-start/` and `salesforce-essentials/`.

0. **Intro** (0–3.5 s): plugin tiles fly in and orbit the Zana mark, which builds itself
   (tile, wings, fairy, wand, star). The plugins link up and snap into it. Then come the "Zana" wordmark
   and *Built from plugins. Including yours.*, and the camera zooms through into the app.
   The timings below are walkthrough time; add 3.5 s for the video timestamp.
1. **Plugins** (0–7 s): an x-ray outlines the parts of the app that come from plugins
   (Tasks, Design Docs, PR Monitor, Workflows, Library, the Codex harness/provider and the
   side panel). A counter goes up to 41. The plugins peel away, leaving only the core, then snap back.
2. **Build** (7–16.5 s): *"Make me a plugin that shows who's on call and our open incidents."*
   The agent runs `zcc plugin new oncall --app`, edits `app.tsx`/`server.ts`, then runs `zcc plugin dev`.
   **On-call** appears in the sidebar and opens in the side panel.
3. **Change** (16.5–23.5 s): *"Add a 'Page me' button, and turn red when there's a P1."*
   The panel hot-reloads in place, a P1 arrives, the header turns red and **Page me** pages the on-call engineer.
4. **Share** (23.5–27.6 s): *"Share it with my team."* The agent pushes the plugin. In
   **Plugins → Browse → Team plugins**, On-call shows up and installs in one click.
5. **End** (27.6–30 s): "Zana, shaped by you": Describe it → The agent builds it → Change it live → Share it.

The plugin count matches the `plugins/` folder (41 at the time of writing). The commands are the real
`zcc plugin` CLI. The On-call plugin, the people, the incidents and `platform-team/zana-plugins` are samples.
No agent ran to produce this clip.

## Files

- `plugin-power.html`: the editable source. An animated mock with a scrubber and chapter buttons
  (`window.__seek(t)`). Its chrome/CSS is shared with `salesforce-essentials.html`.
- `render.mjs`: the frame-exact renderer. `--stills` writes key frames to a temp dir.
  `captions()` mirrors `CAPS` in the HTML, so update both together.
- `out/`: render output (gitignored). It holds the mp4, the poster at 0:21.2 and `.en.vtt`. Copy these into
  `content/videos/media/` with hash-named files (see `content/videos/README.md`).

There's also a light-theme cut from the same source (`plugin-power.html?theme=light`). It uses the
app's `:root[data-theme='light']` tokens.

```sh
node docs/media/plugin-power/render.mjs          # dark  → out/plugin-power.mp4
node docs/media/plugin-power/render.mjs --light  # light → out/plugin-power-light.mp4
```

## Voiceover cut (published)

`python3 narrate.py` mixes the light cut with a voiceover and writes `out/plugin-power-light-voice.mp4` (34.3 s),
plus `.en.vtt` and `.txt`. The voice is Ava, a neural voice synthesized with `edge_tts`, the same voice as `zana-tour/`.
The music bed and sound effects (sparkles as the plugin tiles arrive, a chime on the fairy's star, a kick when the plugins
snap in, a whoosh through the zoom, UI clicks) come from `zana-tour/music.cjs`. The music ducks under the voice.
Pass `--dark` to narrate the dark cut. This cut is published to Help as `plugin-power` in `content/videos/catalogue.json`.
