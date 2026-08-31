'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  marketplaceCardsFromIndex,
  officialMarketplaceAddCommand,
  officialMarketplaceIndex,
  OFFICIAL_MARKETPLACE_FEED_PATH,
  type MarketplaceCard,
  type OfficialMarketplaceIndex
} from '@/lib/official-marketplace';
import { AuroraGrid } from '../components/AuroraGrid';

type Status = 'loading' | 'live' | 'sample';

const FALLBACK_CARDS = marketplaceCardsFromIndex(officialMarketplaceIndex());

export function MarketplaceClient({ publicBaseUrl }: { publicBaseUrl: string }) {
  const [entries, setEntries] = useState<MarketplaceCard[]>(FALLBACK_CARDS);
  const [status, setStatus] = useState<Status>('loading');
  const [q, setQ] = useState('');
  const addCommand = officialMarketplaceAddCommand(publicBaseUrl);

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
    <div className="zcc-page aurora-host">
      <AuroraGrid beams={false} />
      <div className="wrap">
        <div className="zcc-hero">
          <span className="zcc-kicker">Marketplace</span>
          <h1>
            Plugins{' '}
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

        <div className="mk-install zcc-panel" data-reveal>
          <div>
            <span className="zcc-kicker">How installation works</span>
            <h2>Discover here. Install from Zana.</h2>
            <p>
              Add this catalog, then install from <strong>Plugins → Browse</strong>. Plugins run
              in-process on the server after a loud full-trust confirm.
            </p>
            <p className="mk-cmd">
              <code>{addCommand}</code>
            </p>
          </div>
          <div className="mk-install-actions">
            <Link className="zcc-btn zcc-btn-primary" href="/extensions/install/">
              See install paths
            </Link>
            <Link className="zcc-btn zcc-btn-ghost" href="/extensions/">
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
          <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>
            {filtered.length} {filtered.length === 1 ? 'plugin' : 'plugins'}
          </span>
          <Link href="/dashboard/" className="zcc-btn zcc-btn-sm mk-publish">
            Publish yours
          </Link>
        </div>

        {filtered.length === 0 ? (
          <div className="empty">No plugins match “{q}”.</div>
        ) : (
          <div className="mk-grid" data-reveal-stagger>
            {filtered.map((e) => (
              <div className="zcc-panel" key={e.id}>
                <div className="mk-head">
                  <span className="mk-icon">{e.title.charAt(0).toUpperCase()}</span>
                  <h3>{e.title}</h3>
                  <span className="mk-badge">{e.version}</span>
                </div>
                {e.author && <p className="mk-meta">by {e.author}</p>}
                <p className="mk-meta" style={{ marginTop: 8, fontSize: 13 }}>{e.description}</p>
                <p className="mk-cmd">
                  Install in Zana: <code>Plugins → Browse → {e.id}</code>
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
