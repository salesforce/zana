import Link from 'next/link';
import type { Metadata } from 'next';
import { ProductShot } from '../../components/ProductShot';

export const metadata: Metadata = {
  title: 'Install extensions',
  description: 'Understand marketplace, local folder, archive, and editable-source extension installation in Zana Command Center.',
  alternates: { canonical: '/extensions/install/' }
};

const METHODS = [
  ['Marketplace', 'Use when the extension is published to a registry.', 'Discover the capability, inspect its description and permissions, then install from Zana’s Extensions settings.'],
  ['Local built folder', 'Use during private development or team testing.', 'Choose a folder containing extension.json and the current dist build. The host validates the artifact before it activates.'],
  ['Published archive', 'Use when a registry is not part of the distribution path.', 'Install a packaged extension bundle through the same manifest and API-compatibility validation path.'],
  ['Editable source', 'Use when you are actively authoring an extension.', 'Keep source connected locally so builds can reload the installed extension while preserving the normal permission model.']
] as const;

export default function ExtensionInstallPage() {
  return (
    <>
      <section className="guide-hero">
        <div className="wrap">
          <div className="guide-hero-copy" data-reveal>
            <span className="eyebrow">Install extensions</span>
            <h1>Choose the source.<br /><span className="grad">Zana validates the rest.</span></h1>
            <p>Extensions use one installation boundary whether they arrive from a marketplace, a local build folder, or a shareable archive. The host checks compatibility before an extension is allowed to run.</p>
            <div className="cta"><Link className="btn btn-primary btn-lg" href="/marketplace/">Browse marketplace</Link><Link className="btn btn-ghost btn-lg" href="/extensions/getting-started/">Build one instead</Link></div>
          </div>
          <ProductShot id="extension-install" priority />
        </div>
      </section>

      <section className="install-methods-section">
        <div className="wrap">
          <div className="section-head" data-reveal><span className="eyebrow">Four routes, one trust boundary</span><h2>Pick the distribution model that fits the work.</h2></div>
          <div className="install-methods" data-reveal-stagger>
            {METHODS.map(([title, use, description]) => <article key={title}><h3>{title}</h3><strong>{use}</strong><p>{description}</p></article>)}
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="product-proof reverse" data-reveal>
            <div className="product-proof-copy">
              <span className="eyebrow">Permissions are explicit</span>
              <h2>Read the declared access before the extension receives it.</h2>
              <p>Disk extensions declare what they need. Zana asks for consent and enforces the resulting grant, rather than treating an installed package as automatically trusted.</p>
              <ul><li>Renderer-only panels can require no permissions</li><li>Scope is reviewed before capabilities are granted</li><li>Permission-widening updates require a new consent decision</li></ul>
              <p style={{ marginTop: 20 }}><Link className="text-link" href="/extensions/sdk/#permissions">See the permission model <span aria-hidden="true">→</span></Link></p>
            </div>
            <ProductShot id="extension-consent" />
          </div>
        </div>
      </section>

      <section className="guide-next-section">
        <div className="wrap"><div className="guide-next-card" data-reveal><div><span className="eyebrow">Need deeper detail?</span><h2>Use the reference for exact install and publishing commands.</h2><p>The public docs retain the detailed artifact, registry, API, and permission contract.</p></div><div className="guide-next-actions"><Link className="btn btn-primary" href="/docs/extensions-authoring/#install--dev-loop">Open authoring install guide</Link><Link className="btn btn-ghost" href="/docs/release-hosting/">Marketplace hosting</Link></div></div></div>
      </section>
    </>
  );
}
