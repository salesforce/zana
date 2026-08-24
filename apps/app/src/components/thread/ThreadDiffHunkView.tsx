import { ChevronRight } from 'lucide-react';
import { highlightForPath } from '../../lib/highlightCode.js';
import 'highlight.js/styles/github-dark.css';
import {
  pairSplitDiffRows,
  parseUnifiedPatch,
  unmodifiedLineCountBefore,
  unmodifiedLineCountBetween,
  type ParsedDiffHunk,
  type ParsedDiffLine
} from './thread-diff.js';

export function ThreadDiffHunkView({
  path,
  patch,
  wrap = false,
  splitView = false
}: {
  path: string;
  patch: string;
  wrap?: boolean;
  splitView?: boolean;
}) {
  const hunks = parseUnifiedPatch(patch);
  if (hunks.length === 0) {
    return <p className="thread-diff-card-notice">No renderable diff.</p>;
  }
  return (
    <div
      className={`thread-diff-hunks${wrap ? ' is-wrap' : ''}${splitView ? ' is-split' : ''}`}
      data-testid="thread-diff-hunks"
    >
      {hunks.map((hunk, index) => {
        const previous = hunks[index - 1];
        const omitted = previous
          ? unmodifiedLineCountBetween(previous, hunk)
          : unmodifiedLineCountBefore(hunk);
        return (
          <section key={`${hunk.oldStart}-${hunk.newStart}-${index}`} className="thread-diff-hunk">
            {omitted > 0 ? <UnmodifiedFold count={omitted} /> : null}
            {splitView ? <SplitHunkTable path={path} hunk={hunk} /> : <UnifiedHunkTable path={path} hunk={hunk} />}
          </section>
        );
      })}
    </div>
  );
}

function UnmodifiedFold({ count }: { count: number }) {
  const label = `${count} unmodified line${count === 1 ? '' : 's'}`;
  return (
    <div className="thread-diff-hunk-fold" title={label}>
      <ChevronRight size={12} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function UnifiedHunkTable({ path, hunk }: { path: string; hunk: ParsedDiffHunk }) {
  return (
    <table className="thread-diff-hunk-table">
      <tbody>
        {hunk.lines.map((line, index) => (
          <tr key={index} className={`thread-diff-hunk-line is-${line.kind}`}>
            <td className="thread-diff-hunk-gutter">{lineNumber(line)}</td>
            <td className="thread-diff-hunk-code"><CodeText path={path} text={line.text} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SplitHunkTable({ path, hunk }: { path: string; hunk: ParsedDiffHunk }) {
  return (
    <table className="thread-diff-hunk-table is-split">
      <tbody>
        {pairSplitDiffRows(hunk.lines).map((row, index) => (
          <tr key={index}>
            <td className={`thread-diff-hunk-gutter${row.left ? ` is-${row.left.kind}` : ''}`}>
              {row.left?.oldNo ?? ''}
            </td>
            <td className={`thread-diff-hunk-code${row.left ? ` is-${row.left.kind}` : ''}`}>
              {row.left ? <CodeText path={path} text={row.left.text} /> : null}
            </td>
            <td className={`thread-diff-hunk-gutter${row.right ? ` is-${row.right.kind}` : ''}`}>
              {row.right?.newNo ?? ''}
            </td>
            <td className={`thread-diff-hunk-code${row.right ? ` is-${row.right.kind}` : ''}`}>
              {row.right ? <CodeText path={path} text={row.right.text} /> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function lineNumber(line: ParsedDiffLine): number | '' {
  if (line.kind === 'del') return line.oldNo ?? '';
  return line.newNo ?? '';
}

function CodeText({ path, text }: { path: string; text: string }) {
  const highlighted = text ? highlightForPath(path, text) : null;
  if (highlighted) {
    return <code className={`hljs language-${highlighted.language}`} dangerouslySetInnerHTML={{ __html: highlighted.html }} />;
  }
  return <code>{text || '\u00a0'}</code>;
}
