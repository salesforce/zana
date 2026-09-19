"""Validate the rendered media and assemble an offline share package."""
import json
import subprocess
import zipfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VIDEO = ROOT / 'Zana-product-demo.mp4'
probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-show_chapters', '-of', 'json', str(VIDEO)]))
video = next(s for s in probe['streams'] if s['codec_type'] == 'video')
audio = next(s for s in probe['streams'] if s['codec_type'] == 'audio')
assert video['width'] == 1920 and video['height'] == 1080
assert video['codec_name'] == 'h264' and video['pix_fmt'] == 'yuv420p'
assert video['avg_frame_rate'] == '24/1' and int(video['nb_frames']) == 3552
assert audio['codec_name'] == 'aac' and audio['sample_rate'] == '48000'
assert abs(float(probe['format']['duration']) - 148) < .1
assert len(probe['chapters']) == 8
decoded = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(VIDEO), '-f', 'null', '-'], capture_output=True, text=True, check=True)
assert not decoded.stderr.strip(), decoded.stderr
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', '65', '-i', str(VIDEO), '-frames:v', '1', '-q:v', '2', str(ROOT / 'thumbnail.jpg')], check=True)
report = {
    'ok': True,
    'durationSeconds': float(probe['format']['duration']),
    'width': video['width'], 'height': video['height'],
    'fps': video['avg_frame_rate'], 'frames': int(video['nb_frames']),
    'videoCodec': video['codec_name'], 'audioCodec': audio['codec_name'],
    'audioRate': int(audio['sample_rate']), 'bytes': VIDEO.stat().st_size,
    'chapters': [{'start': float(c['start_time']), 'title': c['tags']['title']} for c in probe['chapters']],
    'fullDecodeErrors': 0,
}
(ROOT / 'render/media-validation.json').write_text(json.dumps(report, indent=2) + '\n')

share_readme = '''# Zana — a simulated walkthrough

Play Zana-product-demo.mp4, or open watch.html for chapter navigation.

For the interactive version, open demo/index.html in a desktop browser. Press Play and turn Sound on to hear the narration. The Try the plugin button lets you use the Focus Board's checkboxes and add-task control. Everything runs offline; no account or installation is required. Unzip this package before opening the HTML files.

This is a 2:28 scripted replica with fictional projects, agents, tickets, outputs, and plugin installation. It demonstrates creating a project, launching and monitoring Modern threads and CLI Agents in the terminal TUI, viewing GUS work, and making a custom plugin. The simulated test results shown on screen belong to the story. Interactive plugin changes stay in the current demo tab.

The video is 1920 × 1080 at 24 fps, with locally generated Kokoro AI narration and captions in the picture. Captions and a transcript are also included as separate files. All cursor motion is drawn inside the replica; the demo does not control your desktop.
'''
package = ROOT / 'Zana-product-demo-share.zip'
with tempfile.TemporaryDirectory(prefix='.share-', dir=ROOT) as staging:
    staged_package = Path(staging) / package.name
    with zipfile.ZipFile(staged_package, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        archive.writestr('Zana-demo/README.md', share_readme)
        for name in ['Zana-product-demo.mp4', 'thumbnail.jpg', 'captions.srt', 'captions.vtt', 'narration.md', 'voice-preview.m4a', 'CREDITS.md']:
            archive.write(ROOT / name, 'Zana-demo/' + name)
        archive.writestr('Zana-demo/watch.html', (ROOT / 'watch.html').read_text().replace('href="index.html"', 'href="demo/index.html"'))
        for name in ['index.html', 'style.css', 'product.css', 'story-timeline.js', 'timeline.js', 'app.js', 'captions.js', 'assets/zana.png', 'audio/narration.m4a']:
            archive.write(ROOT / name, 'Zana-demo/demo/' + name)
    with zipfile.ZipFile(staged_package) as archive:
        assert archive.testzip() is None
        assert len(archive.namelist()) == 18
    staged_package.replace(package)
print(json.dumps({**report, 'shareBundleBytes': package.stat().st_size}, indent=2))
