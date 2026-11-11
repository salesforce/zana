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
} from '../../lib/official-marketplace';
import { AuroraGrid } from '../components/AuroraGrid';
import styles from './marketplace.module.css';

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

        <div className={`mk-install zcc-panel ${styles.install}`} data-reveal>
          <div className={styles.hub} aria-hidden="true"><img src="/zana-icon-512.png" alt="" width={92} height={92} /></div>
          <div>
            <span className="zcc-kicker">How installation works</span>
            <h2>Discover here. <span>Install from Zana.</span></h2>
            <p>
              Add this catalog, then install from <strong>Plugins → Browse</strong>. Plugins run
              in-process on the server after a loud full-trust confirm.
            </p>
            <p className={`mk-cmd ${styles.cmd}`}>
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
          <div className={`empty ${styles.empty}`}>No plugins match “{q}”.</div>
        ) : (
          <div className={`mk-grid ${styles.grid}`} data-reveal-stagger>
            {filtered.map((e) => (
              <div className={`zcc-panel ${styles.card}`} key={e.id}>
                <div className="mk-head">
                  <span className={`mk-icon ${styles.icon}`} aria-hidden="true">{e.title.charAt(0).toUpperCase()}</span>
                  <h3>{e.title}</h3>
                  <span className={`mk-badge ${styles.badge}`}>{e.version}</span>
                </div>
                {e.author && <p className={`mk-meta ${styles.author}`}>by {e.author}</p>}
                <p className={styles.desc}>{e.description}</p>
                <p className={`mk-cmd ${styles.foot}`}>
                  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 20h14"/></svg>
                  <span>Install in Zana: <code>Plugins → Browse → {e.id}</code></span>
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
