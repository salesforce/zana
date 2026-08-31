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
        <div className="token-notice">
          <p>
            Copy this token now — it is shown only once and cannot be retrieved again.
          </p>
          <div className="token-value">
            <code>{mintedToken}</code>
            <button type="button" className="zcc-btn zcc-btn-sm" onClick={copyMinted}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      <div className="token-create">
        <input
          className="token-input"
          placeholder="Token name (optional)"
          aria-label="Token name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
        <button type="button" className="zcc-btn zcc-btn-primary" onClick={createToken} disabled={busy}>
          Create token
        </button>
      </div>

      {error && <p className="token-error" role="alert">{error}</p>}

      {tokens.length === 0 ? (
        <div className="empty">No publish tokens yet. Create one to publish from the CLI.</div>
      ) : (
        <div className="token-table-wrap">
          <table className="token-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Created</th>
              <th>Last used</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id}>
                <td>{t.name ?? <em>unnamed</em>}</td>
                <td>
                  <code>{t.prefix}…</code>
                </td>
                <td>{formatDate(t.createdAt)}</td>
                <td>{formatDate(t.lastUsedAt)}</td>
                <td>
                  <button
                    type="button"
                    className="zcc-btn zcc-btn-sm"
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
        </div>
      )}
    </div>
  );
}
