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
    <section style={{ paddingTop: 56 }}>
      <div className="wrap">
        <div className="section-head" style={{ maxWidth: 720 }}>
          <span className="eyebrow">Marketplace</span>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            Extensions
            <span className={`feed-pill ${status === 'live' ? 'live' : ''}`}>
              <span className="fdot" />
              {status === 'loading' ? 'connecting…' : status === 'live' ? 'live feed' : 'sample catalog'}
            </span>
          </h1>
          <p className="section-lede">
            Add new features to the app — panels, tabs, commands, personas, and teams. Install from the same
            catalog the desktop app reads.
            {status === 'sample' && ' Connect a live registry feed to list published extensions.'}
          </p>
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
          <Link href="/dashboard/" className="btn btn-sm" style={{ marginLeft: 'auto' }}>
            + Publish yours
          </Link>
        </div>

        {filtered.length === 0 ? (
          <div className="empty">No extensions match “{q}”.</div>
        ) : (
          <div className="mk-grid" data-reveal-stagger>
            {filtered.map((e) => (
              <div className="card mk-card" key={e.id}>
                <div className="mk-head">
                  <span className="mk-icon">{e.title.charAt(0).toUpperCase()}</span>
                  <h3 style={{ margin: 0 }}>{e.title}</h3>
                  <span className="mk-badge">v{e.version}</span>
                </div>
                {e.author && <p style={{ fontSize: 12, margin: 0, color: 'var(--muted)' }}>by {e.author}</p>}
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
                <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
                  Install from the app: <code>Settings → Extensions → Marketplace → {e.id}</code>
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
