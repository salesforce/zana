'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fetchCatalog, type CatalogEntry } from '@/lib/registry';
import { SAMPLE_CATALOG } from '@/lib/sample-catalog';
import { site } from '@/lib/site';

type Status = 'loading' | 'live' | 'sample';

export function MarketplaceClient() {
  const [entries, setEntries] = useState<CatalogEntry[]>(SAMPLE_CATALOG);
  const [status, setStatus] = useState<Status>(site.registryUrl ? 'loading' : 'sample');
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    if (!site.registryUrl) return;
    fetchCatalog(site.registryUrl).then((rows) => {
      if (!alive) return;
      if (rows.length > 0) {
        setEntries(rows);
        setStatus('live');
      } else {
        setStatus('sample');
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = entries.filter((e) => {
    const hay = `${e.title} ${e.id} ${e.description ?? ''} ${e.author ?? ''}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  return (
    <section className="clean-marketplace-page">
      <div className="wrap">
        <div className="clean-page-hero clean-marketplace-hero">
          <span className="clean-page-kicker">Marketplace</span>
          <h1>
            Extensions
            <span className={`feed-pill ${status === 'live' ? 'live' : ''}`}>
              <span className="fdot" />
              {status === 'loading' ? 'connecting…' : status === 'live' ? 'live feed' : 'sample catalog'}
            </span>
          </h1>
          <p>
            Add new features to the app — panels, tabs, commands, personas, and teams. Install from the same
            catalog the desktop app reads.
            {status === 'sample' && ' Connect a live registry feed to list published extensions.'}
          </p>
        </div>

        <div className="clean-marketplace-guide" data-reveal>
          <div>
            <span className="clean-page-kicker">How installation works</span>
            <h2>Discover here. Install from Zana.</h2>
            <p>Use this catalog to evaluate extensions. In the desktop app, open <strong>Settings → Extensions → Marketplace</strong> to install a published extension, or choose a local build when you are developing privately.</p>
          </div>
          <div className="clean-marketplace-actions">
            <Link className="clean-button clean-button-dark" href="/extensions/install/">See install paths <span aria-hidden="true">→</span></Link>
            <Link className="clean-button" href="/extensions/">Build an extension</Link>
          </div>
        </div>

        <div className="mk-toolbar">
          <input
            className="search-box"
            aria-label="Search extensions"
            placeholder="Search extensions…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span style={{ color: 'var(--muted-2)', fontSize: 13 }}>
            {filtered.length} {filtered.length === 1 ? 'extension' : 'extensions'}
          </span>
          <Link href="/dashboard/" className="clean-button clean-button-small clean-marketplace-publish">
            Publish yours
          </Link>
        </div>

        {filtered.length === 0 ? (
          <div className="empty">No extensions match “{q}”.</div>
        ) : (
          <div className="mk-grid" data-reveal-stagger>
            {filtered.map((e) => (
              <div className="clean-marketplace-card" key={e.id}>
                <div className="mk-head">
                  <span className="mk-icon">{e.title.charAt(0).toUpperCase()}</span>
                  <h3>{e.title}</h3>
                  <span className="mk-badge">v{e.version}</span>
                </div>
                {e.author && <p className="clean-marketplace-author">by {e.author}</p>}
                <p>{e.description ?? 'No description provided.'}</p>
                {e.permissions.length > 0 && (
                  <div className="mk-perms">
                    {e.permissions.map((p) => (
                      <span className="perm" key={p}>
                        {p}
                      </span>
                    ))}
                  </div>
                )}
                <p className="clean-marketplace-install-command">
                  Install in Zana: <code>Settings → Extensions → Marketplace → {e.id}</code>
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
