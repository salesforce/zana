/**
 * Renderer content script for the PostHog Analytics plugin.
 *
 * Attaches a single capture-phase click listener to the document and, for each
 * click on an actionable element, reports ONLY two content-free fields to the
 * plugin server over RPC:
 *   - testid: the nearest `data-testid` (developer-authored, stable, no content)
 *   - role:   the element role or tag (button / a / tab / ...)
 *
 * It deliberately never reads button text, aria-label, or input values — those
 * routinely embed project names and thread titles. The server re-validates and
 * only forwards these when the user has enabled UI-click tracking. If the click
 * has no `data-testid` and is not an actionable element, nothing is sent.
 */

const ACTIONABLE = new Set(['button', 'a', 'summary']);
const ACTIONABLE_ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'switch', 'checkbox', 'option']);

/**
 * The fixed, content-free set of top-level nav names `decode-route.ts`'s
 * `DecodedRoute.nav` can take from a static path segment (never a dynamic
 * one, like a project/thread/plugin id). Mirrors decodeRoutePath's literals —
 * update alongside that file if a new top-level destination is added.
 */
const KNOWN_NAV_NAMES = new Set([
  'home',
  'inbox',
  'agents',
  'followups',
  'suggestions',
  'scheduler',
  'goals',
  'settings',
  'extensions',
  'projects'
]);

/**
 * Best-effort, minimal re-derivation of `DecodedRoute.nav` from the URL,
 * without importing app internals into this content script. Only the coarse
 * nav segment is derived — never project/thread ids or other path params.
 * Anything not in {@link KNOWN_NAV_NAMES} (including a plugin panel's own
 * nav id) is bucketed as `"plugin"` rather than forwarded verbatim, so an
 * arbitrary plugin id is never sent to PostHog as if it were a fixed nav name.
 */
function currentNav() {
  const path = globalThis.location?.pathname || '/';
  const segments = path.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) return 'home';
  const first = segments[0];
  if (KNOWN_NAV_NAMES.has(first)) return first;
  if (first === 'threads' || first === 'new') return 'agents';
  return 'plugin';
}

/** Walk up from the clicked node to the nearest actionable element / testid. */
export function resolveTarget(start) {
  let el = start;
  let testid = null;
  let role = null;
  for (let depth = 0; el && el.nodeType === 1 && depth < 12; depth += 1, el = el.parentElement) {
    if (!testid && typeof el.getAttribute === 'function') {
      const t = el.getAttribute('data-testid');
      if (t) testid = t;
    }
    const tag = (el.tagName || '').toLowerCase();
    const r = typeof el.getAttribute === 'function' ? el.getAttribute('role') : null;
    if (!role) {
      if (r && ACTIONABLE_ROLES.has(r)) role = r;
      else if (ACTIONABLE.has(tag)) role = tag;
      else if (tag === 'input') {
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (type === 'button' || type === 'submit' || type === 'checkbox' || type === 'radio') role = `input:${type}`;
      }
    }
    // Once we have both a testid and a role we can stop early.
    if (testid && role) break;
  }
  return { testid, role };
}

export default {
  __zccPluginApp: true,
  setup(app) {
    app.contentScripts.register({
      id: 'ui-click-tracker',
      mount(ctx) {
        const host = globalThis.__ZCC_PLUGIN_HOST__;
        const doc = globalThis.document;
        if (!host || !doc) return;

        const onClick = (event) => {
          const { testid, role } = resolveTarget(event.target);
          if (!testid && !role) return; // not an actionable / identifiable click
          const payload = {};
          if (testid) payload.testid = testid;
          if (role) payload.role = role;
          // Fire-and-forget; the server decides whether tracking is enabled.
          try {
            host.callRpc(ctx.pluginId, 'trackUiClick', payload)?.catch?.(() => {});
          } catch {
            /* never let analytics break a real click */
          }
        };

        doc.addEventListener('click', onClick, { capture: true });
        const dispose = () => doc.removeEventListener('click', onClick, { capture: true });
        ctx.signal?.addEventListener?.('abort', dispose);
        return dispose;
      }
    });

    /**
     * Optional page/section navigation + dwell-time tracking (its own
     * settings toggle, off by default — see server.mjs). Monkey-patches
     * `history.pushState`/`replaceState` and listens for `popstate` so a
     * React Router transition is observed the same way regardless of how it
     * navigated. Reports only the coarse {@link currentNav} nav name for
     * `from`/`to` and a duration in ms — never a path, project id, or thread
     * id fragment.
     */
    app.contentScripts.register({
      id: 'page-view-tracker',
      mount(ctx) {
        const host = globalThis.__ZCC_PLUGIN_HOST__;
        const win = globalThis;
        if (!host || !win?.history) return;

        let previousNav = currentNav();
        let enteredAt = Date.now();

        const reportTransition = () => {
          const nextNav = currentNav();
          if (nextNav === previousNav) return; // same section, no transition
          const now = Date.now();
          const payload = {
            from: previousNav,
            to: nextNav,
            durationMs: now - enteredAt
          };
          previousNav = nextNav;
          enteredAt = now;
          try {
            host.callRpc(ctx.pluginId, 'trackPageView', payload)?.catch?.(() => {});
          } catch {
            /* never let analytics break navigation */
          }
        };

        const originalPushState = win.history.pushState;
        const originalReplaceState = win.history.replaceState;
        win.history.pushState = function patchedPushState(...args) {
          const result = originalPushState.apply(this, args);
          reportTransition();
          return result;
        };
        win.history.replaceState = function patchedReplaceState(...args) {
          const result = originalReplaceState.apply(this, args);
          reportTransition();
          return result;
        };
        win.addEventListener('popstate', reportTransition);

        const dispose = () => {
          win.history.pushState = originalPushState;
          win.history.replaceState = originalReplaceState;
          win.removeEventListener('popstate', reportTransition);
        };
        ctx.signal?.addEventListener?.('abort', dispose);
        return dispose;
      }
    });
  }
};
