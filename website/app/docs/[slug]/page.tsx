import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { DocLayout } from '../DocLayout';
import { DOCS, getDoc, renderDoc } from '@/lib/docs';

/** Pre-render one static page per curated doc. */
export function generateStaticParams() {
  return DOCS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const meta = getDoc(slug);
  if (!meta) return { title: 'Docs' };
  const description = `${meta.title} — ${meta.group} documentation for Zana Command Center.`;
  return {
    title: `${meta.title} — Docs`,
    description,
    alternates: { canonical: `/docs/${slug}/` },
    openGraph: {
      title: `${meta.title} — Zana Command Center Docs`,
      description,
      url: `/docs/${slug}/`,
      type: 'article',
      images: ['/opengraph-image']
    }
  };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const meta = getDoc(slug);
  if (!meta) notFound();
  const { html, toc } = await renderDoc(meta);
  return <DocLayout meta={meta} html={html} toc={toc} />;
}
