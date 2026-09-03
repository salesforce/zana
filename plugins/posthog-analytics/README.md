# PostHog Analytics

Opt-in usage analytics for your own install of Zana, sent to a PostHog
project **you** configure. **Off by default.**

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

## Enabling it

1. Install the plugin (`zcc plugin install ./plugins/posthog-analytics` from
   a checkout, or via the Plugins hub once published).
2. Open its Configure page in the Plugins hub.
3. Set **PostHog Project API Key** to your own project's key. This is the
   public, write-only key that starts with `phc_` — find it in PostHog under
   **Project Settings → Project API Key**. (It is *not* your numeric project
   id, and *not* a personal API key.)
4. Optionally change **PostHog Host** if you run a self-hosted PostHog
   (defaults to `https://us.posthog.com`).
5. Turn on **Send anonymous usage events to PostHog**.

Nothing is sent until both the toggle is on AND an API key is set. Turning
the toggle off stops all outbound requests immediately.

## Why no click/prompt tracking

This plugin deliberately does not capture UI clicks or prompt/response
content. The app's core has no generic click-instrumentation hook to piggy
back on (adding one would mean hand-instrumenting core UI code, which this
project's own conventions reserve for genuine product needs, not analytics),
and sending prompt/response text to a third-party service risks leaking
proprietary code or secrets. If you need deeper usage insight, see
**Settings → Usage** in the app itself, which computes a purely local,
content-free usage summary and never leaves your device.
