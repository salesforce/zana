#!/usr/bin/env python3
"""Shared renderer for the narrated Squad guide videos (docs/media/squad-guide-<n>/).

Adapted from docs/media/squads/render.py: same Ava voice, black-flash trim, ducked music bed and
-16 LUFS / -1.5 dBTP mix, but resolution, FPS, opener lines and the closer come from the video's
video.json instead of constants. See docs/media/squad-guide-README.md.

  python3 render.py docs/media/squad-guide-1 --audio       # synthesize narration, write audio-neural/durations.json
  python3 render.py docs/media/squad-guide-1 --check       # validate video.json + narration.json only
  python3 render.py docs/media/squad-guide-1 --mix e2e/.artifacts/squad-guide-1 [--fps 60]

--fps overrides video.json "fps" (30 default). 60 is UNTESTED: it only changes the output frame rate
of the mix and cards; whether Playwright recordVideo captures real 60 fps is not verified, so it may
just duplicate frames.
"""
import argparse, asyncio, hashlib, json, os, re, subprocess, wave
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
MUSIC = TOOLS / 'music.cjs'  # synthesized bed: squads/music.cjs with soft bells instead of noise whooshes
VOICE, VOICE_RATE = 'en-US-AvaMultilingualNeural', '-5%'
RATE = 48000
XFADE = 0.2
TAIL = 0.6  # silence after the last spoken section line before the closer


def validate(cfg, lines):
    """Return a list of problems with video.json and narration.json (the structural checks of e2e/sdk/demo-video-core.ts; the narration entries are checked only here, and chips only there)."""
    errors = []
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]*', str(cfg.get('id', ''))):
        errors.append('id must be a lowercase slug')
    if not str(cfg.get('title', '')).strip():
        errors.append('title is required')
    w, h = cfg.get('width'), cfg.get('height')
    if not (isinstance(w, int) and isinstance(h, int) and 0 < w <= 7680 and 0 < h <= 4320 and w % 2 == 0 and h % 2 == 0):
        errors.append('width/height must be positive even integers within 7680x4320')
    if cfg.get('fps') not in (30, 60):
        errors.append('fps must be 30 or 60')
    opener = cfg.get('opener')
    if not isinstance(opener, dict):
        errors.append('opener is required')
    else:
        if not str(opener.get('headline', '')).strip():
            errors.append('opener.headline is required')
        if not opener.get('duration', 0) > 0:
            errors.append('opener.duration must be positive')
        op_lines = opener.get('lines')
        if not isinstance(op_lines, list) or not op_lines or not all(isinstance(l, dict) and str(l.get('text', '')).strip() and isinstance(l.get('at'), (int, float)) for l in op_lines):
            errors.append('opener.lines must be a non-empty list of {at, text}')
        else:
            ats = [l['at'] for l in op_lines]
            if ats != sorted(set(ats)) or any(a < 0 for a in ats) or any(a >= opener.get('duration', 0) for a in ats):
                errors.append('opener.lines must be in strict time order, inside opener.duration')
        if not 0 <= opener.get('revealAt', -1) < opener.get('duration', 0):
            errors.append('opener.revealAt must be inside opener.duration')
    closer = cfg.get('closer')
    if closer is not None and not (isinstance(closer, dict) and closer.get('duration', 0) > 0):
        errors.append('closer must be an object with a positive duration')
    if not lines:
        errors.append('narration.json is empty')
    for i, entry in enumerate(lines):
        if not entry.get('caption') or not entry.get('line'):
            errors.append(f'narration.json entry {i} needs caption and line')
    ids = [e['id'] for e in lines if 'id' in e]
    if len(ids) != len(set(ids)):
        errors.append('narration.json ids must be unique')
    return errors


def load(folder):
    folder = Path(folder).resolve()
    cfg = json.loads((folder / 'video.json').read_text())
    lines = json.loads((folder / 'narration.json').read_text())
    errors = validate(cfg, lines)
    if errors:
        raise SystemExit('invalid video config:\n  ' + '\n  '.join(errors))
    return folder, cfg, lines


def run(*args):
    subprocess.run(args, check=True)


def duration(path):
    data = subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', str(path)])
    return float(json.loads(data)['format']['duration'])


def clip(audio_dir, line):
    digest = hashlib.sha256(f'{VOICE}|{VOICE_RATE}|{line}'.encode()).hexdigest()[:12]
    source = audio_dir / f'{digest}.mp3'
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


