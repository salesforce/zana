import Link from 'next/link';
import type { Metadata } from 'next';
import { ProductShot } from '../../components/ProductShot';

export const metadata: Metadata = {
  title: 'Plugin SDK',
  description: 'An approachable overview of @zana-ai/zcc-plugin-sdk: package.json zcc, app slots, server APIs, and full-trust install.',
  alternates: { canonical: '/extensions/sdk/' }
};

const SDK_LAYERS = [
  ['Manifest', 'Declares identity in package.json → zcc: name, app/server entries, skills, MCP, and engines.zcc.'],
  ['App slots', 'definePluginApp registers nav panels and other slots. The host React instance is globalThis.__ZCC_HOST_REACT__.'],
  ['Server API', 'export default function plugin(zcc) receives ZccPluginApi in-process on the server. Host-daemon tokens never reach the plugin.'],
  ['Contributions', 'Adds skills, MCP servers, settings, and extra metadata declared in the zcc block.']
] as const;

export default function ExtensionSdkPage() {
  return (
    <>
      <section className="guide-hero">
        <div className="wrap">
          <div className="guide-hero-copy" data-reveal>
            <span className="eyebrow">SDK overview</span>
            <h1>Build against a stable host.<br /><span className="grad">Not app internals.</span></h1>
            <p>The plugin SDK is the public contract between your TypeScript package and Zana. After a loud full-trust confirm, plugins load in-process on the server and register UI slots in the app.</p>
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
        <div className="wrap"><div className="product-proof" data-reveal><div className="product-proof-copy"><span className="eyebrow">Trust at install</span><h2>Full-trust in-process. Confirm it out loud.</h2><p>Plugins are not sandboxed Electron guests. The control is install/enable, exact version pinning, engines.zcc, and a loud confirm that lists skills, MCP, and extra the grant would add.</p><ul><li>Official catalogs install offline; community catalogs are npm/git pointers only</li><li>A failed reload keeps the last good generation running</li><li>Host-daemon tokens and signing keys never reach a plugin</li></ul><p style={{ marginTop: 20 }}><Link className="text-link" href="/docs/extensions-authoring/">Read the authoring guide <span aria-hidden="true">→</span></Link></p></div><ProductShot id="extension-consent" /></div></div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap"><div className="product-proof reverse" data-reveal><div className="product-proof-copy"><span className="eyebrow">Use the host surface</span><h2>Panels receive what they need from Zana.</h2><p>App entries register slots instead of importing core modules. That keeps plugins aligned with the host lifecycle and prevents fragile imports of implementation details.</p><ul><li>Register nav panels, homepage sections, and settings with definePluginApp</li><li>Use storage, RPC, realtime, and schedules through the SDK</li><li>Keep renderer input untrusted; the server still confines paths</li></ul></div><ProductShot id="extension-panel-result" /></div></div>
      </section>

      <section className="guide-next-section"><div className="wrap"><div className="guide-next-card" data-reveal><div><span className="eyebrow">Go deeper</span><h2>The reference contains the exact types, events, and lifecycle behavior.</h2><p>Use it as the source of truth while implementing, and return to these visual guides when you need to orient a new contributor.</p></div><div className="guide-next-actions"><Link className="btn btn-primary" href="/docs/extensions-sdk-reference/">Read SDK reference</Link><Link className="btn btn-ghost" href="/docs/extensions-authoring/">Read authoring guide</Link></div></div></div></section>
    </>
  );
}
