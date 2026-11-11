import type { Metadata } from 'next';
import Link from 'next/link';
import { DocLayout } from './DocLayout';
import { DOCS, renderDoc } from '../../lib/docs';
import { AuroraGrid } from '../components/AuroraGrid';
import styles from './docs-hub.module.css';

const ICONS: Record<string, string> = {
  rocket: 'M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2M12 15l-3-3a22 22 0 0 1 2-4 12 12 0 0 1 10-5c0 3-1.5 8-5 11a22 22 0 0 1-4 2zM9 12H4s.5-3 2-4c1.5-1 5 0 5 0M12 15v5s3-.5 4-2c1-1.5 0-5 0-5',
  terminal: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM7 10l3 2-3 2M13 15h4',
  devices: 'M3 6h13v9H3zM1 19h17M19 9h3v10h-3z',
  plugin: 'M9 3v4M15 3v4M6 7h12v5a6 6 0 0 1-12 0zM12 18v3'
};
const PathIcon = ({ name }: { name: keyof typeof ICONS }) => (
  <span className={styles.tile} aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[name]} /></svg>
  </span>
);

export const metadata: Metadata = {
  title: 'Documentation',
  description: 'Guides and reference for Zana Command Center — getting started, the CLI, and plugins.',
  alternates: { canonical: '/docs/' },
  openGraph: {
    title: 'Documentation — Zana Command Center',
    description: 'Guides and reference: getting started, the zcc CLI, and plugins.',
    url: '/docs/',
    type: 'website',
    images: ['/opengraph-image']
  }
};

export default async function DocsIndex() {
  const meta = DOCS[0];
  const { html, toc } = await renderDoc(meta);
  return (
    <>
      <section className={`docs-hub aurora-host ${styles.hub}`}>
        <AuroraGrid beams={false} />
        <div className="wrap hub-hero">
          <div data-reveal>
            <span className="zcc-kicker">Documentation</span>
            <h1 className={styles.title}>Start with the task. <span>Keep the reference close.</span></h1>
            <p>Guides for operating Zana, building plugins, and running a marketplace. Each path leads to the same maintained public reference used by the product.</p>
            <Link className="text-link" href="/docs/architecture/">Explore the architecture <span aria-hidden="true">→</span></Link>
          </div>
          <div className={`docs-hub-paths ${styles.paths}`} data-reveal-stagger>
            <Link className={`zcc-panel ${styles.path}`} href="/docs/getting-started/"><PathIcon name="rocket" /><span>New to Zana</span><strong>Set up your first project <b aria-hidden="true">→</b></strong></Link>
            <Link className={`zcc-panel ${styles.path}`} href="/docs/using-zana/"><PathIcon name="terminal" /><span>Using Zana</span><strong>Operate projects and agents <b aria-hidden="true">→</b></strong></Link>
            <Link className={`zcc-panel ${styles.path}`} href="/docs/multiple-devices/"><PathIcon name="devices" /><span>Multiple machines</span><strong>Connect a second laptop <b aria-hidden="true">→</b></strong></Link>
            <Link className={`zcc-panel ${styles.path}`} href="/extensions/"><PathIcon name="plugin" /><span>Build or install</span><strong>Open the plugins hub <b aria-hidden="true">→</b></strong></Link>
          </div>
        </div>
      </section>
      <DocLayout meta={meta} html={html} toc={toc} />
    </>
  );
}
