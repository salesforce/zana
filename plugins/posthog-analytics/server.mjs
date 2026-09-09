/**
 * Event-only PostHog analytics. ON by default when `ZCC_POSTHOG_API_KEY` is
 * set (local `.env` or the baked release secret). Point Settings at your own
 * project or turn the master switch off to send nothing.
 *
 * Three kinds of signal, each behind its own toggle:
 *  1. Agent/thread lifecycle events (created/active/idle/failed/archived/deleted),
 *     now also carrying structural fields — providerId/model/reasoningLevel/
 *     executionState/hadAttachments — never prompt/response content or paths.
 *  2. Coarse UI click events — ONLY a developer-authored `data-testid` and the
 *     element role. NEVER the button text, aria-label, input values, or any
 *     other user-generated content (labels routinely embed project names and
 *     thread titles, so they are deliberately never read).
 *  3. Optional page/section navigation + dwell time — ONLY a fixed nav-name
 *     enum for `from`/`to` and a bounded duration in ms. NEVER a path,
 *     project id, thread id, or other dynamic route segment.
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

/** Fixed nav-name enum re-validated server-side (Rule 1: never trust the
 *  renderer) — mirrors decode-route.ts's DecodedRoute.nav literals plus the
 *  "plugin" bucket app.js uses for any nav id outside this fixed set. */
const KNOWN_NAV_VALUES = new Set([
  'home',
  'inbox',
  'agents',
  'followups',
  'suggestions',
  'scheduler',
  'goals',
  'settings',
  'extensions',
  'projects',
  'plugin'
]);

const MAX_PAGE_VIEW_DURATION_MS = 24 * 60 * 60 * 1000; // 24h sanity cap

const DISTINCT_ID_KEY = 'distinctId';
const DEFAULT_HOST = 'https://us.posthog.com';
const CAPTURE_TIMEOUT_MS = 5000;

function envApiKey() {
  return typeof process !== 'undefined' ? String(process.env.ZCC_POSTHOG_API_KEY ?? '').trim() : '';
}

/** Whitelist of scalar, content-free UI-click fields the renderer may report.
 *  Anything else on the RPC payload is dropped before it reaches PostHog. */
const UI_CLICK_KEYS = ['testid', 'role'];

export default function plugin(zcc) {
  const settings = zcc.settings.define({
    enabled: {
      type: 'boolean',
      label: 'Send anonymous usage events to PostHog',
      description:
        'Master switch, ON by default — sends event-only lifecycle data when ZCC_POSTHOG_API_KEY (or the key below) is set. Turn off to send nothing, or replace the API key below to point at your own project.',
      default: true
    },
    trackUiClicks: {
      type: 'boolean',
      label: 'Also track UI clicks (button ids only)',
      description:
        'Sends a zcc_ui_click event carrying only a developer-authored data-testid and the element role — never button text, labels, or input values.',
      default: false
    },
    trackPageViews: {
      type: 'boolean',
      label: 'Also track page navigation & time spent',
      description:
        'Sends a zcc_page_view event on each section change carrying only a fixed nav-name enum (from/to) and a duration in ms — never a path, project id, or thread id.',
      default: false
    },
    apiKey: {
      type: 'string',
      label: 'PostHog Project API Key',
      description:
        'Defaults to ZCC_POSTHOG_API_KEY from the environment (or the official-build bake). Replace with your own PostHog project key to send events there instead — or clear it and turn the toggle above off to send nothing.',
      secret: true,
      default: envApiKey()
    },
    host: {
      type: 'string',
      label: 'PostHog Host',
      description: 'Defaults to PostHog Cloud (US). Point this at your self-hosted instance if you run one.',
      default: DEFAULT_HOST
    }
  });

  // One in-flight init so concurrent first-use events share a single UUID.
  let distinctIdPromise = null;

  async function distinctId() {
    if (!distinctIdPromise) {
      distinctIdPromise = (async () => {
        let id = await zcc.storage.kv.get(DISTINCT_ID_KEY);
        if (!id) {
          id = crypto.randomUUID();
          await zcc.storage.kv.set(DISTINCT_ID_KEY, id);
        }
        return id;
      })();
    }
    try {
      return await distinctIdPromise;
    } catch (err) {
      distinctIdPromise = null;
      throw err;
    }
  }

  /** POST one event to PostHog. Best-effort: never throws out to the caller. */
  async function sendEvent(values, eventName, properties) {
    const host = String(values.host || DEFAULT_HOST).replace(/\/+$/, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CAPTURE_TIMEOUT_MS);
    try {
      const res = await fetch(`${host}/capture/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          api_key: values.apiKey,
          event: eventName,
          distinct_id: await distinctId(),
          properties
        })
      });
      if (!res.ok) {
        zcc.log.warn(`posthog capture failed: HTTP ${res.status}`);
      }
    } catch (err) {
      zcc.log.warn(`posthog capture failed: ${err}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function captureThreadEvent(name, event) {
    const values = await settings.get();
    if (!values.enabled || !values.apiKey) return;
    await sendEvent(values, `zcc_${name.replace('.', '_')}`, {
      projectId: event.projectId ?? null,
      // Structural/enum/boolean-only fields — never prompt/response content,
      // paths, or titles. All optional; a missing value is sent as null so
      // the PostHog schema stays stable across event names.
      providerId: typeof event.providerId === 'string' ? event.providerId : null,
      model: typeof event.model === 'string' ? event.model : null,
      reasoningLevel: typeof event.reasoningLevel === 'string' ? event.reasoningLevel : null,
      executionState: typeof event.executionState === 'string' ? event.executionState : null,
      hadAttachments: typeof event.hadAttachments === 'boolean' ? event.hadAttachments : null
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

  /**
   * Called by the renderer content script (see app.js) on each section
   * transition. Re-validated here (Rule 1: never trust the renderer) — `from`
   * and `to` must be one of {@link KNOWN_NAV_VALUES} (anything else, including
   * a raw plugin nav id, is dropped rather than forwarded) and `durationMs`
   * must be a finite, non-negative number under {@link MAX_PAGE_VIEW_DURATION_MS}.
   * Gated on BOTH the master switch and this feature's own toggle
   * (`trackPageViews`, off by default, independent of `trackUiClicks`).
   */
  zcc.rpc.method('trackPageView', async (input) => {
    const values = await settings.get();
    if (!values.enabled || !values.trackPageViews || !values.apiKey) return { ok: false };

    const rawFrom = input && input.from;
    const rawTo = input && input.to;
    const from = typeof rawFrom === 'string' && KNOWN_NAV_VALUES.has(rawFrom) ? rawFrom : null;
    const to = typeof rawTo === 'string' && KNOWN_NAV_VALUES.has(rawTo) ? rawTo : null;
    if (!to) return { ok: false };

    const rawDuration = input && input.durationMs;
    if (
      typeof rawDuration !== 'number' ||
      !Number.isFinite(rawDuration) ||
      rawDuration < 0 ||
      rawDuration > MAX_PAGE_VIEW_DURATION_MS
    ) {
      return { ok: false };
    }

    await sendEvent(values, 'zcc_page_view', { from, to, durationMs: rawDuration }).catch((err) =>
      zcc.log.warn(`posthog page view failed: ${err}`)
    );
    return { ok: true };
  });
}
