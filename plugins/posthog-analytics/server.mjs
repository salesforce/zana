/**
 * Opt-in, event-only PostHog analytics. OFF by default. Only sends the event
 * name and a project id — NEVER prompt/response text, titles, or file paths.
 * See README.md for the exact event list and payload shape.
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
const CAPTURE_TIMEOUT_MS = 5000;

export default function plugin(zcc) {
  const settings = zcc.settings.define({
    enabled: {
      type: 'boolean',
      label: 'Send anonymous usage events to PostHog',
      description:
        'Off by default. Only event names and a project id are sent for agent lifecycle events (created/started/idle/failed/archived/deleted) — never prompt or response text.',
      default: false
    },
    apiKey: {
      type: 'string',
      label: 'PostHog Project API Key',
      description: 'Your own PostHog project key. Nothing is sent until this is set and the toggle above is on.',
      secret: true
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

  async function capture(name, event) {
    const values = await settings.get();
    if (!values.enabled || !values.apiKey) return;
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
          event: `zcc_${name.replace('.', '_')}`,
          distinct_id: await distinctId(),
          properties: { projectId: event.projectId ?? null },
          timestamp: new Date().toISOString()
        })
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  for (const name of EVENT_NAMES) {
    zcc.events.on(name, (event) =>
      capture(name, event).catch((err) => zcc.log.warn(`posthog capture failed: ${err}`))
    );
  }
}
