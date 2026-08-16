import Link from 'next/link';
import { DocsSidebar } from './DocsSidebar';
import { DocsEnhancer } from './DocsEnhancer';
import { DocsSearch } from './DocsSearch';
import { getDocSiblings, type DocMeta, type TocItem } from '@/lib/docs';
import { buildSearchIndex } from '@/lib/search-index';

/** Right-hand "On this page" table of contents (scroll-spied client-side). */
function DocsToc({ toc }: { toc: TocItem[] }) {
  if (toc.length < 2) return <div className="docs-toc" aria-hidden="true" />;
  return (
    <nav className="docs-toc" aria-label="On this page">
      <div className="toc-label">On this page</div>
      {toc.map((t) => (
        <a key={t.id} href={`#${t.id}`} className={t.level === 3 ? 'h3' : ''} title={t.text}>
          {t.text}
        </a>
      ))}
    </nav>
  );
}

/** Prev / next pager in manifest order. */
function DocsPager({ slug }: { slug: string }) {
  const { prev, next } = getDocSiblings(slug);
  if (!prev && !next) return null;
  return (
    <nav className="docs-pager" aria-label="Pagination">
      {prev ? (
        <Link href={`/docs/${prev.slug}/`} className="prev">
          <span className="dir">← Previous</span>
          <span className="ttl">{prev.title}</span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={`/docs/${next.slug}/`} className="next">
          <span className="dir">Next →</span>
          <span className="ttl">{next.title}</span>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

function DocsNextStep({ slug }: { slug: string }) {
  const nextSteps: Partial<Record<string, { title: string; body: string; href: string; action: string }>> = {
    'getting-started': {
      title: 'See the operating model',
      body: 'Follow the visual walkthrough for the project, session, Agents board, and Inbox loop.',
      href: '/how-it-works/',
      action: 'Take the product tour'
    },
    'using-zana': {
      title: 'Explore every product surface',
      body: 'Use the visual feature catalog to find the right workflow for your next task.',
      href: '/features/',
      action: 'Explore features'
    },
    'extensions-quickstart': {
      title: 'Use the visual extension workflow',
      body: 'See the scaffold-to-reload loop, then return here for the exact code and commands.',
      href: '/extensions/getting-started/',
      action: 'Open extension quickstart'
    },
    'extensions-authoring': {
      title: 'Choose an extension task',
      body: 'The extension hub separates installation, first-panel authoring, and the SDK boundary.',
      href: '/extensions/',
      action: 'Open extension hub'
    },
    'extensions-sdk-reference': {
      title: 'Review the SDK as a workflow',
      body: 'See how the manifest, renderer, optional main module, and permissions fit together.',
      href: '/extensions/sdk/',
      action: 'Open SDK overview'
    }
  };
  const step = nextSteps[slug];
  if (!step) return null;
  return (
    <aside className="docs-next-step" aria-label="Suggested next step">
      <div><span>Suggested next step</span><h2>{step.title}</h2><p>{step.body}</p></div>
      <Link className="btn btn-ghost" href={step.href}>{step.action} <span aria-hidden="true">→</span></Link>
    </aside>
  );
}

export async function DocLayout({ meta, html, toc }: { meta: DocMeta; html: string; toc: TocItem[] }) {
  const searchIndex = await buildSearchIndex();
  return (
    <div className="wrap">
      {/* ⌘K search palette — index built at build time, hydrated client-side */}
      <DocsSearch index={searchIndex} />
      <div className="docs-shell">
        <div className="docs-nav-wrap">
          <DocsSidebar active={meta.slug} />
        </div>

        <div>
          <div className="docs-breadcrumb">
            <Link href="/docs/">Docs</Link>
            <span className="sep">/</span>
            <span>{meta.group}</span>
            <span className="sep">/</span>
            <span style={{ color: 'var(--muted)' }}>{meta.title}</span>
          </div>

          {/* mobile: sidebar collapses to a select */}
          <DocsSidebar active={meta.slug} mobile />

           <article className="prose" dangerouslySetInnerHTML={{ __html: html }} />
           <DocsNextStep slug={meta.slug} />
           <DocsPager slug={meta.slug} />
          <DocsEnhancer slug={meta.slug} />
        </div>

        <DocsToc toc={toc} />
      </div>
    </div>
  );
}
