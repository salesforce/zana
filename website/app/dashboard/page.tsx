/**
 * Publisher dashboard (plan Phase 6 step A.1) — SSR, session-gated.
 *
 * Signed out: a "Sign in with GitHub" link to `/api/auth/github/login`.
 * Signed in: GitHub identity, the token list + mint/revoke UI (delegated to
 * the `TokenManager` client component), and a copy-paste CLI snippet showing
 * exactly how to publish with a minted token.
 *
 * `requireSession` (lib/auth.ts) takes a `Request` and reads its `Cookie`
 * header; a server component has no `Request` object, so this route
 * reconstructs the minimal shape it needs from `next/headers`.
 */
import Link from 'next/link';
import { headers } from 'next/headers';
import { requireSession, listPublishTokens } from '@/lib/auth';
import { site } from '@/lib/site';
import type { Metadata } from 'next';
import { TokenManager } from './TokenManager';

export const dynamic = 'force-dynamic';

// Session-gated, per-user surface — keep it out of search indexes (belt-and-
// suspenders alongside the robots.ts /dashboard/ disallow; also omitted from sitemap).
export const metadata: Metadata = { robots: { index: false, follow: false } };

async function currentUser() {
  const hdrs = await headers();
  const cookieHeader = hdrs.get('cookie') ?? '';
  const req = new Request('http://localhost/dashboard', { headers: { cookie: cookieHeader } });
  return requireSession(req);
}

export default async function Dashboard() {
  const user = await currentUser();

  if (!user) {
    return (
      <section className="clean-dashboard-hero">
        <div className="wrap">
          <span className="clean-page-kicker">Publisher dashboard</span>
          <h1>Sign in to publish extensions</h1>
          <p>
            Publishing an extension requires a GitHub identity — it&apos;s how the registry attributes releases and
            enforces that only you can update an id you&apos;ve claimed.
          </p>
          <a className="clean-button clean-button-dark" href="/api/auth/github/login">
            Sign in with GitHub <span aria-hidden="true">→</span>
          </a>
        </div>
      </section>
    );
  }

  const tokens = await listPublishTokens(user.id);

  return (
    <section className="clean-dashboard-page">
      <div className="wrap">
        <div className="clean-dashboard-heading">
          {user.avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatarUrl}
              alt={user.githubLogin}
              width={48}
              height={48}
              style={{ borderRadius: '50%', border: '1px solid var(--border)' }}
            />
          )}
          <div>
            <span className="clean-page-kicker">Publisher dashboard</span>
            <h2>{user.githubLogin}</h2>
          </div>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="clean-button clean-button-small">
              Log out
            </button>
          </form>
        </div>

        <div className="clean-dashboard-card">
          <h3>How to publish</h3>
          <p>Create a token below, then run:</p>
          <pre className="clean-command-block">
            <code>
              node scripts/publish-extension.mjs &lt;extensionDir&gt; --api {site.publicBaseUrl} --token zpat_…
            </code>
          </pre>
          <p style={{ marginBottom: 0 }}>
            The first publish of an id claims it under your account; later publishes of the same id require the same
            token owner. See <Link href="/docs/">the docs</Link> for the full extension manifest reference.
          </p>
        </div>

        <div className="clean-dashboard-card">
          <h3>Publish tokens</h3>
          <p style={{ marginBottom: 20 }}>
            Tokens authenticate the CLI/app to publish on your behalf. Each is shown once at creation — store it
            somewhere safe (e.g. a local env var or secrets manager).
          </p>
          <TokenManager initialTokens={tokens} />
        </div>
      </div>
    </section>
  );
}
