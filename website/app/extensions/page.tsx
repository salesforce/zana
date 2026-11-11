import Link from 'next/link';
import type { Metadata } from 'next';
import { AuroraGrid } from '../components/AuroraGrid';
import { PluginOverview } from '../components/BrandStories';
import { PluginGuideMap } from '../components/plugin-guide/PluginGuideMap';
import { Icon, ProofCard, SectionHead, Grad, styles as s, type IconName } from './blocks';

export const metadata: Metadata = {
  title: 'Plugins',
  description:
    'Install and author Zana Command Center plugins. Manifests live in package.json, load in-process on the server, and register UI slots in the app.',
  alternates: { canonical: '/extensions/' },
  openGraph: {
    title: 'Plugins for Zana Command Center',
    description: 'Install new capabilities or build your own with @zana-ai/zcc-plugin-sdk.',
    url: '/extensions/',
    type: 'website',
    images: ['/opengraph-image']
  }
};

const PATH_ICONS: IconName[] = ['download', 'code', 'layers'];
const PATHS = [
  {
    label: 'Install',
    title: 'Install a plugin',
    body: 'Use the marketplace for published capabilities, or install a folder, git, or npm source when you already have the plugin.',
    href: '/extensions/install/',
    action: 'See installation paths'
  },
  {
    label: 'Author',
    title: 'Build your first panel',
    body: 'Start with a TypeScript plugin that registers a nav panel. Review and confirm full trust before installing.',
    href: '/extensions/getting-started/',
    action: 'Start the quickstart'
  },
  {
    label: 'SDK',
    title: 'Learn the SDK boundary',
    body: 'Use @zana-ai/zcc-plugin-sdk for slots on the app side and ZccPluginApi on the server. Host-daemon tokens stay on the server.',
    href: '/extensions/sdk/',
    action: 'Explore the SDK'
  }
];

export default function ExtensionsPage() {
  return (
    <div className="zcc-page aurora-host">
      <AuroraGrid beams={false} />
      <section className="plugin-brand-intro">
        <div className="wrap fairy-split">
          <div className="fairy-story-copy">
            <p className="fairy-kicker lavender">Built to become yours</p>
            <h1>Your workflow.<br /><span>Your kind of magic.</span></h1>
            <p>Add tools, views, and skills that fit the way you work. Find a plugin in the marketplace, or bring your own idea to life with the Zana SDK.</p>
            <div className="zcc-actions">
              <Link className="zcc-btn zcc-btn-primary zcc-btn-lg" href="/marketplace/">Find a plugin ↗</Link>
              <Link className="zcc-btn zcc-btn-ghost zcc-btn-lg" href="/extensions/getting-started/">Build a plugin →</Link>
            </div>
            <a className="text-link plugin-art-link" href="/artwork/zana-plugins.svg" target="_blank" rel="noopener noreferrer">Explore how plugins work ↗</a>
          </div>
          <PluginOverview />
        </div>
      </section>

      <section id="plugin-guide" style={{ paddingTop: 12 }}>
        <div className="wrap">
          <div className="section-head" data-reveal>
            <span className="zcc-kicker">Plugin Guide</span>
            <h2>Every surface a plugin can own.</h2>
            <p className="section-lede">
              Explore where your plugin can appear. Each annotated view connects a product surface to its SDK contract.
            </p>
          </div>
          <PluginGuideMap />
          <p style={{ marginTop: 16 }} data-reveal>
            <Link className="text-link" href="/docs/extensions-sdk-reference/">Read the matching SDK reference →</Link>
          </p>
        </div>
      </section>

      <section style={{ paddingTop: 12 }}>
        <div className="wrap">
          <SectionHead eyebrow="Choose your path">Install it. <Grad>Build it.</Grad> Extend it.</SectionHead>
          <ol className={s.paths} data-reveal-stagger>
            {PATHS.map((path, i) => (
              <li key={path.href}>
                <Link className={`${s.card} ${s.path}`} href={path.href}>
                  <span className={s.tag}>{path.label}</span>
                  <span className={s.tile}><Icon name={PATH_ICONS[i]} size={26} /></span>
                  <h3>{path.title}</h3>
                  <p>{path.body}</p>
                  <span className={s.go}>{path.action} <Icon name="arrow" size={16} /></span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section style={{ paddingTop: 8 }}>
        <div className="wrap">
          <ProofCard
            eyebrow="Install with confidence"
            title="Understand what you install."
            icon="shield"
            body="Marketplace entries describe what a plugin contributes. Official catalogs install offline; community catalogs list npm/git pointers only. After install, plugins run in-process on the server."
            items={[
              'Install published plugins from the same catalog the app reads',
              'Use a local folder, git, or npm source for private development workflows',
              'Confirm the full-trust install before the plugin loads'
            ]}
            link={{ href: '/extensions/install/', label: 'Read the install guide →' }}
          />
        </div>
      </section>

      <section style={{ paddingTop: 8 }}>
        <div className="wrap">
          <ProofCard
            eyebrow="Your development loop"
            title="Build locally. Reload live. Keep core untouched."
            icon="refresh"
            body={<>A local plugin is an ordinary disk plugin with an editable source folder. Author{' '}<code>package.json</code> <code>zcc</code>, then <code>zcc plugin dev</code> watches, rebuilds, and reloads.</>}
            items={[
              'Use @zana-ai/zcc-plugin-sdk instead of internal app modules',
              'Register app.slots.navPanel and optional server hooks',
              'A failed reload keeps the last good generation'
            ]}
            link={{ href: '/extensions/getting-started/', label: 'Follow the five-minute quickstart →' }}
          />
        </div>
      </section>

      <section style={{ paddingTop: 8, paddingBottom: 64 }}>
        <div className="wrap">
          <SectionHead eyebrow="Reference" lede="Use the task guides for a focused workflow, then move into the maintained reference for contracts, permissions, lifecycle details, and publishing.">
            Short path to action. <Grad>Deep documentation</Grad> behind it.
          </SectionHead>
          <ul className={s.refGrid} data-reveal-stagger>
            {[
              ['/docs/extensions-quickstart/', 'Build your first plugin', 'seed'],
              ['/docs/extensions-authoring/', 'Plugin authoring guide', 'edit'],
              ['/docs/extensions-sdk-reference/', 'SDK reference', 'book'],
              ['/docs/extensions/', 'Plugin architecture overview', 'box']
            ].map(([href, label, icon]) => (
              <li key={href}>
                <Link className={s.card} href={href}>
                  <span className={s.tile}><Icon name={icon as IconName} /></span>
                  <span>{label}</span>
                  <span className={s.go}><Icon name="arrow" size={16} /></span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
