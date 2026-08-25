import Link from 'next/link';
import type { Metadata } from 'next';
import { ProductShot } from '../../components/ProductShot';

export const metadata: Metadata = {
  title: 'Build your first plugin',
  description: 'Scaffold a package.json zcc plugin, run zcc plugin dev, and see the panel reload inside the app.',
  alternates: { canonical: '/extensions/getting-started/' }
};

const STEPS = [
  ['1', 'Scaffold a plugin', 'Run `zcc plugin new hello` or Create in Plugins → Browse. The starter writes package.json zcc, server.ts, and app.tsx.'],
  ['2', 'Describe the plugin', 'The manifest lives in package.json → zcc (name, app/server entries, skills, MCP). engines.zcc pins the running app.'],
  ['3', 'Return a panel', 'Default-export definePluginApp and register app.slots.navPanel. The host React instance is globalThis.__ZCC_HOST_REACT__.'],
  ['4', 'Build and install', 'zcc plugin dev watches, rebuilds, and reloads. Or install from Plugins → Browse (folder, git, or npm).'],
  ['5', 'Reload and refine', 'A failed reload keeps the last good generation. Plugins are full-trust in-process on the server after a loud confirm.']
] as const;

const MANIFEST = `{
  "name": "zcc-plugin-hello",
  "engines": { "zcc": ">=1.0.0", "zccPluginSdk": ">=0.1.0" },
  "zcc": {
    "name": "Hello",
    "app": "./app.js",
    "server": "./server.mjs",
    "skills": ["skills"]
  }
}`;

export default function ExtensionGettingStartedPage() {
  return (
    <>
      <section className="guide-hero">
        <div className="wrap">
          <div className="guide-hero-copy" data-reveal>
            <span className="eyebrow">Plugin quickstart</span>
            <h1>A working panel in<br /><span className="grad">five focused steps.</span></h1>
            <p>Build a React panel that runs inside Zana using <code>@zana-ai/zcc-plugin-sdk</code>. Plugins are full-trust after install — confirm each install, and keep host-daemon tokens on the server.</p>
            <div className="cta">
              <a className="btn btn-primary btn-lg" href="#steps">Start building <span aria-hidden="true">↓</span></a>
              <Link className="btn btn-ghost btn-lg" href="/extensions/sdk/">Understand the SDK</Link>
            </div>
          </div>
          <ProductShot id="extension-panel-result" priority />
        </div>
      </section>

      <section className="guide-prerequisites">
        <div className="wrap" data-reveal>
          <strong>Before you begin</strong>
          <span>Node 20+, a local Zana installation, and a working TypeScript environment.</span>
          <Link href="/download/">Get Zana <span aria-hidden="true">→</span></Link>
        </div>
      </section>

      <section id="steps" className="guide-steps-section">
        <div className="wrap">
          <div className="guide-steps-head" data-reveal>
            <span className="eyebrow">The build loop</span>
            <h2>Small surface area, fast feedback.</h2>
            <p>Everything begins with <code>package.json</code> <code>zcc</code>. The host owns slots, reload, and the full-trust install confirm.</p>
          </div>
          <ol className="guide-steps" data-reveal-stagger>
            {STEPS.map(([number, title, body]) => (
              <li key={number}>
                <span>{number}</span>
                <div><h3>{title}</h3><p>{body}</p></div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="product-proof reverse" data-reveal>
            <div className="product-proof-copy">
              <span className="eyebrow">The starting manifest</span>
              <h2>Declare the smallest useful plugin.</h2>
              <p>The contract lives in <code>package.json</code> <code>zcc</code>. Start with a panel, then add skills or MCP only when you have a concrete need. Install is the full-trust confirm.</p>
              <p style={{ marginTop: 20 }}><Link className="text-link" href="/docs/extensions-authoring/">Read the manifest contract <span aria-hidden="true">→</span></Link></p>
            </div>
            <pre className="guide-code"><code>{MANIFEST}</code></pre>
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="product-proof" data-reveal>
            <div className="product-proof-copy">
              <span className="eyebrow">A live local loop</span>
              <h2>Keep the source editable and the result visible.</h2>
              <p>Once the folder is connected as a local source, build changes can refresh the installed artifact without an application restart. This is the fastest way to refine the panel in real product context.</p>
              <ul>
                <li>Source remains in your working directory</li>
                <li>zcc plugin dev watches, rebuilds, and reloads</li>
                <li>A failed reload keeps the last good generation</li>
              </ul>
            </div>
            <ProductShot id="local-extension-workspace" />
          </div>
        </div>
      </section>

      <section className="guide-next-section">
        <div className="wrap">
          <div className="guide-next-card" data-reveal>
            <div><span className="eyebrow">Continue when ready</span><h2>From a panel to a complete integration.</h2><p>Add project tabs, skills, MCP servers, settings, or extra metadata as the plugin earns the extra complexity.</p></div>
            <div className="guide-next-actions">
              <Link className="btn btn-primary" href="/extensions/sdk/">Explore the SDK</Link>
              <Link className="btn btn-ghost" href="/docs/extensions-quickstart/">Read the canonical quickstart</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
