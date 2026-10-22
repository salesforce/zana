// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocContent, fencedCodeText, MarkdownContent } from './MarkdownContent';

const copy = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../lib/copy-text.js', () => ({ copyTextOrFail: copy }));

afterEach(() => {
  cleanup();
  copy.mockClear();
});

async function clickCopy(index = 0) {
  await act(async () => {
    // By test id: after a copy the label reads "Copied" for a moment.
    fireEvent.click(screen.getAllByTestId('code-block-copy')[index]!);
  });
}

describe('MarkdownContent code block copy', () => {
  it('copies a highlighted fence verbatim, without the language label or closing newline', async () => {
    const code = '\tconst a = 1;\n    if (a) {\n      b();  \n    }';
    const { container } = render(<MarkdownContent text={'Intro\n\n```ts\n' + code + '\n```\n'} />);
    const wrapper = container.querySelector('.inbox-md-codeblock')!;
    expect(wrapper.querySelector('pre code.hljs')).toBeTruthy();
    await clickCopy();
    expect(copy).toHaveBeenCalledWith(code);
  });

  it('keeps a deliberate trailing blank line and leading indentation', async () => {
    render(<MarkdownContent text={'```\n  indented\n\n```'} />);
    await clickCopy();
    expect(copy).toHaveBeenCalledWith('  indented\n');
  });

  it('copies unknown-language and decoded-entity fences as source text', async () => {
    render(<MarkdownContent text={'```not-a-language\na < b && c > "d"\n```'} />);
    await clickCopy();
    expect(copy).toHaveBeenCalledWith('a < b && c > "d"');
  });

  it('gives every fence its own button and copies the matching block', async () => {
    render(<MarkdownContent text={'```\nfirst\n```\n\ntext\n\n```sh\nsecond\n```'} />);
    expect(screen.getAllByRole('button', { name: 'Copy code' })).toHaveLength(2);
    await clickCopy(1);
    expect(copy).toHaveBeenCalledWith('second');
  });

  it('copies what has streamed so far, including an unclosed fence', async () => {
    const view = render(<MarkdownContent text={'```py\nprint(1)'} />);
    await clickCopy();
    expect(copy).toHaveBeenLastCalledWith('print(1)');
    view.rerender(<MarkdownContent text={'```py\nprint(1)\nprint(2)\n```'} />);
    await clickCopy();
    expect(copy).toHaveBeenLastCalledWith('print(1)\nprint(2)');
  });

  it('copies a long block in full while the button stays outside the scrolling pre', async () => {
    // Stays under boundedText's preview cap so it renders as markdown.
    const line = 'x'.repeat(300);
    const code = Array.from({ length: 150 }, (_, i) => `${i} ${line}`).join('\n');
    const { container } = render(<MarkdownContent text={'```\n' + code + '\n```'} />);
    const button = screen.getByRole('button', { name: 'Copy code' });
    expect(button.parentElement?.className).toBe('inbox-md-codeblock');
    expect(container.querySelector('pre')!.contains(button)).toBe(false);
    await clickCopy();
    expect(copy).toHaveBeenCalledWith(code);
  });

  it('adds no button to inline code or mermaid diagrams', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent text={'Use `npm test`.\n\n```mermaid\ngraph TD; A-->B\n```'} />
    );
    expect(html).not.toContain('inbox-md-code-copy');
  });

  it('leaves the button out when copyableCode is off, for both entry points', () => {
    const md = '```\ncode\n```';
    expect(renderToStaticMarkup(<MarkdownContent text={md} copyableCode={false} />)).not.toContain('inbox-md-codeblock');
    expect(renderToStaticMarkup(<DocContent path="a.md" content={md} copyableCode={false} />)).not.toContain('inbox-md-codeblock');
    expect(renderToStaticMarkup(<DocContent path="a.md" content={md} />)).toContain('aria-label="Copy code"');
  });
});

describe('fencedCodeText', () => {
  it('drops exactly one closing newline and flattens nested elements', () => {
    expect(fencedCodeText(<code>{'a\n\n'}</code>)).toBe('a\n');
    expect(fencedCodeText(<code>{['a', <span key="s">{'b'}</span>, 1, null, '\n']}</code>)).toBe('ab1');
    expect(fencedCodeText(undefined)).toBe('');
  });
});
