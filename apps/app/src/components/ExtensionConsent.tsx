/**
 * P3-D install-time consent prompt. A self-contained global overlay (mounted in
 * App alongside the Toaster) that surfaces a plain-language permission screen
 * for any discovered disk extension that is NEW (never approved) or WIDENED (an
 * update declared more permissions than the user approved). Approve → persist
 * consent + the host re-discovers (spawns/mounts it); Dismiss → it stays
 * inactive and the prompt reappears next launch / next change.
 *
 * Kept apart from the unrelated concurrent renderer WIP: it owns its own state
 * (subscribes to `cc.extensions`) and touches no shared store.
 */

import { useEffect, useState } from 'react';
import type { ExtensionEntry } from '@zana-ai/zcc-domain/product';
import { ConsentBody, consentDelta } from './ConsentBody.js';

// The consent body + its pure helpers now live in ConsentBody.tsx so the hub's
// inline ConsentCard can share them (copy/wildcard-loudness can't drift). These
// re-exports preserve the historical import surface — ExtensionsHub imports
// PERMISSION_LABELS from here, and the consent-delta / scope-lines guard tests
// import consentDelta / scopeLines from here.
export { PERMISSION_LABELS, consentDelta, scopeLines, agentCapabilityLines, pluginCapabilityLines } from './ConsentBody.js';
export type { ConsentDelta } from './ConsentBody.js';

/**
 * Per-session dismissal key. Combines the id with the consent state so a
 * `'new'` dismissal and a later `'widened'` escalation for the same extension
 * are tracked independently — declining one never silently swallows the other.
 */
function dismissKey(e: ExtensionEntry): string {
  return `${e.id}:${e.needsConsent}`;
}

export function ExtensionConsent() {
  const [pending, setPending] = useState<ExtensionEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  // Per-session dismissals so a declined prompt doesn't nag within one launch.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const apply = (entries: ExtensionEntry[]) => {
      if (cancelled) return;
      setPending(entries.filter((e) => e.needsConsent !== null));
    };
    void window.cc.extensions.list().then(apply);
    const off = window.cc.extensions.onChanged(apply);
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  // Dismissal is keyed by id + consent STATE, so declining a `'new'` prompt
  // doesn't also suppress a later `'widened'` escalation for the same extension
  // (e.g. adding a permission from the hub after clicking "Not now"). A new state
  // for the same id re-surfaces the prompt.
  const visible = pending.filter((e) => !dismissed.has(dismissKey(e)));
  if (visible.length === 0) return null;

  // One prompt at a time — least intrusive; the rest queue behind it.
  const entry = visible[0];
  const title = entry.manifest?.title ?? entry.id;
  const widened = entry.needsConsent === 'widened';
  // On a `'widened'` re-prompt, the title/subtitle copy differs when only a
  // SCOPE broadened (no new token). `scopeOnlyWiden` drives that; the perms /
  // scope / provenance body itself is rendered by the shared <ConsentBody>.
  const { scopeOnlyWiden } = consentDelta(entry);

  const approve = async () => {
    setBusy(entry.id);
    try {
      await window.cc.extensions.grantConsent(entry.id);
      // The onChanged push refreshes `pending`; clear any stale dismissal.
      setDismissed((prev) => {
        const next = new Set(prev);
        next.delete(dismissKey(entry));
        return next;
      });
    } finally {
      setBusy(null);
    }
  };

  const dismiss = () => {
    setDismissed((prev) => new Set(prev).add(dismissKey(entry)));
  };

  return (
    <div className="consent-overlay" role="dialog" aria-modal="true" aria-label="Extension permissions">
      <div className="consent-card">
        <h2 className="consent-title">
          {widened
            ? scopeOnlyWiden
              ? `${title} wants broader access`
              : `${title} wants new permissions`
            : `Allow “${title}”?`}
        </h2>
        <p className="consent-sub">
          {widened
            ? scopeOnlyWiden
              ? 'An update broadened what this extension can access. Review the changes below and allow to keep using it.'
              : 'An update added permissions you haven’t approved. Review and allow to keep using it.'
            : 'This extension was installed from disk. Review what it can do before it runs.'}
        </p>
        <ConsentBody entry={entry} />
        <div className="consent-actions">
          <button className="btn" onClick={dismiss} disabled={busy === entry.id}>
            Not now
          </button>
          <button className="btn primary" onClick={approve} disabled={busy === entry.id}>
            {busy === entry.id ? 'Allowing…' : widened ? 'Allow new permissions' : 'Allow'}
          </button>
        </div>
      </div>
    </div>
  );
}
