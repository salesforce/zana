import Link from 'next/link';
import type { Metadata } from 'next';
import { ProductShot } from '../components/ProductShot';

export const metadata: Metadata = {
  title: 'Plugins',
  description:
    'Install and author Zana Command Center plugins. Manifests live in package.json, load in-process on the server, and register UI slots in the app.',
  alternates: { canonical: '/extensions/' },
  openGraph: {
    title: 'Extensions for Zana Command Center',
    description: 'Install new capabilities or build your own with the Zana extension SDK.',
    url: '/extensions/',
    type: 'website',
    images: ['/opengraph-image']
  }
};

const PATHS = [
  {
    number: '01',
    title: 'Install an extension',
    body: 'Use the marketplace for published capabilities, or install a built folder or archive when you already have the extension.',
    href: '/extensions/install/',
    action: 'See installation paths'
  },
  {
    number: '02',
    title: 'Build your first panel',
    body: 'Start with a renderer-only TypeScript extension. It has no permissions, so you can validate the host integration before adding complexity.',
    href: '/extensions/getting-started/',
    action: 'Start the quickstart'
  },
  {
    number: '03',
    title: 'Learn the SDK boundary',
    body: 'Use the host API for panels, then add an optional main module only when your extension needs brokered capabilities or contributions.',
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
            <span className="eyebrow">The Zana extension system</span>
            <h1>Shape the cockpit<br /><span className="grad">around your work.</span></h1>
            <p>
              Add panels, project tabs, commands, personas, teams, and optional main-side capabilities without
              modifying Zana core. Start with the marketplace, then build only as much as your workflow needs.
            </p>
            <div className="cta">
              <Link className="btn btn-primary btn-lg" href="/extensions/getting-started/">Build your first extension</Link>
              <Link className="btn btn-ghost btn-lg" href="/marketplace/">Browse marketplace</Link>
            </div>
          </div>
          <ProductShot id="extension-panel-result" priority />
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
          <div className="product-proof" data-reveal>
            <div className="product-proof-copy">
              <span className="eyebrow">Install with confidence</span>
              <h2>Discover a capability, then review what it needs.</h2>
              <p>
                Marketplace entries describe what an extension contributes. If an extension requests capabilities,
                Zana presents its declared scope before it can run.
              </p>
              <ul>
                <li>Install published extensions from the same catalog the app reads</li>
                <li>Use a local built folder or archive for private development workflows</li>
                <li>Review declared permissions before an extension receives access</li>
              </ul>
              <p style={{ marginTop: 20 }}><Link className="text-link" href="/extensions/install/">Read the install guide <span aria-hidden="true">→</span></Link></p>
            </div>
            <ProductShot id="extension-install" />
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="product-proof reverse" data-reveal>
            <div className="product-proof-copy">
              <span className="eyebrow">A safe authoring loop</span>
              <h2>Build locally. Reload live. Keep core untouched.</h2>
              <p>
                A local extension is an ordinary disk extension with an editable source folder. Build its manifest and
                renderer bundle, then reload the installed build while you refine the experience.
              </p>
              <ul>
                <li>Use the stable TypeScript SDK instead of internal app modules</li>
                <li>Start with a renderer-only panel and no permission prompt</li>
                <li>Add a main module only when you need brokered, scoped capabilities</li>
              </ul>
              <p style={{ marginTop: 20 }}><Link className="text-link" href="/extensions/getting-started/">Follow the five-minute quickstart <span aria-hidden="true">→</span></Link></p>
            </div>
            <ProductShot id="local-extension-workspace" />
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="extension-reference" data-reveal>
            <div>
              <span className="eyebrow">Reference when you need it</span>
              <h2>Short path to action. Deep documentation behind it.</h2>
              <p>Use the task guides for a visual workflow, then move into the maintained reference for contracts, permissions, lifecycle details, and publishing.</p>
            </div>
            <div className="extension-reference-links">
              <Link href="/docs/extensions-quickstart/">Build your first extension <span aria-hidden="true">→</span></Link>
              <Link href="/docs/extensions-authoring/">Extension authoring guide <span aria-hidden="true">→</span></Link>
              <Link href="/docs/extensions-sdk-reference/">SDK reference <span aria-hidden="true">→</span></Link>
              <Link href="/docs/extensions/">Extension architecture overview <span aria-hidden="true">→</span></Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
