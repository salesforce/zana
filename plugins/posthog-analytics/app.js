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

/** Walk up from the clicked node to the nearest actionable element / testid. */
function resolveTarget(start) {
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
  }
};
