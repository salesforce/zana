import Link from 'next/link';
import type { Metadata } from 'next';
import { ProductShot } from '../../components/ProductShot';

export const metadata: Metadata = {
  title: 'Extension SDK',
  description: 'An approachable overview of the Zana Command Center extension SDK, host boundary, optional main module, and permission model.',
  alternates: { canonical: '/extensions/sdk/' }
};

const SDK_LAYERS = [
  ['Manifest', 'Declares identity, entry points, compatible API range, contributions, and requested permissions.'],
  ['Renderer entry', 'Returns a panel through activate({ React, host }); the host provides React and the supported ModuleHost surface.'],
  ['Optional main module', 'Handles capabilities that must execute outside the renderer through a brokered, permission-gated context.'],
  ['Contributions', 'Adds commands, project tabs, personas, teams, agent capabilities, or other declared extension surfaces.']
] as const;

export default function ExtensionSdkPage() {
  return (
    <>
      <section className="guide-hero">
        <div className="wrap">
          <div className="guide-hero-copy" data-reveal>
            <span className="eyebrow">SDK overview</span>
            <h1>Build against a stable host.<br /><span className="grad">Not app internals.</span></h1>
            <p>The extension SDK is the public contract between your TypeScript code and Zana. Renderer panels use a provided host surface; main-side work is brokered and scope-checked.</p>
            <div className="cta"><Link className="btn btn-primary btn-lg" href="/extensions/getting-started/">Start with a panel</Link><Link className="btn btn-ghost btn-lg" href="/docs/extensions-sdk-reference/">Open full SDK reference</Link></div>
          </div>
          <ProductShot id="sdk-main-module" priority />
        </div>
      </section>

      <section className="sdk-layers-section">
        <div className="wrap">
          <div className="section-head center" data-reveal><span className="eyebrow">The contract</span><h2>Four layers, each with a clear responsibility.</h2></div>
          <div className="sdk-layers" data-reveal-stagger>{SDK_LAYERS.map(([title, body], index) => <article key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{body}</p></article>)}</div>
        </div>
      </section>

      <section id="permissions" style={{ paddingTop: 0 }}>
        <div className="wrap"><div className="product-proof" data-reveal><div className="product-proof-copy"><span className="eyebrow">The permission model</span><h2>Declare intent. Get consent. Run within scope.</h2><p>An extension does not receive broad system access just because it ships a main module. The effective grant is derived from declared permissions and user consent, then enforced at each brokered call.</p><ul><li>Use the smallest permission set that makes the feature possible</li><li>Keep filesystem roots and network or executable scopes explicit</li><li>Treat a wider permission request as a product decision users can evaluate</li></ul><p style={{ marginTop: 20 }}><Link className="text-link" href="/docs/extensions-authoring/#permissions-are-enforced-for-disk-extensions-p3-b">Read scoped permission details <span aria-hidden="true">→</span></Link></p></div><ProductShot id="extension-consent" /></div></div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap"><div className="product-proof reverse" data-reveal><div className="product-proof-copy"><span className="eyebrow">Use the host surface</span><h2>Panels receive what they need from Zana.</h2><p>Renderer entries use the supplied React instance and ModuleHost. That keeps extensions aligned with the host lifecycle and prevents fragile imports of core implementation details.</p><ul><li>Read selected project context and launch sessions through the host</li><li>Use storage, cache, events, toasts, inbox actions, and external links</li><li>Call only your extension’s main-side capabilities through the host bridge</li></ul></div><ProductShot id="extension-panel-result" /></div></div>
      </section>

      <section className="guide-next-section"><div className="wrap"><div className="guide-next-card" data-reveal><div><span className="eyebrow">Go deeper</span><h2>The reference contains the exact types, events, and lifecycle behavior.</h2><p>Use it as the source of truth while implementing, and return to these visual guides when you need to orient a new contributor.</p></div><div className="guide-next-actions"><Link className="btn btn-primary" href="/docs/extensions-sdk-reference/">Read SDK reference</Link><Link className="btn btn-ghost" href="/docs/extensions-authoring/">Read authoring guide</Link></div></div></div></section>
    </>
  );
}
