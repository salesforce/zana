import Link from 'next/link';
import type { Metadata } from 'next';
import { AuroraGrid } from '../../components/AuroraGrid';
import { Icon, ProofCard, NextCard, SectionHead, Grad, styles as s, type IconName } from '../blocks';

export const metadata: Metadata = {
  title: 'Plugin SDK',
  description: 'An approachable overview of @zana-ai/zcc-plugin-sdk: package.json zcc, app slots, server APIs, and full-trust install.',
  alternates: { canonical: '/extensions/sdk/' }
};

const LAYER_ICONS: IconName[] = ['code', 'panel', 'terminal', 'plug'];
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
            <h1>Build against a stable host. <span className={s.grad}>Not app internals.</span></h1>
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
          <SectionHead eyebrow="The contract">Four layers, <Grad>each with a clear responsibility.</Grad></SectionHead>
          <ol className={s.layers} data-reveal-stagger>
            {SDK_LAYERS.map(([title, body], index) => (
              <li key={title}>
                <article className={`${s.card} ${s.layer}`}>
                  <span className={s.tile}><Icon name={LAYER_ICONS[index]} size={26} /></span>
                  <div>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </div>
                  <span className={s.num}>0{index + 1}</span>
                </article>
              </li>
            ))}
          </ol>
          <p style={{ marginTop: 20, textAlign: 'center' }} data-reveal>
            <Link className="text-link" href="/extensions/#plugin-guide">Open the Plugin Guide map →</Link>
          </p>
        </div>
      </section>

      <section id="permissions" style={{ paddingTop: 8 }}>
        <div className="wrap">
          <ProofCard
            eyebrow="Trust at install"
            title="Full-trust in-process. Confirm it out loud."
            icon="shield"
            body="Plugins are not sandboxed Electron guests. The control is install/enable, exact version pinning, engines.zcc, and a loud confirm that lists skills, MCP, and extra the grant would add."
            items={[
              'Official catalogs install offline; community catalogs are npm/git pointers only',
              'A failed reload keeps the last good generation running',
              'Host-daemon tokens and signing keys never reach a plugin'
            ]}
            link={{ href: '/docs/extensions-authoring/', label: 'Read the authoring guide →' }}
          />
        </div>
      </section>

      <section style={{ paddingTop: 8 }}>
        <div className="wrap">
          <ProofCard
            eyebrow="Use the host surface"
            title="Panels receive what they need from Zana."
            icon="layers"
            body="App entries register slots instead of importing core modules. That keeps plugins aligned with the host lifecycle and prevents fragile imports of implementation details."
            items={[
              'Register nav panels, homepage sections, and settings with definePluginApp',
              'Use storage, RPC, realtime, and schedules through the SDK',
              'Keep renderer input untrusted; the server still confines paths'
            ]}
          />
        </div>
      </section>

      <section style={{ paddingTop: 8, paddingBottom: 64 }}>
        <div className="wrap">
          <NextCard
            eyebrow="Go deeper"
            title="The reference contains the exact types, events, and lifecycle behavior."
            body="Use it as the source of truth while implementing, and return to these guides when you need to orient a new contributor."
            actions={<>
              <Link className="zcc-btn zcc-btn-primary" href="/docs/extensions-sdk-reference/">Read SDK reference</Link>
              <Link className="zcc-btn zcc-btn-ghost" href="/docs/extensions-authoring/">Read authoring guide</Link>
            </>}
          />
        </div>
      </section>
    </div>
  );
}
