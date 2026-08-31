import type { Metadata } from 'next';
import Link from 'next/link';
import { DocLayout } from './DocLayout';
import { DOCS, renderDoc } from '@/lib/docs';
import { AuroraGrid } from '../components/AuroraGrid';

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
      <section className="docs-hub aurora-host">
        <AuroraGrid beams={false} />
        <div className="wrap hub-hero">
          <div data-reveal>
            <span className="zcc-kicker">Documentation</span>
            <h1>Start with the task. Keep the reference close.</h1>
            <p>Guides for operating Zana, building plugins, and running a marketplace. Each path leads to the same maintained public reference used by the product.</p>
          </div>
          <div className="docs-hub-paths" data-reveal-stagger>
            <Link className="zcc-panel" href="/docs/getting-started/"><span>New to Zana</span><strong>Set up your first project <b aria-hidden="true">→</b></strong></Link>
            <Link className="zcc-panel" href="/docs/using-zana/"><span>Using Zana</span><strong>Operate projects and agents <b aria-hidden="true">→</b></strong></Link>
            <Link className="zcc-panel" href="/extensions/"><span>Build or install</span><strong>Open the plugins hub <b aria-hidden="true">→</b></strong></Link>
          </div>
        </div>
      </section>
      <DocLayout meta={meta} html={html} toc={toc} />
    </>
  );
}
