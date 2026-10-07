# Zana for Slack

`zana-slack.mp4` is the shareable 74-second video: 1920 × 1080, 24 fps,
H.264/yuv420p with AAC audio and fast-start playback.

The walkthrough follows `script.md`. Slack launches work with any harness
installed in Zana; the demo uses **Pi**:

1. In a channel linked to a Project, mention **@Zana** with the task. There is
   no form: Zana uses the channel's saved Project, harness (**Pi** here), and
   model, and replies in that message's thread with a **Working…** status.
2. Pi runs on the connected computer: an `sf_apex` test run and diagnosis.
3. Pi asks a clarification question in the thread (the `slack_bridge_ask` tool).
   **Answer questions** opens **Answer Zana**; the chosen option goes back to the
   same agent as a follow-up, and Pi edits the code and reruns the tests.
4. When the turn ends, Zana replaces the status message with the answer.
5. A plain reply in the thread continues the same conversation with the same
   Project, machine, harness, and model.
6. The private agent chat answers **Show my unread reports.** from the Zana inbox.
7. **Zana Home** shows the summary line, **+ New agent**, and Running and Recent
   conversation cards with Open conversation, Open result, Stop, and Mute updates.

Keep the computer awake and online, with Zana running.

This is an illustrated walkthrough, not a screen capture. The Slack workspace
(Acme), Project, channel, org (`my-dev-sandbox`), person, and messages are samples.
Slack copy is taken from the Slack bridge: the @mention launch, **Working…**,
the question delivery ("Zana needs a preference or clarification. Execution
permissions are reviewed in Zana." and **Answer questions**), the **Answer Zana**
modal, "Answer the questions here to continue.", the private-chat welcome and
prompt chips, and the Home summary, sections, and buttons. The status icons are
drawn stand-ins for Slack's emoji. The desktop thread in the intro uses Zana's
`Slack · <task>` title, with harness and model in the composer.

Slack handles questions, not execution permissions. A permission prompt still
waits in Zana; Slack only shows **Needs attention in Zana**. The video does not
show a permission prompt.

No Slack message was sent and no org was touched to make the video.

Voice: **Microsoft Ava Multilingual Neural**, `en-US-AvaMultilingualNeural`, at
`-5%`. All seven segments keep their natural speech pace with no time stretching. The assembled track is normalized to
-16 LUFS with a -1.5 dBTP target.

## Files

- `zana-slack.mp4`: finished video.
- `index.html`: local player with optional English captions.
- `zana-slack.en.srt` / `.vtt`: caption files.
- `script.md` / `narration.txt`: storyboard and narration.
- `voiceover.wav`: finished narration track.
- `poster.jpg` / `contact-sheet.jpg`: thumbnail and storyboard review.
- `preview-*.jpg`: full-size key frames.
- `audio-neural/`: cached speech and timing metadata.
- `render.py`: editable source, using the visual helper functions from
  `../mobile-connect/render.py`.

## Render

Requires Python, Pillow, edge-tts, ffmpeg, and ffprobe. Initial speech synthesis
needs internet access; edge-tts honors `HTTPS_PROXY`. Later renders reuse the
cached clips.

```sh
python3 render.py --stills
python3 render.py --audio-only
python3 render.py
```
