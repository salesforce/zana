import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownContent } from './MarkdownContent.js';

const EMPTY_HEADER_TABLE = '| | |\n|---|---|\n| **Status** | CI green |\n| **Needs you** | Nothing |';
const REAL_HEADER_TABLE = '| Name | Value |\n|---|---|\n| a | b |';

describe('MarkdownContent table headers', () => {
  it('leaves out a header row whose cells are all empty', () => {
    const html = renderToStaticMarkup(<MarkdownContent text={EMPTY_HEADER_TABLE} />);
    expect(html).not.toContain('<thead');
    expect(html).toContain('Status');
    expect(html).toContain('CI green');
  });

  it('keeps a header row that has text', () => {
    const html = renderToStaticMarkup(<MarkdownContent text={REAL_HEADER_TABLE} />);
    expect(html).toContain('<thead');
    expect(html).toContain('Name');
  });
});
