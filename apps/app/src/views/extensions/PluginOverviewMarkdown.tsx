import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import ReactMarkdown, { type Components, type UrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const ALLOWED_ELEMENTS = [
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'li',
  'ol',
  'p',
  'pre',
  'strong',
  'ul'
];

function httpsOnly(url: string): string | null {
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

const overviewUrlTransform: UrlTransform = (url) => httpsOnly(url) ?? '';

function OverviewLink({ children, href }: ComponentPropsWithoutRef<'a'>) {
  const safeHref = href === undefined ? null : httpsOnly(href);
  if (safeHref === null) return <span>{children}</span>;
  return (
    <a href={safeHref} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function OverviewHeading({ children, minor = false }: { children?: ReactNode; minor?: boolean }) {
  const Tag = minor ? 'h4' : 'h3';
  return <Tag className="ext-plugin-overview-heading">{children}</Tag>;
}

const OVERVIEW_COMPONENTS: Components = {
  a: OverviewLink,
  h1: ({ children }) => <OverviewHeading>{children}</OverviewHeading>,
  h2: ({ children }) => <OverviewHeading>{children}</OverviewHeading>,
  h3: ({ children }) => <OverviewHeading>{children}</OverviewHeading>,
  h4: ({ children }) => <OverviewHeading minor>{children}</OverviewHeading>,
  h5: ({ children }) => <OverviewHeading minor>{children}</OverviewHeading>,
  h6: ({ children }) => <OverviewHeading minor>{children}</OverviewHeading>
};

export function PluginOverviewMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="ext-plugin-overview" data-plugin-overview="">
      <ReactMarkdown
        allowedElements={ALLOWED_ELEMENTS}
        unwrapDisallowed
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={OVERVIEW_COMPONENTS}
        urlTransform={overviewUrlTransform}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
