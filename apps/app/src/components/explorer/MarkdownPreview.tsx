import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DocumentLinkBoundary } from '../DocumentLinkBoundary.js';
import { documentLinkUrlTransform, type DocumentLink } from '../document-links.js';

export default function MarkdownPreview({ content, documentPath, fragment, onOpenDocument }: {
  content: string;
  documentPath: string;
  fragment?: string;
  onOpenDocument?: (link: DocumentLink) => void;
}) {
  return <DocumentLinkBoundary className="explorer-md-preview" documentPath={documentPath} fragment={fragment} onOpenDocument={onOpenDocument}><div className="inbox-md">
    <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={documentLinkUrlTransform} components={{
      table: ({ node: _node, ...props }) => <div className="inbox-md-table-wrap"><table {...props} /></div>
    }}>{content}</ReactMarkdown>
  </div></DocumentLinkBoundary>;
}
