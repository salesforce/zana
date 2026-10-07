import { PAGE_TITLES } from './pages.js';
import { readReleaseDefaults } from './credentials.mjs';

const SESSION_IDLE_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 5000;
const MAX_VIEWS = 32;
const MAX_IN_FLIGHT = 4;
const GOOGLE_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

/** A loopback collector is available only to isolated E2E, never as a UI setting. */
function endpoint() {
  if (process.env.ZCC_E2E !== '1' || !process.env.ZCC_GA4_TEST_ENDPOINT) return GOOGLE_ENDPOINT;
  const url = new URL(process.env.ZCC_GA4_TEST_ENDPOINT);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/mp/collect' || url.search || url.hash) {
    throw new Error('Invalid analytics test collector');
  }
  return url.href;
}

export default function plugin(zcc) {
  const releaseDefaults = readReleaseDefaults();
  const settings = zcc.settings.define({
    enabled: {
      type: 'boolean', label: 'Connect Google Analytics', default: true,
      description: 'Sends app opens and visible app activity when configured. Turn off to disconnect immediately. Uses a random installation id; never sends prompts, titles, file paths, or actual URLs.'
    },
    trackPageViews: {
      type: 'boolean', label: 'Track page views', default: true,
      description: 'Records fixed section names such as Agents, Inbox, and Settings. Turn off to measure app presence only.'
    },
    measurementId: {
      type: 'string', label: 'GA4 Measurement ID', default: process.env.ZCC_GA4_MEASUREMENT_ID?.trim() ?? releaseDefaults.measurementId ?? '',
      description: 'The G-… ID of a GA4 Web data stream. Use a separate stream for the app to compare it with PostHog.'
    },
    apiSecret: {
      type: 'string', label: 'Measurement Protocol API secret', secret: true,
      default: process.env.ZCC_GA4_API_SECRET?.trim() ?? releaseDefaults.apiSecret ?? '',
      description: 'Create in GA4 → Admin → Data streams → your Web stream → Measurement Protocol API secrets.'
    }
  });

  let disposed = false;
  let clientIdPromise;
  let session;
  const views = new Map();
  const controllers = new Set();
  const abortRequests = () => {
    for (const controller of controllers) controller.abort();
    views.clear();
    session = undefined;
  };
  settings.onChange((values) => { if (!values.enabled) abortRequests(); });
  zcc.onDispose(() => { disposed = true; abortRequests(); });

  async function clientId() {
    if (!clientIdPromise) {
      clientIdPromise = (async () => {
        const saved = await zcc.storage.kv.get('clientId');
        if (typeof saved === 'string' && /^[a-f0-9-]{36}$/i.test(saved)) return saved;
        const id = crypto.randomUUID();
        await zcc.storage.kv.set('clientId', id);
        return id;
      })();
    }
    try { return await clientIdPromise; }
    catch (error) { clientIdPromise = undefined; throw error; }
  }

  zcc.rpc.method('track', async (input) => {
    let controller;
    let timeout;
    try {
      const values = await settings.get();
      const measurementId = String(values.measurementId || '').trim();
      const apiSecret = String(values.apiSecret || '').trim();
      if (disposed || !values.enabled || !/^G-[A-Z0-9]+$/.test(measurementId) || !apiSecret
        || apiSecret.length > 256 || controllers.size >= MAX_IN_FLIGHT) return { ok: false };
      const { kind, page, viewId, engagementMs } = input || {};
      if (!['open', 'page', 'heartbeat'].includes(kind)
        || !Object.hasOwn(PAGE_TITLES, page)
        || typeof viewId !== 'string' || !/^[a-f0-9-]{36}$/i.test(viewId)
        || !Number.isInteger(engagementMs) || engagementMs < 0 || engagementMs > 60000) return { ok: false };
      if (kind === 'page' && !values.trackPageViews) return { ok: true, collected: false };

      // Reserve a slot before any asynchronous storage work. No unbounded queue.
      controller = new AbortController();
      controllers.add(controller);
      timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const id = await clientId();
      // Recheck after storage so an opt-out cannot race the first network request.
      const current = await settings.get();
      if (disposed || controller.signal.aborted || !current.enabled
        || current.measurementId !== values.measurementId || current.apiSecret !== values.apiSecret
        || current.trackPageViews !== values.trackPageViews) return { ok: false };

      const now = Date.now();
      for (const [key, view] of views) if (now - view.lastSeen >= SESSION_IDLE_MS) views.delete(key);
      const prior = views.get(viewId);
      if (kind === 'open' && prior) return { ok: true };
      if (kind !== 'open' && !prior) return { ok: false, needsOpen: true };
      if (kind === 'page' && (page === prior.page || now - prior.lastPage < 500)) return { ok: true, collected: false };
      if (kind === 'heartbeat' && prior.lastHeartbeat !== undefined && now - prior.lastHeartbeat < 55000) return { ok: false };
      if (!session || now - session.lastSeen >= SESSION_IDLE_MS) session = { id: now, lastSeen: now };
      session.lastSeen = now;
      const common = { session_id: session.id, engagement_time_msec: Math.max(1, engagementMs) };
      const events = [];
      if (kind === 'open') events.push({ name: 'app_open', params: common });
      if (kind === 'heartbeat') events.push({ name: 'user_engagement', params: common });
      if (values.trackPageViews && kind !== 'heartbeat') events.push({
        name: 'page_view', params: {
          ...common, engagement_time_msec: kind === 'open' ? 1 : common.engagement_time_msec,
          page_title: PAGE_TITLES[page],
          // Synthetic URL from an allowlist. Never document.location/title.
          page_location: `https://app.zana.ai/${page}`
        }
      });
      const url = new URL(endpoint());
      url.searchParams.set('measurement_id', measurementId);
      url.searchParams.set('api_secret', apiSecret);
      const response = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: id, consent: { ad_user_data: 'DENIED', ad_personalization: 'DENIED' }, events }),
        signal: controller.signal, redirect: 'error'
      });
      await response.body?.cancel();
      if (!response.ok) {
        zcc.log.warn(`Google Analytics collection failed: HTTP ${response.status}`);
        return { ok: false };
      }
      if (disposed || controller.signal.aborted) return { ok: false };
      if (!prior && views.size >= MAX_VIEWS) views.delete(views.keys().next().value);
      views.set(viewId, {
        page: kind === 'heartbeat' ? prior.page : page, lastSeen: now,
        lastPage: kind === 'heartbeat' ? prior.lastPage : now,
        lastHeartbeat: kind === 'heartbeat' ? now : prior?.lastHeartbeat
      });
      return { ok: true };
    } catch {
      // Fetch errors may contain the secret-bearing URL. Log no raw exception.
      zcc.log.warn('Google Analytics collection failed; check configuration or connectivity.');
      return { ok: false };
    } finally {
      clearTimeout(timeout);
      if (controller) controllers.delete(controller);
    }
  });
}
