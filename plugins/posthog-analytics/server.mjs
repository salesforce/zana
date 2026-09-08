/**
 * Event-only PostHog analytics. ON by default, reporting into the maintainer's
 * shared community PostHog project — see README.md for how to point this at
 * your own project instead, or turn it off entirely.
 *
 * Two kinds of signal, each behind its own toggle:
 *  1. Agent/thread lifecycle events (created/active/idle/failed/archived/deleted).
 *  2. Coarse UI click events — ONLY a developer-authored `data-testid` and the
 *     element role. NEVER the button text, aria-label, input values, or any
 *     other user-generated content (labels routinely embed project names and
 *     thread titles, so they are deliberately never read).
 *
 * Nothing is ever sent about prompt/response content. See README.md.
 */

const EVENT_NAMES = [
  'thread.created',
  'thread.active',
  'thread.idle',
  'thread.failed',
  'thread.archived',
  'thread.deleted'
];

const DISTINCT_ID_KEY = 'distinctId';
const DEFAULT_HOST = 'https://us.posthog.com';
// Shared community project (591662) API key. This key is a PostHog *project*
// key — write-only by design, meant to be public (the same key PostHog's own
// client-side snippet embeds in page source). Set your own key in Settings to
// send events to a different PostHog project instead, or disable the master
// switch to send nothing.
const DEFAULT_API_KEY = 'phc_oekSLXZr7sh7rRAJbFHAaiLkRamaC5FVBmEBs2m4T2qP';
const CAPTURE_TIMEOUT_MS = 5000;

/** Whitelist of scalar, content-free UI-click fields the renderer may report.
 *  Anything else on the RPC payload is dropped before it reaches PostHog. */
const UI_CLICK_KEYS = ['testid', 'role'];

export default function plugin(zcc) {
  const settings = zcc.settings.define({
    enabled: {
      type: 'boolean',
      label: 'Send anonymous usage events to PostHog',
      description:
        'Master switch, ON by default — sends event-only lifecycle data (see README) to a shared community PostHog project. Turn off to send nothing, or replace the API key below to point at your own project instead.',
      default: true
    },
    trackUiClicks: {
      type: 'boolean',
      label: 'Also track UI clicks (button ids only)',
      description:
        'Sends a zcc_ui_click event carrying only a developer-authored data-testid and the element role — never button text, labels, or input values.',
      default: false
    },
    apiKey: {
      type: 'string',
      label: 'PostHog Project API Key',
      description:
        'Defaults to the shared community project key. Replace with your own PostHog project key to send events there instead — or clear it and turn the toggle above off to send nothing.',
      secret: true,
      default: DEFAULT_API_KEY
    },
    host: {
      type: 'string',
      label: 'PostHog Host',
      description: 'Defaults to PostHog Cloud (US). Point this at your self-hosted instance if you run one.',
      default: DEFAULT_HOST
    }
  });

  async function distinctId() {
    let id = await zcc.storage.kv.get(DISTINCT_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      await zcc.storage.kv.set(DISTINCT_ID_KEY, id);
    }
    return id;
  }

  /** POST one event to PostHog. Best-effort: never throws out to the caller. */
  async function sendEvent(values, eventName, properties) {
    const host = String(values.host || DEFAULT_HOST).replace(/\/+$/, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CAPTURE_TIMEOUT_MS);
    try {
      await fetch(`${host}/capture/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          api_key: values.apiKey,
          event: eventName,
          distinct_id: await distinctId(),
          properties,
          timestamp: new Date().toISOString()
        })
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function captureThreadEvent(name, event) {
    const values = await settings.get();
    if (!values.enabled || !values.apiKey) return;
    await sendEvent(values, `zcc_${name.replace('.', '_')}`, {
      projectId: event.projectId ?? null
    });
  }

  for (const name of EVENT_NAMES) {
    zcc.events.on(name, (event) =>
      captureThreadEvent(name, event).catch((err) => zcc.log.warn(`posthog capture failed: ${err}`))
    );
  }

  /**
   * Called by the renderer content script (see app.js) on each UI click. The
   * payload is re-validated here (Rule 1: never trust the renderer) — only the
   * content-free {@link UI_CLICK_KEYS} are forwarded, and only when BOTH the
   * master switch and the UI-click toggle are on.
   */
  zcc.rpc.method('trackUiClick', async (input) => {
    const values = await settings.get();
    if (!values.enabled || !values.trackUiClicks || !values.apiKey) return { ok: false };
    const properties = {};
    for (const key of UI_CLICK_KEYS) {
      const v = input && input[key];
      // Only short scalar strings survive — defends against a renderer sending
      // an unexpectedly large or non-string value into the analytics payload.
      if (typeof v === 'string' && v.length > 0 && v.length <= 120) properties[key] = v;
    }
    if (!properties.testid && !properties.role) return { ok: false };
    await sendEvent(values, 'zcc_ui_click', properties).catch((err) =>
      zcc.log.warn(`posthog ui click failed: ${err}`)
    );
    return { ok: true };
  });
}
