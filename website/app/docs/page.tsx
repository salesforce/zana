import type { Metadata } from 'next';
import Link from 'next/link';
import { DocLayout } from './DocLayout';
import { DOCS, renderDoc } from '@/lib/docs';

export const metadata: Metadata = {
  title: 'Documentation',
  description: 'Guides and reference for Zana Command Center — the CLI, extensions, and release hosting.',
  alternates: { canonical: '/docs/' },
  openGraph: {
    title: 'Documentation — Zana Command Center',
    description: 'Guides and reference: the zcc CLI, extensions, and release hosting.',
    url: '/docs/',
    type: 'website',
    images: ['/opengraph-image']
  }
};

/** The docs landing renders the first curated entry inline (static-export safe). */
export default async function DocsIndex() {
  const meta = DOCS[0];
  const { html, toc } = await renderDoc(meta);
  return (
    <>
      <section className="docs-hub-hero">
        <div className="wrap">
          <div className="docs-hub-hero-copy" data-reveal>
            <span className="eyebrow">Documentation</span>
            <h1>Start with the task.<br /><span className="grad">Keep the reference close.</span></h1>
            <p>Guides for operating Zana, building extensions, and running a marketplace. Each path leads to the same maintained public reference used by the product.</p>
          </div>
          <div className="docs-hub-paths" data-reveal-stagger>
            <Link href="/docs/getting-started/"><span>New to Zana</span><strong>Set up your first project <b aria-hidden="true">→</b></strong></Link>
            <Link href="/how-it-works/"><span>Understand the product</span><strong>Take the visual tour <b aria-hidden="true">→</b></strong></Link>
            <Link href="/extensions/"><span>Build or install</span><strong>Open the extensions hub <b aria-hidden="true">→</b></strong></Link>
          </div>
        </div>
      </section>
      <DocLayout meta={meta} html={html} toc={toc} />
    </>
  );
}
