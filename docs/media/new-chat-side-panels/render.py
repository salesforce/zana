"""Composite the real Electron recording (including native browser child views).

python3 docs/media/new-chat-side-panels/render.py artifacts/new-chat-panels/frames-verified artifacts/new-chat-panels/recording.mp4
Then use ../zana-intro/prepend.py to add the required intro.
"""
import argparse
import json
import math
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser()
parser.add_argument('frames', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--pace', type=float, default=1.35, help='Stretch playback for readable captions')
args = parser.parse_args()
if args.pace <= 0:
    parser.error('--pace must be positive')
timeline = json.loads((args.frames / 'timeline.json').read_text())
frames, captions = timeline['frames'], timeline['captions']
for row in frames + captions:
    row['time'] *= args.pace
if not frames:
    raise SystemExit('No frames captured')
fps = 15
first = Image.open(args.frames / '000000.png')
width, height = 1440, round(first.height * 1440 / first.width) // 2 * 2
font_paths = ['/System/Library/Fonts/Supplemental/Arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']
font_path = next((path for path in font_paths if Path(path).exists()), None)
font = ImageFont.truetype(font_path, 21) if font_path else ImageFont.load_default()
process = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'warning', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', f'{width}x{height}', '-framerate', str(fps), '-i', '-', '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(args.output)], stdin=subprocess.PIPE)
index = 0
cached = None
last_index = -1
for frame_number in range(math.ceil((frames[-1]['time'] + 1) * fps)):
    at = frame_number / fps
    while index + 1 < len(frames) and frames[index + 1]['time'] <= at:
        index += 1
    if index != last_index:
        row = frames[index]
        base = Image.open(args.frames / f'{row["index"]:06}.png').convert('RGB')
        scale = base.width / 1440
        for child in row['children']:
            overlay = Image.open(args.frames / child['file']).convert('RGB')
            size = (round(child['width'] * scale), round(child['height'] * scale))
            base.paste(overlay.resize(size, Image.Resampling.LANCZOS), (round(child['x'] * scale), round(child['y'] * scale)))
        cached = base.resize((width, height), Image.Resampling.LANCZOS)
        last_index = index
    image = cached.copy()
    caption = next((row['text'] for row in reversed(captions) if row['time'] <= at), '')
    if caption:
        layer = Image.new('RGBA', image.size)
        draw = ImageDraw.Draw(layer)
        bounds = draw.textbbox((0, 0), caption, font=font)
        text_width = bounds[2] - bounds[0]
        x, y = (width - text_width) // 2, height - 57
        draw.rounded_rectangle((x - 20, y - 12, x + text_width + 20, y + 37), radius=10, fill=(17, 24, 39, 237))
        draw.text((x, y), caption, font=font, fill='white')
        image = Image.alpha_composite(image.convert('RGBA'), layer).convert('RGB')
    process.stdin.write(image.tobytes())
process.stdin.close()
if process.wait() != 0:
    raise SystemExit('ffmpeg failed')
print(f'{args.output}: {width}x{height}, {frames[-1]["time"] + 1:.1f}s')
