'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  marketplaceCardsFromIndex,
  officialMarketplaceIndex,
  OFFICIAL_MARKETPLACE_FEED_PATH,
  type MarketplaceCard,
  type OfficialMarketplaceIndex
} from '@/lib/official-marketplace';
import { site } from '@/lib/site';

type Status = 'loading' | 'live' | 'sample';

const FALLBACK_CARDS = marketplaceCardsFromIndex(officialMarketplaceIndex());

export function MarketplaceClient() {
  const [entries, setEntries] = useState<MarketplaceCard[]>(FALLBACK_CARDS);
  const [status, setStatus] = useState<Status>('loading');
  const [q, setQ] = useState('');
  const addCommand = `zcc marketplace add ${site.publicBaseUrl.replace(/\/+$/, '')}${OFFICIAL_MARKETPLACE_FEED_PATH}`;

  useEffect(() => {
    let alive = true;
    fetch(OFFICIAL_MARKETPLACE_FEED_PATH, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((index: OfficialMarketplaceIndex) => {
        if (!alive) return;
        if (index?.schemaVersion === 1 && Array.isArray(index.plugins) && index.plugins.length > 0) {
          setEntries(marketplaceCardsFromIndex(index));
          setStatus('live');
          return;
        }
        setStatus('sample');
      })
      .catch(() => {
        if (alive) setStatus('sample');
      });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(
    () =>
      entries.filter((e) => {
        const hay = `${e.title} ${e.id} ${e.description} ${e.author}`.toLowerCase();
        return hay.includes(q.toLowerCase());
      }),
    [entries, q]
  );

  return (
    <section className="clean-marketplace-page">
      <div className="wrap">
        <div className="clean-page-hero clean-marketplace-hero">
          <span className="clean-page-kicker">Marketplace</span>
          <h1>
            Plugins
            <span className={`feed-pill ${status === 'live' ? 'live' : ''}`}>
              <span className="fdot" />
              {status === 'loading' ? 'connecting…' : status === 'live' ? 'live feed' : 'bundled catalog'}
            </span>
          </h1>
          <p>
            Official first-party plugins as npm/git pointers — the same{' '}
            <code>{OFFICIAL_MARKETPLACE_FEED_PATH}</code> the desktop app can add. Bundled plugins
            still install offline from Plugins → Browse.
          </p>
        </div>

        <div className="clean-marketplace-guide" data-reveal>
          <div>
            <span className="clean-page-kicker">How installation works</span>
            <h2>Discover here. Install from Zana.</h2>
            <p>
              Add this catalog, then install from <strong>Plugins → Browse</strong>. Plugins run
              in-process on the server after a loud full-trust confirm.
            </p>
            <p className="clean-marketplace-install-command">
              <code>{addCommand}</code>
            </p>
          </div>
          <div className="clean-marketplace-actions">
            <Link className="clean-button clean-button-dark" href="/extensions/install/">
              See install paths <span aria-hidden="true">→</span>
            </Link>
            <Link className="clean-button" href="/extensions/">
              Build a plugin
            </Link>
          </div>
        </div>

        <div className="mk-toolbar">
          <input
            className="search-box"
            aria-label="Search plugins"
            placeholder="Search plugins…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span style={{ color: 'var(--muted-2)', fontSize: 13 }}>
            {filtered.length} {filtered.length === 1 ? 'plugin' : 'plugins'}
          </span>
          <Link href="/dashboard/" className="clean-button clean-button-small clean-marketplace-publish">
            Publish yours
          </Link>
        </div>

        {filtered.length === 0 ? (
          <div className="empty">No plugins match “{q}”.</div>
        ) : (
          <div className="mk-grid" data-reveal-stagger>
            {filtered.map((e) => (
              <div className="clean-marketplace-card" key={e.id}>
                <div className="mk-head">
                  <span className="mk-icon">{e.title.charAt(0).toUpperCase()}</span>
                  <h3>{e.title}</h3>
                  <span className="mk-badge">{e.version}</span>
                </div>
                {e.author && <p className="clean-marketplace-author">by {e.author}</p>}
                <p>{e.description}</p>
                <p className="clean-marketplace-install-command">
                  Install in Zana: <code>Plugins → Browse → {e.id}</code>
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
