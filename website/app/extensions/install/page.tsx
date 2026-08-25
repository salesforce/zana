import Link from 'next/link';
import type { Metadata } from 'next';
import { ProductShot } from '../../components/ProductShot';

export const metadata: Metadata = {
  title: 'Install plugins',
  description: 'Understand marketplace, local folder, git/npm, and editable-source plugin installation in Zana Command Center.',
  alternates: { canonical: '/extensions/install/' }
};

const METHODS = [
  ['Marketplace', 'Use when the plugin is listed in an official or community catalog.', 'Discover the capability, inspect what it adds (skills, MCP servers), then confirm the full-trust install from Plugins → Browse.'],
  ['Local folder', 'Use during private development or team testing.', 'Choose a folder containing package.json with a zcc block. PluginService path-installs it; a failed reload keeps the last good generation.'],
  ['Git or npm pointer', 'Use when a registry is not part of the distribution path.', 'Install via git: or npm: sources. The marketplace lists pointers only — refresh never executes plugin code.'],
  ['Editable source', 'Use when you are actively authoring a plugin.', 'Keep source connected locally. zcc plugin dev watches, rebuilds, and reloads while the plugin stays full-trust in-process.']
] as const;

export default function ExtensionInstallPage() {
  return (
    <>
      <section className="guide-hero">
        <div className="wrap">
          <div className="guide-hero-copy" data-reveal>
            <span className="eyebrow">Install plugins</span>
            <h1>Choose the source.<br /><span className="grad">Zana records provenance.</span></h1>
            <p>Plugins use one installation boundary whether they arrive from an official catalog, a community git marketplace, or a local folder. After install they run in-process on the server — confirm that full-trust step before you continue.</p>
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
              <span className="eyebrow">Install is the trust gate</span>
              <h2>Confirm full trust before the plugin loads.</h2>
              <p>Plugins run in-process on the server after install. Zana lists skills, MCP servers, and extra the grant would add, then you confirm.</p>
              <ul><li>Official catalogs install offline</li><li>Community catalogs are npm/git pointers — refresh never executes plugin code</li><li>A failed reload keeps the last good generation</li></ul>
              <p style={{ marginTop: 20 }}><Link className="text-link" href="/extensions/sdk/#permissions">See how trust works <span aria-hidden="true">→</span></Link></p>
            </div>
            <ProductShot id="extension-consent" />
          </div>
        </div>
      </section>

      <section className="guide-next-section">
        <div className="wrap"><div className="guide-next-card" data-reveal><div><span className="eyebrow">Need deeper detail?</span><h2>Use the reference for exact install and publishing commands.</h2><p>The public docs retain the detailed artifact, registry, API, and plugin contract.</p></div><div className="guide-next-actions"><Link className="btn btn-primary" href="/docs/extensions-authoring/#install--dev-loop">Open authoring install guide</Link><Link className="btn btn-ghost" href="/docs/release-hosting/">Marketplace hosting</Link></div></div></div>
      </section>
    </>
  );
}
