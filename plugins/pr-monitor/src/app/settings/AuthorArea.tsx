/**
 * Author area (R-PPL-*). Shows the monitored author's identity and how it maps
 * per organization. Collapsed: avatar (initials fallback — avatar bytes can't
 * cross the string-only exec channel, AC-PPL-3.1) + display name + email +
 * chevron. Expanded: Display Name, Email, and a GitHub Identities list — one row
 * per org host, `<login> (<short-host>)`, with a live connection check. This is
 * re-synced solely via the Organizations Re-discover action (R-PPL-002).
 */

import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Loader2, CircleCheck, CircleX } from 'lucide-react';
import type { ModuleHost } from '../host.js';
import { type ConnectionState, PREFETCH_AUTHOR_CACHE_KEY } from '../../../lib/types.js';
import { AreaHeader } from './ui.js';

interface AuthorIdentity {
  host: string;
  shortHost: string;
  login: string;
  connection: ConnectionState;
}

interface Author {
  login: string;
  name?: string;
  email?: string;
  identities: AuthorIdentity[];
}

/** Two-letter initials from a display name or login. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function AuthorArea({ host }: { host: ModuleHost }) {
  // Paint from the background-prefetched cache if it's warm (R-SET-005), so the
  // first open skips the gh-backed loading spinner. `load()` still refreshes.
  // `undefined` = still loading; `null` = loaded-but-none.
  const [author, setAuthor] = useState<Author | null | undefined>(() => {
    const cached = host.cache.get<{ ok?: boolean; author?: Author }>(PREFETCH_AUTHOR_CACHE_KEY);
    return cached?.ok ? cached.author ?? null : undefined;
  });
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await host.call<{ ok: boolean; author?: Author; error?: string }>('getAuthor');
      if (res?.ok) {
        setAuthor(res.author ?? null);
        setError(null);
      } else {
        setAuthor(null);
        if (res?.error) setError(res.error);
      }
    } catch (err) {
      setAuthor(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [host]);

  useEffect(() => {
    void load();
  }, [load]);

  const displayName = author?.name || author?.login || '';

  return (
    <div className="prm-area">
      <AreaHeader title="Author" subtitle="Monitored Author and how to identify per organization" />

      {error && <div className="prm-error">{error}</div>}

      {author === undefined ? (
        <div className="prm-loading">
          <Loader2 size={14} className="prm-spin" /> Loading author…
        </div>
      ) : author === null ? (
        <div className="prm-area-empty">
          No authenticated author. Sign in with <code>gh auth login</code>, then Re-discover from
          Organizations.
        </div>
      ) : (
        <div className="prm-card-list">
          <div className="prm-entity-card prm-author-card">
            <button
              type="button"
              className="prm-author-row"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              <span className="prm-avatar prm-avatar--initials" aria-hidden>
                {initialsOf(displayName)}
              </span>
              <span className="prm-author-id">
                <span className="prm-entity-title">{displayName}</span>
                {author.email && <span className="prm-entity-sub">{author.email}</span>}
              </span>
              <ChevronRight
                size={16}
                className={`prm-disclosure${expanded ? ' is-open' : ''}`}
                aria-hidden
              />
            </button>

            {expanded && (
              <div className="prm-author-detail">
                <div className="prm-kv">
                  <span className="prm-field-label">Display Name</span>
                  <span>{displayName || '—'}</span>
                </div>
                <div className="prm-kv">
                  <span className="prm-field-label">Email</span>
                  <span>{author.email || '—'}</span>
                </div>
                <div className="prm-kv">
                  <span className="prm-field-label">GitHub Identities</span>
                  <div className="prm-identity-list">
                    {author.identities.map((id) => (
                      <div key={`${id.host}|${id.login}`} className="prm-identity-row">
                        <span>
                          {id.login} <span className="prm-entity-host">({id.shortHost})</span>
                        </span>
                        {id.connection === 'connected' ? (
                          <CircleCheck size={13} className="prm-identity-verified" aria-label="Verified" />
                        ) : (
                          // AC-PPL-4.3: a host whose gh auth is missing/invalid gets the
                          // Disconnected treatment (R-ORG-005) rather than the verified check.
                          <span className="prm-identity-disconnected" aria-label="Disconnected">
                            <CircleX size={13} /> Disconnected
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
