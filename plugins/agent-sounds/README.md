# Sound Studio

An optional Zana plugin for agent notification sounds. Install it, open **Plugins → Sound Studio**, preview a pack, then enable notifications. It is not auto-installed. Keep the separate built-in Settings → Agents chimes off when using this plugin to avoid two players.

- Import your own WAV, MP3 or OGG files and map them to **Needs you** and **Idle**.
- Import an OpenPeon folder containing `openpeon.json`. The first `input.required` clip becomes Needs you; the first `task.complete` clip becomes Idle. Missing mappings stay silent. An idle event does not claim successful completion.
- Packs live in the plugin’s SQLite database (outside the small-value KV quota): up to 8 packs, 1 MB per clip, 8 seconds per playback. No game sounds are shipped, downloaded automatically, or required.
- Notifications start off. Needs you is selected by default; idle is opt-in. Volume starts at 35%.
- Idle must remain stable for 5 seconds. Idle alerts share a configurable 5–60 second spacing across agents. Requests for input interrupt audio and have their own 3-second cooldown.
- Startup, reload and settings changes do not replay old events. Hidden, scheduled and exited CLI sessions, archived/hidden threads, and uncertain/error statuses do not generate idle alerts.
- Works while the plugin page is closed. One Chromium lock elects the player across main windows. Scoped windows never take the lock. Uninstall/reload releases subscriptions, timers, and audio contexts.

## Install and customize

```sh
zcc plugin install /absolute/path/to/agent-sounds
zcc plugin dev /absolute/path/to/agent-sounds --once
```

Copy this directory to a separate project/repository to work independently. Choose a different package basename in `package.json` if installing your fork beside the original, for example `@your-team/my-agent-sounds` (plugin ID `my-agent-sounds`). Changing only the npm scope does not change the derived plugin ID. Only public SDK APIs are imported; the host supplies React. `zcc plugin build .` builds a standalone copy without this monorepo.

| File | Change here |
| --- | --- |
| `policy.ts` | Event selection, stability, priority, cooldowns |
| `player.ts` | Synthesized chimes and audio playback |
| `model.ts` | Preferences, pack format, CESP mappings |
| `app.tsx`, `styles.ts` | Plugin UI |
| `server.ts` | Validated, serialized persistence and quotas |

Sound packs are data, never code. To rewrite behavior, edit/fork the plugin source; do not add `eval` or executable pack hooks. Installed plugin source is full-trust server code, like other Zana plugins.

An independent plugin can use the same generic activity API and implement its own sounds and rules. It does not override Sound Studio automatically: turn off Sound Studio's notifications or disable it before enabling the replacement. The player lock is per plugin, so it prevents duplicates across windows, not between different sound plugins. Importing a pack is the simpler option when only the audio should change.

## Host contract

Background scripts use optional `PluginContentScriptContext.experimental_observeAgents` and `experimental_onSignal`. The generic activity snapshot contains only an ID, kind and working/idle/needs-you/unknown state. It reuses the existing renderer stores and starts no extra status polling. This checkout adds those APIs. Older apps show an update message; imports and manual previews still work. Automatic playback requires the updated host, the main shell and Chromium Web Locks. No daemon credentials or OS audio commands are used. OS Focus integration is not implemented; use the master switch for silence.

Run the focused Vitest tests in this directory, and the built Electron test `e2e/sound-studio-plugin.spec.ts` from the app repository. See `LIVE_TEST.md`.
