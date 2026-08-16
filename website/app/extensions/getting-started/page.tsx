import Link from 'next/link';
import type { Metadata } from 'next';
import { ProductShot } from '../../components/ProductShot';

export const metadata: Metadata = {
  title: 'Build your first extension',
  description: 'Create a renderer-only Zana extension, build it, install it, and see the panel reload inside the app.',
  alternates: { canonical: '/extensions/getting-started/' }
};

const STEPS = [
  ['1', 'Scaffold a small extension', 'Run the scaffolder to create the manifest, renderer entry, and build configuration. Start renderer-only so no permissions are required.'],
  ['2', 'Describe the extension', 'Set a stable id, title, renderer entry, and compatible Zana API range in extension.json. This manifest is the host contract.'],
  ['3', 'Return a panel', 'Default-export a RendererEntry. Its activate function receives the host React instance and permission-gated ModuleHost surface.'],
  ['4', 'Build and install', 'Build the renderer bundle, then install the artifact from Extensions settings or copy it into the extension directory for the lowest-level loop.'],
  ['5', 'Reload and refine', 'An editable local source connection lets a creator or shell session rebuild the source and reload the installed extension without an app restart.']
] as const;

const MANIFEST = `{
  "id": "hello",
  "title": "Hello",
  "icon": "Sparkles",
  "entry": { "renderer": "renderer.js" },
  "engines": { "zccApi": "^1.0.0" },
  "permissions": []
}`;

export default function ExtensionGettingStartedPage() {
  return (
    <>
      <section className="guide-hero">
        <div className="wrap">
          <div className="guide-hero-copy" data-reveal>
            <span className="eyebrow">Extension quickstart</span>
            <h1>A working panel in<br /><span className="grad">five focused steps.</span></h1>
            <p>Build a React panel that runs inside Zana using the host SDK. Begin with no permissions, then grow into capabilities only when the workflow calls for them.</p>
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
            <p>Everything begins with a renderer bundle. The host owns React, routes, permissions, and the extension lifecycle.</p>
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
              <h2>Declare the smallest useful extension.</h2>
              <p>A renderer-only panel with an empty permissions list installs without a consent prompt. Add capabilities later only when you have a concrete need.</p>
              <p style={{ marginTop: 20 }}><Link className="text-link" href="/docs/extensions-authoring/#manifest-extensionjson">Read the manifest contract <span aria-hidden="true">→</span></Link></p>
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
                <li>Only the manifest and dist build are packaged for installation</li>
                <li>Permission changes continue through the normal consent path</li>
              </ul>
            </div>
            <ProductShot id="local-extension-workspace" />
          </div>
        </div>
      </section>

      <section className="guide-next-section">
        <div className="wrap">
          <div className="guide-next-card" data-reveal>
            <div><span className="eyebrow">Continue when ready</span><h2>From a panel to a complete integration.</h2><p>Add project tabs, commands, persistent storage, contributions, or brokered main-side capabilities as the extension earns the extra complexity.</p></div>
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
