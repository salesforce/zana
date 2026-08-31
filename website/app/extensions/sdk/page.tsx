import Link from 'next/link';
import type { Metadata } from 'next';
import { AuroraGrid } from '../../components/AuroraGrid';

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
    <div className="zcc-page aurora-host">
      <AuroraGrid beams={false} />
      <section className="hub-hero" style={{ paddingBottom: 8 }}>
        <div className="wrap">
          <div data-reveal>
            <span className="zcc-kicker">SDK overview</span>
            <h1>Build against a stable host. Not app internals.</h1>
            <p>The plugin SDK is the public contract between your TypeScript package and Zana. After a loud full-trust confirm, plugins load in-process on the server and register UI slots in the app.</p>
            <div className="zcc-actions">
              <Link className="zcc-btn zcc-btn-primary" href="/extensions/getting-started/">Start with a panel</Link>
              <Link className="zcc-btn zcc-btn-ghost" href="/docs/extensions-sdk-reference/">Open full SDK reference</Link>
            </div>
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 16 }}>
        <div className="wrap">
          <div className="section-head" data-reveal>
            <span className="zcc-kicker">The contract</span>
            <h2>Four layers, each with a clear responsibility.</h2>
          </div>
          <div className="sdk-layers" data-reveal-stagger>
            {SDK_LAYERS.map(([title, body], index) => (
              <article className="zcc-panel" key={title}>
                <span>0{index + 1}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="permissions" style={{ paddingTop: 8 }}>
        <div className="wrap">
          <div className="proof" data-reveal>
            <span className="zcc-kicker">Trust at install</span>
            <h2>Full-trust in-process. Confirm it out loud.</h2>
            <p>Plugins are not sandboxed Electron guests. The control is install/enable, exact version pinning, engines.zcc, and a loud confirm that lists skills, MCP, and extra the grant would add.</p>
            <ul>
              <li>Official catalogs install offline; community catalogs are npm/git pointers only</li>
              <li>A failed reload keeps the last good generation running</li>
              <li>Host-daemon tokens and signing keys never reach a plugin</li>
            </ul>
            <p style={{ marginTop: 16 }}><Link className="text-link" href="/docs/extensions-authoring/">Read the authoring guide →</Link></p>
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 8 }}>
        <div className="wrap">
          <div className="proof" data-reveal>
            <span className="zcc-kicker">Use the host surface</span>
            <h2>Panels receive what they need from Zana.</h2>
            <p>App entries register slots instead of importing core modules. That keeps plugins aligned with the host lifecycle and prevents fragile imports of implementation details.</p>
            <ul>
              <li>Register nav panels, homepage sections, and settings with definePluginApp</li>
              <li>Use storage, RPC, realtime, and schedules through the SDK</li>
              <li>Keep renderer input untrusted; the server still confines paths</li>
            </ul>
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 8, paddingBottom: 64 }}>
        <div className="wrap">
          <div className="next-card zcc-panel" data-reveal>
            <div>
              <span className="zcc-kicker">Go deeper</span>
              <h2>The reference contains the exact types, events, and lifecycle behavior.</h2>
              <p>Use it as the source of truth while implementing, and return to these guides when you need to orient a new contributor.</p>
            </div>
            <div className="next-actions">
              <Link className="zcc-btn zcc-btn-primary" href="/docs/extensions-sdk-reference/">Read SDK reference</Link>
              <Link className="zcc-btn zcc-btn-ghost" href="/docs/extensions-authoring/">Read authoring guide</Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
