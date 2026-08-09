'use client';

/**
 * Client-side token lifecycle: mint, list-refresh, copy (shown once), revoke.
 * Kept as a small child component per the plan ("client interactivity can be
 * a small 'use client' child component; keep server/client split clean") —
 * the parent `page.tsx` stays a server component that does the session gate
 * + initial DB read.
 */
import { useState } from 'react';

export interface TokenSummary {
  id: string;
  name: string | null;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

function formatDate(ms: number | null): string {
  if (!ms) return 'never';
  return new Date(ms).toLocaleString();
}

export function TokenManager({ initialTokens }: { initialTokens: TokenSummary[] }) {
  const [tokens, setTokens] = useState<TokenSummary[]>(initialTokens);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mintedToken, setMintedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function refresh(): Promise<void> {
    const res = await fetch('/api/tokens', { cache: 'no-store' });
    if (res.ok) setTokens(await res.json());
  }

  async function createToken(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || undefined })
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? `Failed to create token (${res.status})`);
        return;
      }
      setMintedToken(body.token);
      setCopied(false);
      setName('');
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function revokeToken(id: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tokens/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? `Failed to revoke token (${res.status})`);
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function copyMinted(): Promise<void> {
    if (!mintedToken) return;
    try {
      await navigator.clipboard.writeText(mintedToken);
      setCopied(true);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — the token is
      // still visible in the box for manual copy.
    }
  }

  return (
    <div>
      {mintedToken && (
        <div
          className="card"
          style={{ marginBottom: 20, borderColor: 'rgba(254,188,46,0.4)', background: 'rgba(254,188,46,0.06)' }}
        >
          <p style={{ margin: '0 0 10px', color: 'var(--warn)', fontWeight: 600, fontSize: 13 }}>
            Copy this token now — it is shown only once and cannot be retrieved again.
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <code
              style={{
                flex: 1,
                background: 'var(--bg-soft)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '10px 12px',
                fontSize: 13,
                wordBreak: 'break-all'
              }}
            >
              {mintedToken}
            </code>
            <button type="button" className="btn" onClick={copyMinted}>
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <input
          className="search-box"
          style={{ margin: 0, maxWidth: 320 }}
          placeholder="Token name (optional)"
          aria-label="Token name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
        <button type="button" className="btn btn-primary" onClick={createToken} disabled={busy}>
          Create token
        </button>
      </div>

      {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 16 }}>{error}</p>}

      {tokens.length === 0 ? (
        <div className="empty">No publish tokens yet. Create one to publish from the CLI.</div>
      ) : (
        <table className="prose" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', borderBottom: '1px solid var(--border)', padding: '8px 10px', fontSize: 12, color: 'var(--muted)' }}>Name</th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid var(--border)', padding: '8px 10px', fontSize: 12, color: 'var(--muted)' }}>Prefix</th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid var(--border)', padding: '8px 10px', fontSize: 12, color: 'var(--muted)' }}>Created</th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid var(--border)', padding: '8px 10px', fontSize: 12, color: 'var(--muted)' }}>Last used</th>
              <th style={{ borderBottom: '1px solid var(--border)', padding: '8px 10px' }} />
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id}>
                <td style={{ padding: '10px', borderBottom: '1px solid var(--border-soft)' }}>{t.name ?? <em style={{ color: 'var(--muted-2)' }}>unnamed</em>}</td>
                <td style={{ padding: '10px', borderBottom: '1px solid var(--border-soft)' }}>
                  <code>{t.prefix}…</code>
                </td>
                <td style={{ padding: '10px', borderBottom: '1px solid var(--border-soft)', color: 'var(--muted)', fontSize: 13 }}>
                  {formatDate(t.createdAt)}
                </td>
                <td style={{ padding: '10px', borderBottom: '1px solid var(--border-soft)', color: 'var(--muted)', fontSize: 13 }}>
                  {formatDate(t.lastUsedAt)}
                </td>
                <td style={{ padding: '10px', borderBottom: '1px solid var(--border-soft)', textAlign: 'right' }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => revokeToken(t.id)}
                    disabled={busy}
                    aria-label={`Revoke token ${t.name ?? t.prefix}`}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
