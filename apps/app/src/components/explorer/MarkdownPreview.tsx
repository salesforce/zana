import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function MarkdownPreview({ content }: { content: string }) {
  return <div className="explorer-md-preview"><div className="inbox-md">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
      table: ({ node: _node, ...props }) => <div className="inbox-md-table-wrap"><table {...props} /></div>
    }}>{content}</ReactMarkdown>
  </div></div>;
}
