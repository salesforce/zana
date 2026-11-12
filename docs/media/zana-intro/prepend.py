"""Prepend the Zana intro to an existing video, and shift its captions to match.

  python3 docs/media/zana-intro/prepend.py <video.mp4> <out.mp4> --title "How to use a Squad"
      [--tagline "…"] [--theme light|dark|auto] [--vtt in.en.vtt --vtt-out out.en.vtt] [--poster out.jpg]

The intro's last frame is the video's first frame, so the cut is seamless; everything in the
video starts exactly INTRO seconds later. With --title the title is drawn in the accent gradient
under the wordmark. --theme auto picks light or dark from the video's brightness.
The intro gets its own sound (sparkles, chime, snap, whoosh from zana-tour/music.cjs) when the
video has an audio track; a silent video stays silent. The poster is the intro's logo lockup.
"""
import argparse, json, re, subprocess, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
MUSIC = HERE.parent / 'zana-tour' / 'music.cjs'
INTRO = 3.5  # ZanaIntro.DURATION in zana-intro.js


def run(*args):
    subprocess.run([str(a) for a in args], check=True)


def probe(path):
    data = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate,sample_rate,channels:format=duration', '-of', 'json', str(path)]))
    v = next(s for s in data['streams'] if s['codec_type'] == 'video')
    a = next((s for s in data['streams'] if s['codec_type'] == 'audio'), None)
    num, den = map(int, v['r_frame_rate'].split('/'))
    return {'w': v['width'], 'h': v['height'], 'fps': round(num / den), 'audio': a, 'duration': float(data['format']['duration'])}


def brightness(path, at):
    log = subprocess.run(['ffmpeg', '-hide_banner', '-ss', str(at), '-i', str(path), '-frames:v', '1', '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    m = re.findall(r'YAVG=([\d.]+)', log)
    return float(m[0]) if m else 0.0


def shift_vtt(src, dst, title):
    def fmt(s):
        return f'{int(s // 3600):02}:{int(s % 3600 // 60):02}:{s % 60:06.3f}'

    def shift(m):
        h, mi, s = m.group(1), m.group(2), m.group(3)
        sec = (int(h) if h else 0) * 3600 + int(mi) * 60 + float(s) + INTRO
        return fmt(sec)
    body = Path(src).read_text(encoding='utf-8').lstrip('﻿')
    head, _, cues = body.partition('\n\n')
    cues = re.sub(r'(?:(\d+):)?(\d{2}):(\d{2}\.\d{3})', shift, cues)
    intro_cue = f'{fmt(0.4)} --> {fmt(INTRO - 0.1)}\nZana · {title}\n'
    Path(dst).write_text(f'{head.strip()}\n\n{intro_cue}\n{cues.lstrip()}', encoding='utf-8')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('video'); ap.add_argument('out')
    ap.add_argument('--title', default=''); ap.add_argument('--tagline', default='')
    ap.add_argument('--theme', default='auto'); ap.add_argument('--vtt'); ap.add_argument('--vtt-out'); ap.add_argument('--poster')
    o = ap.parse_args()
    info = probe(o.video)
    theme = o.theme
    if theme == 'auto':
        theme = 'light' if brightness(o.video, min(3.0, info['duration'] / 2)) > 128 else 'dark'
    with tempfile.TemporaryDirectory(prefix='zana-intro-') as tmp:
        tmp = Path(tmp)
        first = tmp / 'first.png'
        run('ffmpeg', '-y', '-loglevel', 'error', '-i', o.video, '-frames:v', '1', first)
        intro = tmp / 'intro.mp4'
        cmd = ['node', HERE / 'render.mjs', '--out', intro, '--width', info['w'], '--height', info['h'], '--fps', info['fps'],
               '--theme', theme, '--tagline', o.tagline, '--accent', o.title, '--bg', first]
        if o.poster:
            cmd += ['--poster', o.poster]
        run(*cmd)
        inputs = ['-i', intro, '-i', o.video]
        vf = f'[0:v]settb=AVTB,setpts=PTS-STARTPTS,fps={info["fps"]}[i];[1:v]settb=AVTB,setpts=PTS-STARTPTS,fps={info["fps"]},scale={info["w"]}:{info["h"]},setsar=1,format=yuv420p[m];[i][m]concat=n=2:v=1:a=0[v]'
        maps = ['-map', '[v]']
        if info['audio']:
            cues = {'duration': INTRO, 'chords': [0], 'energy': [[0, 0.35], [1.8, 0.7], [2.9, 0.3], [INTRO, 0.0]], 'pluckFrom': 0.3,
                    'drums': [[1.82, INTRO - 0.4]], 'whoosh': [[0.5, 1.0, 0.18], [3.3, 0.9, 0.3]], 'kick': [[1.82, 0.55]],
                    'chime': [[1.6, 0.11]], 'pop': [[0.12 + i * 0.09, 0.045] for i in range(8)] + [[1.47 + i * 0.035, 0.035] for i in range(8)]}
            (tmp / 'cues.json').write_text(json.dumps(cues))
            run('node', MUSIC, tmp / 'cues.json', tmp / 'sfx.wav')
            inputs += ['-i', tmp / 'sfx.wav']
            rate = info['audio'].get('sample_rate', '48000')
            vf += (f';[2:a]aformat=sample_rates={rate}:channel_layouts=stereo,volume=0.35,afade=t=out:st={INTRO - 0.5}:d=0.5,apad=whole_dur={INTRO}[s];'
                   f'[1:a]aformat=sample_rates={rate}:channel_layouts=stereo[ma];[s][ma]concat=n=2:v=0:a=1[a]')
            maps += ['-map', '[a]', '-c:a', 'aac', '-b:a', '160k']
        run('ffmpeg', '-y', '-loglevel', 'error', *inputs, '-filter_complex', vf, *maps,
            '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', o.out)
    if o.vtt:
        shift_vtt(o.vtt, o.vtt_out, ' '.join(filter(None, [o.tagline, o.title])) or 'Zana')
    print(f'{Path(o.out).name}: {theme} intro + {info["duration"]:.2f}s -> {probe(o.out)["duration"]:.2f}s')


if __name__ == '__main__':
    main()
