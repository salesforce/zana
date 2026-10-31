#!/usr/bin/env python3
"""Zana tour: Ava neural narration over the real Electron screen recording.

  python3 render.py --audio                    # synthesize narration, write audio-neural/durations.json
  ZCC_DEMO_NARRATION=$PWD/docs/media/zana-tour/audio-neural/durations.json \
  ZCC_DEMO_TIMELINE=$PWD/e2e/.artifacts/demo-zana-tour/timeline.json \
  ZCC_E2E_RECORD_VIDEO=$PWD/e2e/.artifacts/demo-zana-tour pnpm test:e2e -- e2e/demo-zana-tour.spec.ts
  python3 render.py --mix e2e/.artifacts/demo-zana-tour   # trim at the black flash, zoom, mix, mux, captions
  python3 render.py --mix e2e/.artifacts/demo-zana-tour exec   # the executive cut: the beats in CUTS['exec']

Each line starts as its action begins and the next waits for it to end, so the voice runs
continuously over the tour at its natural pace. Captions are the spoken lines, in the SRT/VTT.
"""
import asyncio, hashlib, json, os, re, subprocess, sys, wave
from pathlib import Path

OUT = Path(__file__).resolve().parent
AUDIO = OUT / 'audio-neural'
VOICE, VOICE_RATE = 'en-US-AvaMultilingualNeural', '-5%'
RATE = 48000
LINES = json.loads((OUT / 'narration.json').read_text())

# The opener (intro.html, captured by intro.cjs) speaks these lines at these times, then hands
# off on the recording's first frame. INTRO matches TIMING.DURATION in intro.html.
INTRO, XFADE, FPS = 11.0, 0.2, 30
W, H = 1440, 900
# A cut keeps these beats of the recording, each from its line to the next, joined by short fades.
CUTS = {'exec': ['agents', 'preview', 'squads', 'flow', 'plugins', 'folder', 'change', 'dashboard', 'everywhere', 'outro']}
JOIN = 0.3
PAD, TAIL = 0.5, 1.0
INTRO_LINES = [(0.5, 'Your agents are everywhere: terminals, tabs, chats.'), (4.9, 'Zana brings them all into one command center.')]


def run(*args):
    subprocess.run(args, check=True)


def duration(path):
    data = subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', str(path)])
    return float(json.loads(data)['format']['duration'])


def clip(line):
    digest = hashlib.sha256(f'{VOICE}|{VOICE_RATE}|{line}'.encode()).hexdigest()[:12]
    source = AUDIO / f'{digest}.mp3'
    source.with_suffix('.txt').write_text(line)
    if not source.exists() or source.stat().st_size < 1000:
        import edge_tts
        pending = source.with_suffix('.pending.mp3')
        asyncio.run(edge_tts.Communicate(line, VOICE, rate=VOICE_RATE, proxy=os.environ.get('HTTPS_PROXY')).save(str(pending)))
        pending.replace(source)
    trimmed = source.with_suffix('.wav')
    run('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(source), '-af',
        'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.04,areverse,'
        'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.10,areverse',
        '-ar', str(RATE), '-ac', '1', str(trimmed))
    return trimmed


def audio():
    AUDIO.mkdir(exist_ok=True)
    for _, line in INTRO_LINES:
        print(f' intro {duration(clip(line)):5.2f}s  {line}')
    durations = []
    for i, entry in enumerate(LINES):
        seconds = duration(clip(entry['line']))
        durations.append({'id': entry['id'], 'ms': round(seconds * 1000)})
        print(f'{i + 1:2}/{len(LINES)} {seconds:5.2f}s  {entry["line"]}')
    (AUDIO / 'durations.json').write_text(json.dumps(durations, indent=2) + '\n')
    print(f'total speech {sum(d["ms"] for d in durations) / 1000:.1f}s')


def render_intro(video, start):
    """Capture intro.html, ending on the recording's first frame."""
    frame = AUDIO / 'intro-app.jpg'
    run('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-ss', f'{start + 0.05:.3f}', '-i', str(video), '-frames:v', '1', '-q:v', '2', str(frame))
    spoken = ','.join(f'{duration(clip(line)):.2f}' for _, line in INTRO_LINES)
    out = AUDIO / 'intro.mp4'
    run('node', str(OUT / 'intro.cjs'), 'video', str(out), str(frame), spoken)
    return out


def music(total, lead):
    """Music bed and opener sound effects, with music.cjs; quieter once the walkthrough starts."""
    cues = {
        'duration': round(total, 2),
        'chords': [round(i * 3.43, 2) for i in range(int(total / 3.43) + 1)],
        'energy': [[0, 0.3], [2.5, 0.45], [6.15, 0.7], [lead, 0.4], [total, 0.0]],
        'pluckFrom': 0.35,
        'drums': [[6.15, lead + 1.0]],
        'whoosh': [[0.4, 1.2, 0.22], [6.0, 1.4, 0.3], [10.0, 1.1, 0.24]],
        'kick': [[6.12, 0.55]],
        'chime': [[6.3, 0.1], [7.05, 0.05]],
        'pop': [[0.15 + i * 0.2, 0.05] for i in range(6)] + [[2.3 + i * 0.22, 0.04] for i in range(6)] + [[7.0 + i * 0.16, 0.04] for i in range(4)],
    }
    (AUDIO / 'music-cues.json').write_text(json.dumps(cues))
    out = AUDIO / 'music.wav'
    run('node', str(OUT / 'music.cjs'), str(AUDIO / 'music-cues.json'), str(out))
    return out


