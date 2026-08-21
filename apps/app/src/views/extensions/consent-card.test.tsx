import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ExtensionEntry } from '@zana-ai/zcc-domain/product';
import { ConsentCard, InstallConfirmationCard } from '@/views/extensions/ExtensionsHub';

/**
 * ConsentCard is a deprecated shim over InstallConfirmationCard (plugins are
 * full-trust after install). These assertions pin the confirmation copy so a
 * later restore of grant UI cannot silently reuse this symbol.
 */
function entry(over: Partial<ExtensionEntry> = {}): ExtensionEntry {
  return {
    id: 'acme.widget-a1b2',
    path: '/tmp/acme.widget-a1b2',
    loaded: true,
    enabled: true,
    mainActive: true,
    consented: true,
    needsConsent: null,
    ...over,
    manifest: {
      id: 'acme.widget-a1b2',
      title: 'Widget',
      icon: 'Box',
      version: '1.2.3',
      engines: { zccApi: '^1' },
      entry: { renderer: 'r.js' },
      permissions: ['storage', 'net'],
      ...(over.manifest as object)
    } as unknown as ExtensionEntry['manifest']
  } as unknown as ExtensionEntry;
}

describe('InstallConfirmationCard', () => {
  it('names the plugin, version, and install origin', () => {
    const html = renderToStaticMarkup(<InstallConfirmationCard entry={entry()} />);
    expect(html).toContain('Installed');
    expect(html).toContain('Widget 1.2.3');
    expect(html).toContain('full trust');
    expect(html).toContain('/tmp/acme.widget-a1b2');
  });

  it('renders a git remote origin when present', () => {
    const html = renderToStaticMarkup(
      <InstallConfirmationCard
        entry={entry({ source: 'git', remoteOrigin: { url: 'https://git.example/acme', ref: 'main' } })}
      />
    );
    expect(html).toContain('https://git.example/acme#main');
  });
});

describe('ConsentCard (deprecated shim)', () => {
  it('forwards to the install confirmation card', () => {
    const html = renderToStaticMarkup(<ConsentCard entry={entry()} />);
    expect(html).toContain('Installed');
    expect(html).toContain('Widget 1.2.3');
  });
});
