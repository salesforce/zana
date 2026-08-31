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
import { AuroraGrid } from '../components/AuroraGrid';

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
      <section className="dash-hero aurora-host">
        <AuroraGrid beams={false} />
        <div className="wrap">
          <span className="zcc-kicker">Publisher dashboard</span>
          <h1>Sign in to publish plugins</h1>
          <p>
            Publishing a plugin requires a GitHub identity — it&apos;s how the registry attributes releases and
            enforces that only you can update an id you&apos;ve claimed.
          </p>
          <a className="zcc-btn zcc-btn-primary" href="/api/auth/github/login">
            Sign in with GitHub
          </a>
        </div>
      </section>
    );
  }

  const tokens = await listPublishTokens(user.id);

  return (
    <section className="zcc-page">
      <div className="wrap">
        <div className="dash-heading">
          {user.avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatarUrl}
              alt={user.githubLogin}
              width={40}
              height={40}
              style={{ borderRadius: '50%', border: '1px solid var(--border)' }}
            />
          )}
          <div>
            <span className="zcc-kicker">Publisher dashboard</span>
            <h2>{user.githubLogin}</h2>
          </div>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="zcc-btn zcc-btn-sm">
              Log out
            </button>
          </form>
        </div>

        <div className="zcc-panel" style={{ marginBottom: 16 }}>
          <h3>How to publish</h3>
          <p>Create a token below, then run:</p>
          <pre className="command-block">
            <code>
              node scripts/publish-extension.mjs &lt;pluginDir&gt; --api {site.publicBaseUrl} --token zpat_…
            </code>
          </pre>
          <p style={{ marginBottom: 0 }}>
            The first publish of an id claims it under your account; later publishes of the same id require the same
            token owner. See <Link href="/docs/">the docs</Link> for the plugin manifest reference
            (<code>package.json</code> <code>zcc</code>).
          </p>
        </div>

        <div className="zcc-panel">
          <h3>Publish tokens</h3>
          <p style={{ marginBottom: 16 }}>
            Tokens authenticate the CLI/app to publish on your behalf. Each is shown once at creation — store it
            somewhere safe (e.g. a local env var or secrets manager).
          </p>
          <TokenManager initialTokens={tokens} />
        </div>
      </div>
    </section>
  );
}
