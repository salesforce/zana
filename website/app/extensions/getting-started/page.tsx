import Link from 'next/link';
import type { Metadata } from 'next';
import { AuroraGrid } from '../../components/AuroraGrid';
import { Icon, ProofCard, NextCard, SectionHead, Grad, styles as s, type IconName } from '../blocks';

export const metadata: Metadata = {
  title: 'Build your first plugin',
  description: 'Scaffold a package.json zcc plugin, run zcc plugin dev, and see the panel reload inside the app.',
  alternates: { canonical: '/extensions/getting-started/' }
};

const STEP_ICONS: IconName[] = ['seed', 'terminal', 'panel', 'refresh', 'eye'];
const STEPS = [
  ['1', 'Seed a thread', 'Plugins → New plugin (or Browse → Create a plugin) inserts “Create a new zcc plugin that …”. Send it from the current project — not a dedicated Extensions folder. Folder/git/npm install stays install, not create.'],
  ['2', 'Scaffold, install, iterate', 'The agent runs `zcc plugin new hello --app`, then `cd zcc-plugin-hello`, `zcc plugin install .`, and `zcc plugin dev`. That writes package.json zcc, server.ts, and app.tsx.'],
  ['3', 'Return a panel', 'Default-export definePluginApp and register app.slots.navPanel. The host React instance is globalThis.__ZCC_HOST_REACT__.'],
  ['4', 'Watch and reload', '`zcc plugin dev` rebuilds the app and reloads. Path installs load server.ts from source. Install an existing tree from Plugins → Browse (folder, git, or npm).'],
  ['5', 'Reload and refine', 'A failed reload keeps the last good generation. Plugins are full-trust in-process on the server after a loud confirm.']
] as const;

const MANIFEST = `{
  "name": "zcc-plugin-hello",
  "engines": { "zcc": ">=1.0.0", "zccPluginSdk": ">=0.1.0" },
  "zcc": {
    "name": "Hello",
    "app": "./app.tsx",
    "server": "./server.ts",
    "skills": ["skills"]
  }
}`;

export default function ExtensionGettingStartedPage() {
  return (
    <div className="zcc-page aurora-host">
      <AuroraGrid beams={false} />
      <section className="hub-hero" style={{ paddingBottom: 8 }}>
        <div className="wrap">
          <div data-reveal>
            <span className="zcc-kicker">Plugin quickstart</span>
            <h1>A working panel in <span className={s.grad}>five focused steps.</span></h1>
            <p>Build a React panel that runs inside Zana using <code>@zana-ai/zcc-plugin-sdk</code>. Plugins are full-trust after install — confirm each install, and keep host-daemon tokens on the server.</p>
            <div className="zcc-actions">
              <a className="zcc-btn zcc-btn-primary" href="#steps">Start building</a>
              <Link className="zcc-btn zcc-btn-ghost" href="/extensions/sdk/">Understand the SDK</Link>
            </div>
          </div>
        </div>
      </section>

      <div className="wrap">
        <div className={`${s.card} ${s.prereq}`} data-reveal>
          <span className={s.tile}><Icon name="check" /></span>
          <strong>Before you begin</strong>
          <span className="t" style={{ flex: '1 1 260px', color: 'var(--muted-2)' }}>Node 20+, a local Zana installation, and a working TypeScript environment.</span>
          <Link href="/download/">Get Zana →</Link>
        </div>
      </div>

      <section id="steps">
        <div className="wrap">
          <SectionHead eyebrow="The build loop" lede={<>Everything begins with <code>package.json</code> <code>zcc</code>. The host owns slots, reload, and the full-trust install confirm.</>}>
            Small surface area, <Grad>fast feedback.</Grad>
          </SectionHead>
          <ol className={s.steps} data-reveal-stagger>
            {STEPS.map(([number, title, body], i) => (
              <li key={number}>
                <span className={s.stepNode}><Icon name={STEP_ICONS[i]} size={24} /><span className={s.stepNum}>{number}</span></span>
                <div className={`${s.card} ${s.stepBody}`}><h3>{title}</h3><p>{body}</p></div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section style={{ paddingTop: 8 }}>
        <div className="wrap proof-split">
          <div data-reveal>
            <span className={s.tile}><Icon name="code" size={26} /></span>
            <p className={s.eyebrowLeft}>The starting manifest</p>
            <h2 style={{ margin: '0 0 12px', letterSpacing: '-.04em' }}>Declare the smallest useful plugin.</h2>
            <p className={s.body}>The contract lives in <code>package.json</code> <code>zcc</code>. Start with a panel, then add skills or MCP only when you have a concrete need. Install is the full-trust confirm.</p>
            <Link className={s.link} href="/docs/extensions-authoring/">Read the manifest contract →</Link>
          </div>
          <pre className="guide-code"><code>{MANIFEST}</code></pre>
        </div>
      </section>

      <section style={{ paddingTop: 8 }}>
        <div className="wrap">
          <ProofCard
            eyebrow="A live local loop"
            title="Keep the source editable and the result visible."
            icon="refresh"
            body="Once the folder is connected as a local source, build changes can refresh the installed artifact without an application restart."
            items={[
              'Source remains in your working directory',
              'zcc plugin dev watches, rebuilds, and reloads',
              'A failed reload keeps the last good generation'
            ]}
          />
        </div>
      </section>

      <section style={{ paddingTop: 8, paddingBottom: 64 }}>
        <div className="wrap">
          <NextCard
            eyebrow="Continue when ready"
            title="From a panel to a complete integration."
            body="Add project tabs, skills, MCP servers, settings, or extra metadata as the plugin earns the extra complexity."
            actions={<>
              <Link className="zcc-btn zcc-btn-primary" href="/extensions/sdk/">Explore the SDK</Link>
              <Link className="zcc-btn zcc-btn-ghost" href="/docs/extensions-quickstart/">Read the canonical quickstart</Link>
            </>}
          />
        </div>
      </section>
    </div>
  );
}
