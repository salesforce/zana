"""Plugin power: Ava neural voiceover + music bed over the rendered silent cut.

  node docs/media/plugin-power/render.mjs --light      # silent cut first
  python3 docs/media/plugin-power/narrate.py [--dark]  # writes out/plugin-power[-light]-voice.mp4 (+ .en.vtt, .txt)

Voice clips are cached by hash in out/audio/. The music bed and sound effects come from
zana-tour/music.cjs. Times below are video time (the 3.5 s intro included).
"""
import asyncio, hashlib, json, os, subprocess, sys, wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / 'out'
AUDIO = OUT / 'audio'
MUSIC = HERE.parent / 'zana-tour' / 'music.cjs'
VOICE, VOICE_RATE, RATE = 'en-US-AvaMultilingualNeural', '-3%', 48000
INTRO, TAIL = 3.5, 0.8
LINES = [
    (0.55, 'Zana is built from plugins. Including yours.'),
    (4.6, 'Almost everything you see is a plugin. Take them away, and only the core is left.'),
    (10.7, 'Need something new? Just describe it. The agent writes the plugin, and Zana loads it, live.'),
    (20.4, 'Want it different? Just ask. The panel reloads in place, with no restart.'),
    (27.1, 'Then share it, and your team installs it in one click.'),
    (31.3, 'Zana, shaped by you.'),
]
CLICKS = [8.6, 13.4, 17.8, 22.3, 24.3, 26.6]  # mirrors CLICKS in plugin-power.html (walkthrough time)


def run(*args):
    subprocess.run(args, check=True)


def duration(path):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)]))


def clip(line):
    digest = hashlib.sha256(f'{VOICE}|{VOICE_RATE}|{line}'.encode()).hexdigest()[:12]
    source = AUDIO / f'{digest}.mp3'
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


def stamp(s):
    return f'{int(s // 3600):02}:{int(s % 3600 // 60):02}:{s % 60:06.3f}'


def main():
    name = 'plugin-power' if '--dark' in sys.argv else 'plugin-power-light'
    silent = OUT / f'{name}.mp4'
    AUDIO.mkdir(parents=True, exist_ok=True)
    total = duration(silent) + TAIL

    track, cues, prev_end = bytearray(round(total * RATE) * 2), [], 0.0
    for at, line in LINES:
        with wave.open(str(clip(line)), 'rb') as w:
            samples = w.readframes(w.getnframes())
        end = at + len(samples) / 2 / RATE
        if at < prev_end:
            raise SystemExit(f'line at {at}s overlaps the previous one (ends {prev_end:.2f}s)')
        if end > total:
            raise SystemExit(f'last line ends at {end:.2f}s, after the video ({total:.2f}s)')
        offset = round(at * RATE) * 2
        track[offset:offset + len(samples)] = samples
        cues.append((at, end, line)); prev_end = end
        print(f'{at:5.2f}–{end:5.2f}s  {line}')
    assembled = AUDIO / 'assembled.wav'
    with wave.open(str(assembled), 'wb') as w:
        w.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
        w.writeframes(track)
    voice = AUDIO / 'voiceover.wav'
    run('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(assembled), '-af', 'loudnorm=I=-16:TP=-1.5:LRA=7',
        '-ar', str(RATE), '-ac', '1', str(voice))

    # Music: a soft bed, sparkly pops as the plugin tiles arrive, a chime on the fairy's star,
    # a kick when the plugins snap in, a whoosh through the zoom, UI clicks, and a chime at the end card.
    music_cues = {
        'duration': round(total, 2),
        'chords': [round(i * 3.43, 2) for i in range(int(total / 3.43) + 1)],
        'energy': [[0, 0.35], [1.8, 0.7], [INTRO, 0.45], [INTRO + 27.6, 0.6], [total, 0.0]],
        'pluckFrom': 0.3,
        'drums': [[1.82, INTRO + 0.6], [INTRO + 23.5, INTRO + 27.6]],
        'whoosh': [[0.5, 1.0, 0.18], [3.3, 0.9, 0.3], [INTRO + 2.7, 0.8, 0.14], [INTRO + 4.8, 0.8, 0.14], [INTRO + 25.4, 0.8, 0.16]],
        'kick': [[1.82, 0.55], [INTRO + 27.6, 0.4]],
        'chime': [[1.6, 0.11], [INTRO + 12.5, 0.06], [INTRO + 19.75, 0.05], [INTRO + 27.0, 0.06], [INTRO + 27.7, 0.09]],
        'pop': [[0.12 + i * 0.09, 0.045] for i in range(8)] + [[1.47 + i * 0.035, 0.035] for i in range(8)],
        'click': [INTRO + c for c in CLICKS],
    }
    (AUDIO / 'music-cues.json').write_text(json.dumps(music_cues))
    music = AUDIO / 'music.wav'
    run('node', str(MUSIC), str(AUDIO / 'music-cues.json'), str(music))
    mix = AUDIO / 'mix.wav'
    run('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(voice), '-i', str(music), '-filter_complex',
        '[0:a]aformat=channel_layouts=stereo,asplit[v][key];[1:a]volume=0.5[m];[m][key]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[duck];'
        f'[v][duck]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=9,afade=t=out:st={total - 0.7:.3f}:d=0.7[a]',
        '-map', '[a]', '-ar', str(RATE), str(mix))

    out = OUT / f'{name}-voice.mp4'
    run('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(silent), '-i', str(mix), '-filter_complex',
        f'[0:v]tpad=stop_mode=clone:stop_duration={TAIL},fade=t=out:st={total - 0.5:.3f}:d=0.5[v]',
        '-map', '[v]', '-map', '1:a', '-t', f'{total:.3f}', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', str(out))
    (OUT / f'{name}-voice.en.vtt').write_text('WEBVTT\n\n' + '\n'.join(f'{i}\n{stamp(a)} --> {stamp(b)}\n{t}\n' for i, (a, b, t) in enumerate(cues, 1)))
    (OUT / f'{name}-voice.txt').write_text('\n\n'.join(t for _, _, t in cues) + '\n')
    print(f'{out.name} {duration(out):.2f}s')


if __name__ == '__main__':
    main()