def audio(folder, cfg, lines):
    audio_dir = folder / 'audio-neural'
    audio_dir.mkdir(exist_ok=True)
    extra = [l['text'] for l in cfg['opener']['lines']] + ([cfg['closer']['line']] if (cfg.get('closer') or {}).get('line') else [])
    for line in extra:
        print(f' card  {duration(clip(audio_dir, line)):5.2f}s  {line}')
    durations = []
    for i, entry in enumerate(lines):
        seconds = duration(clip(audio_dir, entry['line']))
        durations.append({**({'id': entry['id']} if 'id' in entry else {}), 'caption': entry['caption'], 'ms': round(seconds * 1000)})
        print(f'{i + 1:2}/{len(lines)} {seconds:5.2f}s  {entry["line"]}')
    (audio_dir / 'durations.json').write_text(json.dumps(durations, indent=2) + '\n')
    print(f'total speech {sum(d["ms"] for d in durations) / 1000:.1f}s')


def flash_end(video):
    log = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(video), '-vf', 'blackdetect=d=0.2:pix_th=0.05', '-an', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    ends = [float(m) for m in re.findall(r'black_end:([\d.]+)', log)]
    if not ends:
        raise SystemExit('no black flash found in the recording (call demo.flash() before the first section)')
    return ends[0]


def stamp(seconds, sep=','):
    ms = round(seconds * 1000)
    return f'{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02}{sep}{ms % 1000:03}'


def capture_card(folder, cfg, mode, frame, spoken, fps, out):
    run('node', str(TOOLS / 'card.cjs'), 'video', str(out), '--config', str(folder / 'video.json'), '--mode', mode,
        '--app', str(frame), '--vo', spoken, '--fps', str(fps))


def music(folder, cfg, total, lead):
    """Music bed from the shared synthesizer; energy rises at the reveal and falls under the walkthrough."""
    reveal = cfg['opener']['revealAt']
    cues = {
        'duration': round(total, 2),
        'chords': [round(i * 3.43, 2) for i in range(int(total / 3.43) + 1)],
        'energy': [[0, 0.3], [reveal - 3.5, 0.45], [reveal, 0.7], [lead, 0.4], [total - 4, 0.35], [total, 0.0]],
        'pluckFrom': 0.35,
        'drums': [[reveal, lead + 1.0]],
        'whoosh': [[0.4, 1.2, 0.26], [reveal - 0.15, 1.2, 0.26], [lead - 1.2, 1.2, 0.26]],
    }
    out = folder / 'audio-neural'
    (out / 'music-cues.json').write_text(json.dumps(cues))
    run('node', str(MUSIC), str(out / 'music-cues.json'), str(out / 'music.wav'))
    return out / 'music.wav'


