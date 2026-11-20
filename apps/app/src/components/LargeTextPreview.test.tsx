// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { boundedText, isOversizedText, LargeTextPreview, measuredText } from './LargeTextPreview';
import DiffViewerInner from './DiffViewerInner';
import { DocContent, MarkdownContent } from './MarkdownContent';
const copy = vi.hoisted(() => vi.fn());
vi.mock('../lib/copy-text.js', () => ({ copyText: copy }));
vi.mock('react-diff-viewer-continued', () => ({ default: (props: any) => <div data-testid="diff">{JSON.stringify(props.infiniteLoading)}</div>, DiffMethod: { LINES: 'lines' } }));
afterEach(() => { cleanup(); copy.mockReset(); });
it('stops at both budgets and preserves small text', () => {
  expect(boundedText('abc')).toBe('abc'); expect(boundedText('abcdef', 3)).toBe('abc');
  expect(boundedText('a\nb\nc\n', 100, 2)).toBe('a\nb\n');
});
it('copies the complete source and reports copy failure', async () => {
  const text = 'x'.repeat(100_000); copy.mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined);
  const { container } = render(<LargeTextPreview text={text} />);
  expect(container.querySelector('pre')!.textContent).toHaveLength(64_000);
  fireEvent.click(screen.getByRole('button')); await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button')); await screen.findByText('Copied full text');
  expect(copy).toHaveBeenLastCalledWith(text); expect(screen.queryByRole('alert')).toBeNull();
});
it('bounds Markdown and code document rendering before parsing', () => {
  const text = '```javascript\n' + 'const x = 1;\n'.repeat(10_000) + '```';
  const a = render(<MarkdownContent text={text} />); expect(a.container.querySelector('pre')!.textContent!.length).toBeLessThanOrEqual(64_000); a.unmount();
  const b = render(<DocContent content={text} path="large.js" />); expect(b.container.querySelectorAll('.hljs-keyword')).toHaveLength(0);
});
it('admits small diffs to virtual rendering and bounds large or many-line diffs', () => {
  const props = { original: 'a', modified: 'b', compactStyles: {}, isDark: false };
  const view = render(<DiffViewerInner {...props} />); expect(screen.getByTestId('diff').textContent).toContain('80');
  view.rerender(<DiffViewerInner {...props} original={'x'.repeat(32_001)} />); expect(screen.getByRole('region', { name: 'Large diff' })).toBeTruthy();
  expect(screen.queryByTestId('diff')).toBeNull();
  view.rerender(<DiffViewerInner {...props} modified={'x\n'.repeat(501)} />); expect(screen.queryByTestId('diff')).toBeNull();
});
const inlined = (count: number) => Array.from({ length: count }, (_, i) => `![shot ${i}](data:image/png;base64,${'A'.repeat(90_000)})`).join('\n\n');
it('measures a small document with inlined images by its own text, not the image payloads', () => {
  const text = `# Notes

${inlined(8)}
`;
  expect(text.length).toBeGreaterThan(700_000);
  expect(isOversizedText(text)).toBe(false);
  expect(measuredText(text)).toContain('![shot 7](data:image/png;base64,)');
  expect(measuredText('plain text')).toBe('plain text');
  const a = render(<MarkdownContent text={text} />);
  expect(screen.queryByRole('status')).toBeNull();
  expect(a.container.querySelectorAll('img')).toHaveLength(8);
  a.unmount();
  const b = render(<DocContent content={text} path="notes.md" />);
  expect(screen.queryByRole('status')).toBeNull();
  b.unmount();
});
it('still caps a genuinely huge document with images and names what was exceeded', () => {
  const text = `${'word '.repeat(20_000)}
${inlined(2)}`;
  expect(isOversizedText(text)).toBe(true);
  const { container } = render(<MarkdownContent text={text} />);
  expect(screen.getByRole('status').textContent).toBe('Showing a text preview: this document is over 1,000 lines or 64,000 characters.');
  expect(container.querySelector('pre')!.textContent!.length).toBeLessThanOrEqual(64_000);
  expect(isOversizedText('x\n'.repeat(1_001))).toBe(true);
});
