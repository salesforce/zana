import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Plugins',
  description:
    'Install and author Zana Command Center plugins. Manifests live in package.json, load in-process on the server, and register UI slots in the app.',
  alternates: { canonical: '/extensions/' },
  openGraph: {
    title: 'Plugins for Zana Command Center',
    description: 'Install new capabilities or build your own with @zana-ai/zcc-plugin-sdk.',
    url: '/extensions/',
    type: 'website',
    images: ['/opengraph-image']
  }
};

const PATHS = [
  {
    number: '01',
    title: 'Install a plugin',
    body: 'Use the marketplace for published capabilities, or install a folder, git, or npm source when you already have the plugin.',
    href: '/extensions/install/',
    action: 'See installation paths'
  },
  {
    number: '02',
    title: 'Build your first panel',
    body: 'Start with a TypeScript plugin that registers a nav panel. Plugins are full-trust after a loud install confirm.',
    href: '/extensions/getting-started/',
    action: 'Start the quickstart'
  },
  {
    number: '03',
    title: 'Learn the SDK boundary',
    body: 'Use @zana-ai/zcc-plugin-sdk for slots on the app side and ZccPluginApi on the server. Host-daemon tokens stay on the server.',
    href: '/extensions/sdk/',
    action: 'Explore the SDK'
  }
];

export default function ExtensionsPage() {
  return (
    <>
      <section className="extensions-hero">
        <div className="wrap">
          <div className="extensions-hero-copy" data-reveal>
            <span className="eyebrow">The Zana plugin system</span>
            <h1>Shape the cockpit<br /><span className="grad">around your work.</span></h1>
            <p>
              Add panels, project tabs, skills, and MCP servers without modifying Zana core. Start with the
              marketplace, then build only as much as your workflow needs. Plugins run in-process after a
              loud full-trust confirm.
            </p>
            <div className="cta">
              <Link className="btn btn-primary btn-lg" href="/extensions/getting-started/">Build your first plugin</Link>
              <Link className="btn btn-ghost btn-lg" href="/marketplace/">Browse marketplace</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="extension-paths-section">
        <div className="wrap">
          <div className="section-head center" data-reveal>
            <span className="eyebrow">Choose a starting point</span>
            <h2>One system, three practical paths.</h2>
            <p className="section-lede">The task pages explain the outcome first and lead into the canonical SDK documentation when you need detail.</p>
          </div>
          <div className="extension-paths" data-reveal-stagger>
            {PATHS.map((path) => (
              <Link key={path.number} className="extension-path-card" href={path.href}>
                <span className="extension-path-number">{path.number}</span>
                <h3>{path.title}</h3>
                <p>{path.body}</p>
                <span className="text-link">{path.action} <span aria-hidden="true">→</span></span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="product-proof solo" data-reveal>
            <div className="product-proof-copy">
              <span className="eyebrow">Install with confidence</span>
              <h2>Discover a capability, then confirm full trust.</h2>
              <p>
                Marketplace entries describe what a plugin contributes. Official catalogs install offline;
                community catalogs list npm/git pointers only. After install, plugins run in-process on the server.
              </p>
              <ul>
                <li>Install published plugins from the same catalog the app reads</li>
                <li>Use a local folder, git, or npm source for private development workflows</li>
                <li>Confirm the full-trust install before the plugin loads</li>
              </ul>
              <p style={{ marginTop: 20 }}><Link className="text-link" href="/extensions/install/">Read the install guide <span aria-hidden="true">→</span></Link></p>
            </div>
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="product-proof solo" data-reveal>
            <div className="product-proof-copy">
              <span className="eyebrow">A safe authoring loop</span>
              <h2>Build locally. Reload live. Keep core untouched.</h2>
              <p>
                A local plugin is an ordinary disk plugin with an editable source folder. Author{' '}
                <code>package.json</code> <code>zcc</code>, then <code>zcc plugin dev</code> watches, rebuilds, and
                reloads.
              </p>
              <ul>
                <li>Use @zana-ai/zcc-plugin-sdk instead of internal app modules</li>
                <li>Register app.slots.navPanel and optional server hooks</li>
                <li>A failed reload keeps the last good generation</li>
              </ul>
              <p style={{ marginTop: 20 }}><Link className="text-link" href="/extensions/getting-started/">Follow the five-minute quickstart <span aria-hidden="true">→</span></Link></p>
            </div>
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="extension-reference" data-reveal>
            <div>
              <span className="eyebrow">Reference when you need it</span>
              <h2>Short path to action. Deep documentation behind it.</h2>
              <p>Use the task guides for a focused workflow, then move into the maintained reference for contracts, permissions, lifecycle details, and publishing.</p>
            </div>
            <div className="extension-reference-links">
              <Link href="/docs/extensions-quickstart/">Build your first plugin <span aria-hidden="true">→</span></Link>
              <Link href="/docs/extensions-authoring/">Plugin authoring guide <span aria-hidden="true">→</span></Link>
              <Link href="/docs/extensions-sdk-reference/">SDK reference <span aria-hidden="true">→</span></Link>
              <Link href="/docs/extensions/">Plugin architecture overview <span aria-hidden="true">→</span></Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