def mix(folder, cfg, lines, rec_dir, fps):
    audio_dir, w, h = folder / 'audio-neural', cfg['width'], cfg['height']
    rec_dir = Path(rec_dir)
    webms = sorted(rec_dir.glob('*.webm'))
    if len(webms) != 1:
        raise SystemExit(f'{rec_dir}: expected exactly one .webm recording, found {len(webms)}; clear the directory and record again')
    video = webms[0]
    timeline = json.loads((rec_dir / 'timeline.json').read_text())
    if [t['text'] for t in timeline] != [e['caption'] for e in lines]:
        raise SystemExit('timeline captions differ from narration.json; record again')
    durations = json.loads((audio_dir / 'durations.json').read_text())
    start = flash_end(video)
    opener_cfg, closer_cfg = cfg['opener'], cfg.get('closer')
    lead = opener_cfg['duration'] - XFADE  # the recording starts as the opener settles on its first frame
    last_end = timeline[-1]['at'] / 1000 + durations[-1]['ms'] / 1000
    rec_use = min(duration(video) - start, last_end + TAIL)

    first = audio_dir / 'opener-app.jpg'
    run('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-ss', f'{start + 0.05:.3f}', '-i', str(video), '-frames:v', '1', '-q:v', '2', str(first))
    opener_vo = ','.join(f'{duration(clip(audio_dir, l["text"])):.2f}' for l in opener_cfg['lines'])
    opener = audio_dir / 'opener.mp4'
    capture_card(folder, cfg, 'opener', first, opener_vo, fps, opener)

    closer = None
    closer_at = lead + rec_use - XFADE
    total = lead + rec_use
    if closer_cfg:
        last = audio_dir / 'closer-app.jpg'
        run('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-ss', f'{start + rec_use - 0.1:.3f}', '-i', str(video), '-frames:v', '1', '-q:v', '2', str(last))
        closer_vo = f'{duration(clip(audio_dir, closer_cfg["line"])):.2f}' if closer_cfg.get('line') else ''
        closer = audio_dir / 'closer.mp4'
        capture_card(folder, cfg, 'closer', last, closer_vo, fps, closer)
        total = closer_at + closer_cfg['duration']

    spoken = [(l['at'], l['text']) for l in opener_cfg['lines']]
    spoken += [(lead + t['at'] / 1000, e['line']) for e, t in zip(lines, timeline)]
    if closer_cfg and closer_cfg.get('line'):
        spoken.append((closer_at + 0.6, closer_cfg['line']))
    track = bytearray(round(total * RATE) * 2)
    cues = []
    for at, line in spoken:
        with wave.open(str(clip(audio_dir, line)), 'rb') as wf:
            samples = wf.readframes(wf.getnframes())
        offset = round(at * RATE) * 2
        track[offset:offset + len(samples)] = samples[:max(0, len(track) - offset)]
        cues.append((at, at + len(samples) / 2 / RATE, line))
    assembled = audio_dir / 'assembled.wav'
    with wave.open(str(assembled), 'wb') as wf:
        wf.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
        wf.writeframes(track)
    voice = audio_dir / 'voiceover.wav'
    run('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(assembled), '-af', 'loudnorm=I=-16:TP=-1.5:LRA=7', '-ar', str(RATE), '-ac', '1', str(voice))
    run('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(voice), '-i', str(music(folder, cfg, total, lead)), '-filter_complex',
        '[0:a]aformat=channel_layouts=stereo,asplit[v][key];[1:a]volume=0.55[m];[m][key]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[duck];'
        '[v][duck]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=9[a]', '-map', '[a]', '-ar', str(RATE), str(audio_dir / 'mix.wav'))

    end = total if closer_cfg and not closer_cfg.get('line') else min(total, cues[-1][1] + 0.9)  # a silent closer keeps its configured duration
    fade = f'fade=t=out:st={end - 0.6:.3f}:d=0.6'
    scale = f'scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,fps={fps},format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS'
    graph = f'[1:v]{scale}[rec];[0:v]settb=AVTB[card];[card][rec]xfade=transition=fade:duration={XFADE}:offset={lead}[v1];'
    inputs = ['-i', str(opener), '-ss', f'{start:.3f}', '-t', f'{rec_use:.3f}', '-i', str(video)]
    if closer:
        graph += f'[3:v]settb=AVTB[end];[v1][end]xfade=transition=fade:duration={XFADE}:offset={closer_at:.3f},{fade}[v]'
        inputs_tail = ['-i', str(audio_dir / 'mix.wav'), '-i', str(closer)]
    else:
        graph += f'[v1]{fade}[v]'
        inputs_tail = ['-i', str(audio_dir / 'mix.wav')]
    out = folder / f'{cfg["id"]}.mp4'
    run('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', *inputs, *inputs_tail, '-filter_complex', graph, '-map', '[v]', '-map', '2:a',
        '-t', f'{end:.3f}', '-af', f'a{fade}', '-r', str(fps), '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-c:a', 'aac', '-b:a', '160k',
        '-movflags', '+faststart', str(out))
    run('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-ss', str(cfg.get('posterAt', max(opener_cfg['duration'] - 1.0, 0))), '-i', str(out), '-frames:v', '1', '-q:v', '3', str(folder / 'poster.jpg'))
    (folder / f'{cfg["id"]}.en.srt').write_text('\n'.join(f'{i}\n{stamp(a)} --> {stamp(b)}\n{t}\n' for i, (a, b, t) in enumerate(cues, 1)))
    (folder / f'{cfg["id"]}.en.vtt').write_text('WEBVTT\n\n' + '\n'.join(f'{stamp(a, ".")} --> {stamp(b, ".")}\n{t}\n' for a, b, t in cues))
    (folder / 'transcript.txt').write_text('\n\n'.join(t for _, t in spoken) + '\n')
    print(f'{out.name} {duration(out):.1f}s {w}x{h} @{fps}fps')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('folder', help='docs/media/squad-guide-<n>')
    parser.add_argument('--fps', type=int, choices=(30, 60), help='output frame rate (default: video.json fps, 30). 60 is untested')
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--audio', action='store_true')
    group.add_argument('--check', action='store_true')
    group.add_argument('--mix', metavar='REC_DIR')
    args = parser.parse_args()
    folder, cfg, lines = load(args.folder)
    if args.check:
        print(f'{cfg["id"]}: ok ({len(lines)} narration lines, {cfg["width"]}x{cfg["height"]})')
    elif args.audio:
        audio(folder, cfg, lines)
    else:
        mix(folder, cfg, lines, args.mix, args.fps or cfg['fps'])


if __name__ == '__main__':
    main()