def flash_end(video):
    log = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(video), '-vf', 'blackdetect=d=0.2:pix_th=0.05', '-an', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    ends = [float(m) for m in re.findall(r'black_end:([\d.]+)', log)]
    if not ends:
        raise SystemExit('no black flash found in the recording')
    return ends[0]


def zoom_filter(zooms):
    """Smooth zooms onto the regions the spec recorded (zooms.json), as one zoompan over the recording.

    Each region eases in and out over RAMP seconds; the frame is upscaled first so the pan does not jitter."""
    if not zooms:
        return ''
    RAMP, PAD, MAX = 0.7, 1.3, 1.7
    weight, zoom, cx, cy = [], [], [], []
    for z in zooms:
        box = z['box']
        factor = max(1.0, min(MAX, W / (box['width'] * PAD), H / (box['height'] * PAD)))
        if factor < 1.08:
            continue
        a, b = z['at'] / 1000, (z['at'] + z['ms']) / 1000
        m = f'min(clip((it-{a:.3f})/{RAMP},0,1),clip(({b:.3f}-it)/{RAMP},0,1))'
        e = f'({m})*({m})*(3-2*({m}))'
        weight.append(e)
        zoom.append(f'{factor - 1:.3f}*{e}')
        # Keep the region's centre, but never pan past the frame's edge.
        cx.append(f'{box["x"] + box["width"] / 2 - W / 2:.1f}*{e}')
        cy.append(f'{box["y"] + box["height"] / 2 - H / 2:.1f}*{e}')
    if not zoom:
        return ''
    z = f'1+{"+".join(zoom)}'
    x = f"clip(({W / 2}+{'+'.join(cx)})*2-iw/zoom/2,0,iw-iw/zoom)"
    y = f"clip(({H / 2}+{'+'.join(cy)})*2-ih/zoom/2,0,ih-ih/zoom)"
    return f"scale={W * 2}:{H * 2}:flags=lanczos,zoompan=z='{z}':x='{x}':y='{y}':d=1:s={W}x{H}:fps={FPS},"


def wrap(text, width=56):
    """Two caption lines, broken at the space nearest the middle."""
    if len(text) <= width:
        return text
    spaces = [i for i, c in enumerate(text) if c == ' ']
    cut = min(spaces, key=lambda i: abs(i - len(text) / 2))
    return f'{text[:cut]}\n{text[cut + 1:]}'


def stamp(seconds, sep=','):
    ms = round(seconds * 1000)
    return f'{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02}{sep}{ms % 1000:03}'


