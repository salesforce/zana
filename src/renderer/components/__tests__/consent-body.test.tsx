import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ExtensionEntry } from '@shared/types';
import { ConsentBody } from '../ConsentBody';

/**
 * `<ConsentBody>` is the presentational body shared by BOTH the transient
 * global consent overlay and the hub's persistent inline ConsentCard. These
 * assertions pin the load-bearing rendering — LOUD wildcards, the new-vs-
 * already-approved delta, scope-only widening, remote-origin provenance, and
 * the no-permissions case — so the two surfaces can never drift. Pure static
 * render, no jsdom (house style).
 */
function entry(over: Partial<ExtensionEntry>): ExtensionEntry {
  return {
    id: 'x',
    manifest: {
      id: 'x',
      title: 'X',
      icon: 'Box',
      engines: { zccApi: '^1' },
      entry: { renderer: 'r.js' }
    },
    ...over
  } as unknown as ExtensionEntry;
}

function withManifest(
  needsConsent: ExtensionEntry['needsConsent'],
  manifestOver: Record<string, unknown>,
  over: Partial<ExtensionEntry> = {}
): ExtensionEntry {
  return entry({
    needsConsent,
    ...over,
    manifest: {
      id: 'x',
      title: 'X',
      icon: 'Box',
      engines: { zccApi: '^1' },
      entry: { renderer: 'r.js' },
      ...manifestOver
    } as unknown as ExtensionEntry['manifest']
  });
}

describe('ConsentBody', () => {
  it('renders a loud remote-origin warning for a git-installed extension', () => {
    const html = renderToStaticMarkup(
      <ConsentBody
        entry={withManifest('new', { permissions: ['storage'] }, {
          source: 'git',
          remoteOrigin: { url: 'https://github.com/acme/tool.git', ref: 'v1.2.3' }
        })}
      />
    );
    expect(html).toContain('code not reviewed by');
    expect(html).toContain('https://github.com/acme/tool.git');
    expect(html).toContain('v1.2.3');
  });

  it('renders a wildcard egress scope LOUD, never a bare *', () => {
    const html = renderToStaticMarkup(
      <ConsentBody
        entry={withManifest('new', {
          permissions: ['net'],
          permissionScopes: { egressAllowlist: ['*'] }
        })}
      />
    );
    expect(html).toContain('⚠ ANY host (unrestricted)');
    expect(html).not.toContain('Hosts it may reach: *');
  });

  it('marks only the delta NEW on a token widening, listing approved ones muted', () => {
    const html = renderToStaticMarkup(
      <ConsentBody
        entry={withManifest('widened', { permissions: ['storage', 'net'] }, {
          consentedPermissions: ['storage']
        })}
      />
    );
    expect(html).toContain('New permission');
    expect(html).toContain('NEW');
    expect(html).toContain('Already approved');
    // The NEW badge attaches to the freshly-declared token's label, not the
    // already-approved one.
    expect(html).toContain('Connect to specific web hosts');
  });

  it('suppresses the "New permission" heading on a scope-only widening', () => {
    const html = renderToStaticMarkup(
      <ConsentBody
        entry={withManifest('widened', {
          permissions: ['net'],
          permissionScopes: { egressAllowlist: ['example.com', 'api.example.com'] }
        }, {
          consentedPermissions: ['net']
        })}
      />
    );
    expect(html).not.toContain('New permission');
    // The scope line carries the change instead.
    expect(html).toContain('api.example.com');
  });

  it('says it requests no special permissions when the manifest declares none', () => {
    const html = renderToStaticMarkup(
      <ConsentBody entry={withManifest('new', { permissions: [] })} />
    );
    expect(html).toContain('It requests no special permissions.');
  });
});
