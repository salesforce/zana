# PostHog Analytics

Usage analytics for Zana installs, event-only (never prompt/response content).

> **Disclaimer — auto-installed and on by default.** This plugin is **builtin**
> (`autoInstall: true`) — it's installed and enabled for every user with no
> setup step, and official builds bake in `ZCC_POSTHOG_API_KEY` so it starts
> sending events right away. (A local `pnpm dev` checkout without that env var
> set has the master switch on but nothing to send to, until you set one.) To
> opt out entirely, turn off **Send anonymous usage events to PostHog** — or
> uninstall the plugin, which is not silently reinstalled once you do. To send
> events to a different PostHog project, replace **PostHog Project API Key**
> with your own project's write-only `phc_` key.

## What is sent

Only agent/thread lifecycle events — never prompt or response content, file
paths, titles, or any other user-generated text:

| Event | Fires when |
| --- | --- |
| `zcc_thread_created` | An agent thread is created |
| `zcc_thread_active` | An agent starts working |
| `zcc_thread_idle` | An agent goes idle |
| `zcc_thread_failed` | An agent thread fails |
| `zcc_thread_archived` | An agent thread is archived |
| `zcc_thread_deleted` | An agent thread is deleted |

Each event's payload is exactly:

```json
{
  "event": "zcc_thread_created",
  "distinct_id": "<random UUID, generated once per install, stored locally>",
  "properties": { "projectId": "<project id or null>" }
}
```

`distinct_id` is a random UUID generated on first use and stored in this
plugin's local KV storage — it identifies an *installation*, not a person,
and is never derived from any account/email.

### Optional: coarse UI-click events

If you additionally turn on **Also track UI clicks (button ids only)**, the
plugin emits a `zcc_ui_click` event on each click of an actionable element,
carrying only:

```json
{ "event": "zcc_ui_click", "distinct_id": "…", "properties": { "testid": "agent-delete-quick", "role": "button" } }
```

- `testid` is the developer-authored `data-testid` on the element (stable,
  content-free), resolved by walking up from the clicked node.
- `role` is the element role or tag (`button` / `link` / `tab` / …).

It **never** reads button text, `aria-label`, or input values — those routinely
embed project names and thread titles, so they are deliberately never captured.
The renderer content script only reports these two fields, and the server
re-validates them (dropping anything else, non-strings, or over-long values)
before sending. A click with no `data-testid` and no actionable role sends
nothing. This toggle is independent and also off by default.

## Enabling it / opting out / pointing at your own project

1. Nothing to do — this plugin is **builtin and auto-installed** for every
   user, and ships **enabled out of the box**. Official builds bake
   `ZCC_POSTHOG_API_KEY`; local `pnpm dev` reads it from `.env`.
2. Open its Configure page in the Plugins hub to change any of this.
3. To opt out entirely: turn off **Send anonymous usage events to PostHog**.
   This stops all outbound requests immediately.
4. To send events to your *own* PostHog project:
   replace **PostHog Project API Key** with your own project's key. This is
   the public, write-only key that starts with `phc_` — find it in PostHog
   under **Project Settings → Project API Key**. (It is *not* your numeric
   project id, and *not* a personal API key.)
5. Optionally change **PostHog Host** if you run a self-hosted PostHog
   (defaults to `https://us.posthog.com`).
6. Optionally turn on **Also track UI clicks (button ids only)** for
   content-free click events (see above) — this toggle is independent and
   off by default even when the master switch is on.

Nothing is sent unless the master toggle is on AND an API key is set. The
key is empty until `ZCC_POSTHOG_API_KEY` (or the Settings field) provides one.

## Why no prompt/content tracking

This plugin deliberately never captures prompt/response content, button text,
labels, or input values — only lifecycle events and (optionally) content-free
click ids. Sending prompt/response text to a third-party service risks leaking
proprietary code or secrets, so it is out of scope by design. UI-click tracking
is intentionally limited to developer-authored `data-testid`s + element roles
rather than autocapture, to avoid ever reading user-generated text. If you need
richer local insight, see **Settings → Usage** in the app itself, which computes
a purely local, content-free usage summary that never leaves your device.

## How it works

The plugin lives in this directory. The default API key is **not** hardcoded:
`ZCC_POSTHOG_API_KEY` is read at runtime (and copied onto `process.env` from
the official-build bake so packaged apps see it). It consumes:

- `zcc.events.on('thread.*')` for lifecycle events (server side).
- A renderer **content script** (`app.js`, via `app.contentScripts.register`)
  for the optional click listener, which reports to the plugin server over
  `zcc.rpc` — so the API key stays server-side and the renderer never sees it.
