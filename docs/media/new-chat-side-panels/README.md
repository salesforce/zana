# New chat side panels

A silent recording from the isolated production Electron app. It shows opening a
browser and project file before launching a Modern chat, preserving the native
browser document and panel width, then carrying a live shell into a CLI Agent.
Agent responses use deterministic test providers; the UI, browser and PTY are real.

Record and verify:

```sh
ZCC_NEW_CHAT_RECORDING=artifacts/new-chat-panels/frames-verified pnpm test:e2e -- e2e/new-chat-side-panels.spec.ts --workers=1
python3 docs/media/new-chat-side-panels/render.py artifacts/new-chat-panels/frames-verified artifacts/new-chat-panels/recording.mp4
python3 docs/media/zana-intro/prepend.py artifacts/new-chat-panels/recording.mp4 artifacts/new-chat-panels/new-chat-side-panels.mp4 --title "Your workspace, ready before the chat" --theme light --poster artifacts/new-chat-panels/poster.jpg
```

The recorder composites native child views into renderer frames and adds captions.
It does not capture the user's desktop or use their configuration. The recording
run also checks the CLI inspector. To invoke required live commands against a
separate isolated app, set `ZCC_NEW_CHAT_LIVE_CHECKS` to a comma-separated list
of `live:mode-reasoning,live:memory,live:browser`. Read those logs for failures
and preflight skips.
