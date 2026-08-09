import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ExtensionEntry } from '@shared/types';
import { ConsentCard } from '../ExtensionsHub';

/**
 * The inline ConsentCard is the durable fallback to the transient global
 * consent overlay — the fix for the "dismissed the overlay → no way to approve"
 * dead-end. These assertions pin its state-driven title + primary-button copy
 * (new vs token-widen vs scope-only widen). The approve wiring to
 * `grantConsent(id)` is exercised via the shared body + the overlay's own path;
 * these are render-only per house style.
 */
function entry(needsConsent: ExtensionEntry['needsConsent'], over: Partial<ExtensionEntry> = {}): ExtensionEntry {
  return {
    id: 'acme.widget-a1b2',
    needsConsent,
    ...over,
    manifest: {
      id: 'acme.widget-a1b2',
      title: 'Widget',
      icon: 'Box',
      engines: { zccApi: '^1' },
      entry: { renderer: 'r.js' },
      permissions: ['storage', 'net'],
      ...(over.manifest as object)
    } as unknown as ExtensionEntry['manifest']
  } as unknown as ExtensionEntry;
}

describe('ConsentCard', () => {
  it('prompts to activate a brand-new extension with an "Allow" button', () => {
    const html = renderToStaticMarkup(<ConsentCard entry={entry('new')} />);
    expect(html).toContain('Approve');
    expect(html).toContain('to activate it');
    expect(html).toContain('>Allow<');
  });

  it('labels the button "Allow new permissions" on a token widening', () => {
    const html = renderToStaticMarkup(
      <ConsentCard entry={entry('widened', { consentedPermissions: ['storage'] })} />
    );
    expect(html).toContain('wants new permissions');
    expect(html).toContain('Allow new permissions');
  });

  it('titles a scope-only widening "wants broader access"', () => {
    const html = renderToStaticMarkup(
      <ConsentCard
        entry={entry('widened', {
          consentedPermissions: ['storage', 'net'],
          manifest: {
            id: 'acme.widget-a1b2',
            title: 'Widget',
            icon: 'Box',
            engines: { zccApi: '^1' },
            entry: { renderer: 'r.js' },
            permissions: ['storage', 'net'],
            permissionScopes: { egressAllowlist: ['example.com'] }
          } as unknown as ExtensionEntry['manifest']
        })}
      />
    );
    expect(html).toContain('wants broader access');
    expect(html).toContain('Allow new permissions');
  });
});
