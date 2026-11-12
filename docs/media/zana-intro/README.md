# Zana intro

The shared 3.5 s opener for every Zana video, in light and dark (`zana-intro.js`):

- **0 s:** the Zana mark is already in the middle (frame 0 is never empty), and plugin tiles fly in.
- **0.5–1.3 s:** the tiles circle the mark on a ring and connect to it with dashed links.
- **1.5–2.1 s:** the plugins snap into the mark. The wings flap, the star sparkles and a pulse ring goes out.
- **1.9–2.7 s:** the "Zana" wordmark rises, then the title (tagline plus a gradient accent).
- **2.95–3.5 s:** the camera zooms through, fading into the video's first frame.

| File | Use |
|---|---|
| `zana-intro.js` | The module: `ZanaIntro.mount(stage, { theme: 'light' \| 'dark', tagline, accent })` returns `{ render(t) }`. Exposes `DURATION` and `POSTER_AT`. |
| `intro.html` | Standalone page. Open it in a browser to preview (click to replay). Params: `?theme=light&tagline=…&accent=…&w=&h=&bg=`. |
| `render.mjs` | Captures `intro.html` to an mp4 at any size/fps, optionally over a background frame, plus a poster. |
| `prepend.py` | Prepends the intro to an existing video: matches size/fps/theme, adds the intro SFX if the video has audio, shifts the VTT. |
| `clips/intro-light.mp4`, `clips/intro-dark.mp4` (+ `.jpg` posters) | Generic 1920×1080 clips ("Built from plugins. Including yours.") for editors. |

```sh
node docs/media/zana-intro/render.mjs --theme light --out docs/media/zana-intro/clips/intro-light.mp4 --poster docs/media/zana-intro/clips/intro-light.jpg
python3 docs/media/zana-intro/prepend.py in.mp4 out.mp4 --title "How to use a Squad" --vtt in.en.vtt --vtt-out out.en.vtt --poster out.jpg
```

The intro sound comes from `../zana-tour/music.cjs`: sparkle pops as the tiles arrive, a chime on the star,
a kick when the plugins snap in and a whoosh through the zoom.
