import type { Metadata } from 'next';
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
  return <DocLayout meta={meta} html={html} toc={toc} />;
}
