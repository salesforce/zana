import Link from 'next/link';
import type { Metadata } from 'next';
import { AuroraGrid } from '../../components/AuroraGrid';
import { Icon, NextCard, ProofCard, SectionHead, Grad, styles as s, type IconName } from '../blocks';

export const metadata: Metadata = {
  title: 'Install plugins',
  description: 'Understand marketplace, local folder, git/npm, and editable-source plugin installation in Zana Command Center.',
  alternates: { canonical: '/extensions/install/' }
};

const METHOD_ICONS: IconName[] = ['store', 'folder', 'git', 'edit'];
const METHODS = [
  ['Marketplace', 'Use when the plugin is listed in an official or community catalog.', 'Discover the capability, inspect what it adds (skills, MCP servers), then confirm the full-trust install from Plugins → Browse.'],
  ['Local folder', 'Use during private development or team testing.', 'Choose a folder containing package.json with a zcc block. PluginService path-installs it; a failed reload keeps the last good generation.'],
  ['Git or npm pointer', 'Use when a registry is not part of the distribution path.', 'Install via git: or npm: sources. The marketplace lists pointers only — refresh never executes plugin code.'],
  ['Editable source', 'Use when you are actively authoring a plugin.', 'Keep source connected locally. zcc plugin dev watches, rebuilds, and reloads while the plugin stays full-trust in-process.']
] as const;

export default function ExtensionInstallPage() {
  return (
    <div className="zcc-page aurora-host">
      <AuroraGrid beams={false} />
      <section className="hub-hero" style={{ paddingBottom: 8 }}>
        <div className="wrap">
          <div data-reveal>
            <span className="zcc-kicker">Install plugins</span>
            <h1>Choose the source. <span className={s.grad}>Zana records provenance.</span></h1>
            <p>Plugins use one installation boundary whether they arrive from an official catalog, a community git marketplace, or a local folder. After install they run in-process on the server — confirm that full-trust step before you continue.</p>
            <div className="zcc-actions">
              <Link className="zcc-btn zcc-btn-primary" href="/marketplace/">Browse marketplace</Link>
              <Link className="zcc-btn zcc-btn-ghost" href="/extensions/getting-started/">Build one instead</Link>
            </div>
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 16 }}>
        <div className="wrap">
          <SectionHead eyebrow="Four routes, one trust boundary">Pick the distribution model <Grad>that fits the work.</Grad></SectionHead>
          <div className={s.methods} data-reveal-stagger>
            {METHODS.map(([title, use, description], i) => (
              <article className={`${s.card} ${s.method}`} key={title}>
                <span className={s.tile}><Icon name={METHOD_ICONS[i]} size={26} /></span>
                <h3>{title}</h3>
                <strong className={s.use}>{use}</strong>
                <p>{description}</p>
              </article>
            ))}
          </div>
          <p className={s.trustBar} data-reveal><Icon name="shield" size={16} /> All four routes end at the same full-trust confirm.</p>
        </div>
      </section>

      <section style={{ paddingTop: 8 }}>
        <div className="wrap">
          <ProofCard
            eyebrow="Install is the trust gate"
            title="Confirm full trust before the plugin loads."
            icon="key"
            body="Plugins run in-process on the server after install. Zana lists skills, MCP servers, and extra the grant would add, then you confirm."
            items={[
              'Official catalogs install offline',
              'Community catalogs are npm/git pointers — refresh never executes plugin code',
              'A failed reload keeps the last good generation'
            ]}
            link={{ href: '/extensions/sdk/#permissions', label: 'See how trust works →' }}
          />
        </div>
      </section>

      <section style={{ paddingTop: 8, paddingBottom: 64 }}>
        <div className="wrap">
          <NextCard
            eyebrow="Need deeper detail?"
            title="Use the reference for exact install and publishing commands."
            body="The public docs retain the detailed artifact, registry, API, and plugin contract."
            actions={<>
              <Link className="zcc-btn zcc-btn-primary" href="/docs/extensions-authoring/#install--dev-loop">Open authoring install guide</Link>
              <Link className="zcc-btn zcc-btn-ghost" href="/marketplace/">Browse the marketplace</Link>
            </>}
          />
        </div>
      </section>
    </div>
  );
}
