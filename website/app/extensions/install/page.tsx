import Link from 'next/link';
import type { Metadata } from 'next';
import { AuroraGrid } from '../../components/AuroraGrid';

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
    <div className="zcc-page aurora-host">
      <AuroraGrid beams={false} />
      <section className="hub-hero" style={{ paddingBottom: 8 }}>
        <div className="wrap">
          <div data-reveal>
            <span className="zcc-kicker">Install plugins</span>
            <h1>Choose the source. Zana records provenance.</h1>
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
          <div className="section-head" data-reveal>
            <span className="zcc-kicker">Four routes, one trust boundary</span>
            <h2>Pick the distribution model that fits the work.</h2>
          </div>
          <div className="install-methods" data-reveal-stagger>
            {METHODS.map(([title, use, description]) => (
              <article className="zcc-panel" key={title}>
                <h3>{title}</h3>
                <strong>{use}</strong>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 8 }}>
        <div className="wrap">
          <div className="proof" data-reveal>
            <span className="zcc-kicker">Install is the trust gate</span>
            <h2>Confirm full trust before the plugin loads.</h2>
            <p>Plugins run in-process on the server after install. Zana lists skills, MCP servers, and extra the grant would add, then you confirm.</p>
            <ul>
              <li>Official catalogs install offline</li>
              <li>Community catalogs are npm/git pointers — refresh never executes plugin code</li>
              <li>A failed reload keeps the last good generation</li>
            </ul>
            <p style={{ marginTop: 16 }}><Link className="text-link" href="/extensions/sdk/#permissions">See how trust works →</Link></p>
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 8, paddingBottom: 64 }}>
        <div className="wrap">
          <div className="next-card zcc-panel" data-reveal>
            <div>
              <span className="zcc-kicker">Need deeper detail?</span>
              <h2>Use the reference for exact install and publishing commands.</h2>
              <p>The public docs retain the detailed artifact, registry, API, and plugin contract.</p>
            </div>
            <div className="next-actions">
              <Link className="zcc-btn zcc-btn-primary" href="/docs/extensions-authoring/#install--dev-loop">Open authoring install guide</Link>
              <Link className="zcc-btn zcc-btn-ghost" href="/marketplace/">Browse the marketplace</Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
