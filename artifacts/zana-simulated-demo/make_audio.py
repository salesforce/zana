"""Offline narration with macOS Samantha. Caption times follow the actual audio."""
import hashlib
import json
import subprocess
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RATE = 24000
DURATION = 190
cues = json.loads((ROOT / 'narration.json').read_text())
audio = bytearray(RATE * DURATION * 2)
captions = []

def run(args):
    subprocess.run(args, check=True)

def stamp(seconds, vtt=False):
    milliseconds = round(seconds * 1000)
    h, rest = divmod(milliseconds, 3600000)
    m, rest = divmod(rest, 60000)
    s, ms = divmod(rest, 1000)
    return f'{h:02}:{m:02}:{s:02}{"." if vtt else ","}{ms:03}'

for i, cue in enumerate(cues):
    digest = hashlib.sha256(cue['text'].encode()).hexdigest()[:10]
    stem = ROOT / 'audio' / f'{i:02}-{digest}'
    source = stem.with_suffix('.aiff')
    clip = stem.with_suffix('.wav')
    if not clip.exists():
        run(['say', '-v', 'Samantha', '-r', '181', '-o', str(source), cue['text']])
        run(['ffmpeg', '-v', 'error', '-y', '-i', str(source), '-ar', str(RATE), '-ac', '1', str(clip)])
    with wave.open(str(clip)) as wav:
        data = wav.readframes(wav.getnframes())
    duration = len(data) / 2 / RATE
    next_start = cues[i + 1]['start'] if i+1 < len(cues) else DURATION - .2
    # Bound each phrase to its action window; tiny accelerations avoid narration collisions.
    available = next_start - cue['start'] - .25
    if duration > available:
        speed = duration / available
        if speed > 1.18:
            raise ValueError(f'Phrase {i} needs shortening: {duration:.2f}s in {available:.2f}s')
        adjusted = stem.with_suffix('.fit.wav')
        run(['ffmpeg', '-v', 'error', '-y', '-i', str(clip), '-af', f'atempo={speed:.6f}', str(adjusted)])
        with wave.open(str(adjusted)) as wav:
            data = wav.readframes(wav.getnframes())
        duration = len(data) / 2 / RATE
    offset = round(cue['start'] * RATE) * 2
    audio[offset:offset + len(data)] = data
    end = min(cue['start'] + duration + .25, next_start - .1)
    captions.append({**cue, 'end': round(end, 3)})
    print(f'{i:02} {cue["start"]:6.2f}–{end:6.2f} {cue["text"]}', flush=True)

with wave.open(str(ROOT / 'audio/narration.wav'), 'wb') as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(RATE)
    wav.writeframes(audio)
run(['ffmpeg', '-v', 'error', '-y', '-i', str(ROOT / 'audio/narration.wav'), '-af',
     'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', '-c:a', 'aac', '-b:a', '160k',
     str(ROOT / 'audio/narration.m4a')])
(ROOT / 'captions.js').write_text('globalThis.DemoCaptions = ' + json.dumps(captions, ensure_ascii=False, indent=2) + ';\n')
(ROOT / 'captions.srt').write_text('\n\n'.join(f'{i+1}\n{stamp(c["start"])} --> {stamp(c["end"])}\n{c["text"]}' for i,c in enumerate(captions)) + '\n')
(ROOT / 'captions.vtt').write_text('WEBVTT\n\n' + '\n\n'.join(f'{stamp(c["start"],True)} --> {stamp(c["end"],True)}\n{c["text"]}' for c in captions) + '\n')
(ROOT / 'narration.md').write_text('# Zana walkthrough narration\n\n' + '\n\n'.join(f'**{stamp(c["start"],True)[:8]}** {c["text"]}' for c in captions) + '\n')
