#!/usr/bin/env python3
"""Squads walkthrough: Ava neural narration over the real Electron screen recording.

  python3 render.py --audio                    # synthesize narration, write audio-neural/durations.json
  ZCC_DEMO_NARRATION=$PWD/docs/media/squads/audio-neural/durations.json \
  ZCC_DEMO_TIMELINE=$PWD/e2e/.artifacts/demo-squads/timeline.json \
  ZCC_E2E_RECORD_VIDEO=$PWD/e2e/.artifacts/demo-squads pnpm test:e2e -- e2e/demo-squads.spec.ts
  python3 render.py --mix e2e/.artifacts/demo-squads   # trim at the black flash, mix, mux, captions

The spec holds each caption until its line has been spoken, so speech keeps its natural pace.
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
INTRO_LINES = [(0.5, 'One agent used to do everything, one task at a time.'), (6.6, 'Meet Squads in Zana.')]


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
        durations.append({'caption': entry['caption'], 'ms': round(seconds * 1000)})
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


def stamp(seconds, sep=','):
    ms = round(seconds * 1000)
    return f'{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02}{sep}{ms % 1000:03}'


def mix(folder):
    folder = Path(folder)
    video = next(folder.glob('*.webm'))
    timeline = json.loads((folder / 'timeline.json').read_text())
    assert [t['text'] for t in timeline] == [e['caption'] for e in LINES], 'timeline captions differ from narration.json'
    start = flash_end(video)
    intro = render_intro(video, start)
    lead = INTRO - XFADE  # the recording starts as the opener settles on its first frame
    total = lead + duration(video) - start
    track = bytearray(round(total * RATE) * 2)
    cues = []
    for at, line in INTRO_LINES + [(lead + t['at'] / 1000, e['line']) for e, t in zip(LINES, timeline)]:
        with wave.open(str(clip(line)), 'rb') as w:
            samples = w.readframes(w.getnframes())
        offset = round(at * RATE) * 2
        track[offset:offset + len(samples)] = samples[:max(0, len(track) - offset)]
        cues.append((at, at + len(samples) / 2 / RATE, line))
    assembled = AUDIO / 'assembled.wav'
    with wave.open(str(assembled), 'wb') as w:
        w.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
        w.writeframes(track)
    run('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(assembled), '-af', 'loudnorm=I=-16:TP=-1.5:LRA=7',
        '-ar', str(RATE), '-ac', '1', str(OUT / 'voiceover.wav'))
    # Voice over the music bed, ducked while Ava speaks; the sum is normalized again.
    run('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(OUT / 'voiceover.wav'), '-i', str(music(total, lead)), '-filter_complex',
        '[0:a]aformat=channel_layouts=stereo,asplit[v][key];[1:a]volume=0.55[m];[m][key]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[duck];'
        '[v][duck]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=9[a]', '-map', '[a]', '-ar', str(RATE), str(AUDIO / 'mix.wav'))
    # End shortly after the last spoken line, fading out instead of showing the teardown.
    end = min(total, cues[-1][1] + 0.9)
    fade = f'fade=t=out:st={end - 0.6:.3f}:d=0.6'
    video_filter = (f'[1:v]fps={FPS},format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[rec];'
                    f'[0:v]settb=AVTB[card];[card][rec]xfade=transition=fade:duration={XFADE}:offset={lead},{fade}[v]')
    run('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(intro), '-ss', f'{start:.3f}', '-i', str(video), '-i', str(AUDIO / 'mix.wav'),
        '-filter_complex', video_filter, '-map', '[v]', '-map', '2:a', '-t', f'{end:.3f}', '-af', f'a{fade}',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', str(OUT / 'squads.mp4'))
    run('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-ss', '8.9', '-i', str(OUT / 'squads.mp4'), '-frames:v', '1', '-q:v', '3', str(OUT / 'poster.jpg'))
    (OUT / 'squads.en.srt').write_text('\n'.join(f'{i}\n{stamp(a)} --> {stamp(b)}\n{t}\n' for i, (a, b, t) in enumerate(cues, 1)))
    (OUT / 'squads.en.vtt').write_text('WEBVTT\n\n' + '\n'.join(f'{stamp(a, ".")} --> {stamp(b, ".")}\n{t}\n' for a, b, t in cues))
    (OUT / 'narration.txt').write_text('\n\n'.join([line for _, line in INTRO_LINES] + [e['line'] for e in LINES]) + '\n')
    print(f'squads.mp4 {duration(OUT / "squads.mp4"):.1f}s')


if __name__ == '__main__':
    if sys.argv[1:2] == ['--audio']:
        audio()
    elif sys.argv[1:2] == ['--mix'] and len(sys.argv) == 3:
        mix(sys.argv[2])
    else:
        raise SystemExit(__doc__)