def recording(folder, video, start, timeline, beats):
    """The recording from the black flash, zoomed, and cut down to `beats` (all when None)."""
    zooms = json.loads((folder / 'zooms.json').read_text()) if (folder / 'zooms.json').exists() else []
    full = AUDIO / 'recording.mp4'
    run('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-ss', f'{start:.3f}', '-i', str(video), '-an',
        '-vf', f'fps={FPS},setpts=PTS-STARTPTS,{zoom_filter(zooms)}format=yuv420p',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', str(full))
    if beats is None:
        return full, timeline
    ends = {t['id']: (t['at'] / 1000, (timeline[i + 1]['at'] / 1000) if i + 1 < len(timeline) else duration(full))
            for i, t in enumerate(timeline)}
    # A cut plays each line at normal speed, then fast-forwards the rest of the beat into TAIL seconds,
    # so the outcome (the page, the done Squad) still shows without the wait.
    spoken = {d['id']: d['ms'] / 1000 for d in json.loads((AUDIO / 'durations.json').read_text())}
    kept, chain, inputs, offset = [], [], [], 0.0
    for i, beat in enumerate(beats):
        a, b = ends[beat]
        inputs += ['-ss', f'{a:.3f}', '-t', f'{b - a:.3f}', '-i', str(full)]
        kept.append({'id': beat, 'at': round(offset * 1000)})
        keep = spoken[beat] + PAD
        if b - a > keep + TAIL:
            chain.append(f'[{i}:v]split[a{i}][b{i}];[a{i}]trim=0:{keep:.3f},setpts=PTS-STARTPTS[p{i}];'
                         f'[b{i}]trim={keep:.3f},setpts=(PTS-STARTPTS)*{TAIL / (b - a - keep):.4f}[q{i}];'
                         f'[p{i}][q{i}]concat=n=2:v=1,fps={FPS},settb=AVTB[s{i}]')
            length = keep + TAIL
        else:
            chain.append(f'[{i}:v]fps={FPS},settb=AVTB[s{i}]')
            length = b - a
        if i:
            prev = f'[j{i - 1}]' if i > 1 else '[s0]'
            chain.append(f'{prev}[s{i}]xfade=transition=fade:duration={JOIN}:offset={offset:.3f}[j{i}]')
        offset += length - JOIN
    out = AUDIO / 'recording-cut.mp4'
    run('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', *inputs, '-filter_complex', ';'.join(chain), '-map', f'[j{len(beats) - 1}]',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', str(out))
    return out, kept


def mix(folder, cut=None):
    folder = Path(folder)
    name = f'zana-tour-{cut}' if cut else 'zana-tour'
    video = next(folder.glob('*.webm'))
    timeline = json.loads((folder / 'timeline.json').read_text())
    assert [t['id'] for t in timeline] == [e['id'] for e in LINES], 'timeline lines differ from narration.json'
    rec, timeline = recording(folder, video, flash_end(video), timeline, CUTS[cut] if cut else None)
    lines = {e['id']: e['line'] for e in LINES}
    intro = render_intro(rec, 0)
    lead = INTRO - XFADE  # the recording starts as the opener settles on its first frame
    total = lead + duration(rec)
    track = bytearray(round(total * RATE) * 2)
    cues = []
    for at, line in INTRO_LINES + [(lead + t['at'] / 1000, lines[t['id']]) for t in timeline]:
        with wave.open(str(clip(line)), 'rb') as w:
            samples = w.readframes(w.getnframes())
        offset = round(at * RATE) * 2
        track[offset:offset + len(samples)] = samples[:max(0, len(track) - offset)]
        cues.append((at, at + len(samples) / 2 / RATE, line))
    assembled = AUDIO / 'assembled.wav'
    with wave.open(str(assembled), 'wb') as w:
        w.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
        w.writeframes(track)
    voice = AUDIO / 'voiceover.wav'
    run('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(assembled), '-af', 'loudnorm=I=-16:TP=-1.5:LRA=7',
        '-ar', str(RATE), '-ac', '1', str(voice))
    # Voice over the music bed, ducked while Ava speaks; the sum is normalized again.
    run('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(voice), '-i', str(music(total, lead)), '-filter_complex',
        '[0:a]aformat=channel_layouts=stereo,asplit[v][key];[1:a]volume=0.55[m];[m][key]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[duck];'
        '[v][duck]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=9[a]', '-map', '[a]', '-ar', str(RATE), str(AUDIO / 'mix.wav'))
    # End shortly after the last spoken line, fading out instead of showing the teardown.
    end = min(total, cues[-1][1] + 0.9)
    fade = f'fade=t=out:st={end - 0.6:.3f}:d=0.6'
    # The title card (the opener's logo frame) is the poster and the first frame, so players never show a blank first image.
    poster = OUT / f'{name}-poster.jpg'
    run('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-ss', '8.9', '-i', str(intro), '-frames:v', '1', '-q:v', '3', str(poster))
    video_filter = (f'[1:v]settb=AVTB,setpts=PTS-STARTPTS[rec];'
                    f'[0:v]settb=AVTB[card];[card][rec]xfade=transition=fade:duration={XFADE}:offset={lead}[cut];'
                    f'[3:v]format=yuva420p,fade=t=out:st=0.6:d=0.5:alpha=1,settb=AVTB,setpts=PTS-STARTPTS[title];'
                    f'[cut][title]overlay=eof_action=pass,{fade}[v]')
    run('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(intro), '-i', str(rec), '-i', str(AUDIO / 'mix.wav'),
        '-loop', '1', '-framerate', str(FPS), '-t', '1.2', '-i', str(poster),
        '-filter_complex', video_filter, '-map', '[v]', '-map', '2:a', '-t', f'{end:.3f}', '-af', f'a{fade}',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', str(OUT / f'{name}.mp4'))
    (OUT / f'{name}.en.srt').write_text('\n'.join(f'{i}\n{stamp(a)} --> {stamp(b)}\n{wrap(t)}\n' for i, (a, b, t) in enumerate(cues, 1)))
    (OUT / f'{name}.en.vtt').write_text('WEBVTT\n\n' + '\n'.join(f'{stamp(a, ".")} --> {stamp(b, ".")}\n{wrap(t)}\n' for a, b, t in cues))
    (OUT / f'{name}.txt').write_text('\n\n'.join([line for _, line in INTRO_LINES] + [lines[t['id']] for t in timeline]) + '\n')
    print(f'{name}.mp4 {duration(OUT / f"{name}.mp4"):.1f}s')


if __name__ == '__main__':
    if sys.argv[1:2] == ['--audio']:
        audio()
    elif sys.argv[1:2] == ['--mix'] and len(sys.argv) in (3, 4) and (len(sys.argv) == 3 or sys.argv[3] in CUTS):
        mix(sys.argv[2], sys.argv[3] if len(sys.argv) == 4 else None)
    else:
        raise SystemExit(__doc__)
