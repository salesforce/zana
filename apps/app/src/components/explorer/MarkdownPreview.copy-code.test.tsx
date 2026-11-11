// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MarkdownPreview from './MarkdownPreview';

const copy = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../../lib/copy-text.js', () => ({ copyTextOrFail: copy }));

const DOC_PATH = '/repo/notes.md';

afterEach(() => {
  cleanup();
  copy.mockClear();
});

function renderPreview(content: string, onOpenDocument = vi.fn()) {
  return render(<MarkdownPreview content={content} documentPath={DOC_PATH} onOpenDocument={onOpenDocument} />);
}

async function clickCopy(index = 0) {
  await act(async () => {
    fireEvent.click(screen.getAllByTestId('code-block-copy')[index]!);
  });
}

describe('Explorer markdown preview code block copy', () => {
  it('copies a fence verbatim, without the language label or closing newline', async () => {
    const code = '\tconst a = 1;\n\n    if (a) {\n      b();  \n    }';
    const { container } = renderPreview('Intro\n\n```ts\n' + code + '\n```\n');
    const button = screen.getByRole('button', { name: 'Copy code' });
    expect(button.parentElement?.className).toBe('inbox-md-codeblock');
    expect(container.querySelector('pre')!.contains(button)).toBe(false);
    await clickCopy();
    expect(copy).toHaveBeenCalledWith(code);
  });

  it('keeps a deliberate trailing blank line and decodes entities', async () => {
    renderPreview('```\n  indented\n\n```\n\n```html\na < b && "c"\n```');
    await clickCopy(0);
    expect(copy).toHaveBeenLastCalledWith('  indented\n');
    await clickCopy(1);
    expect(copy).toHaveBeenLastCalledWith('a < b && "c"');
  });

  it('copies a long single-line block in full', async () => {
    const code = 'x'.repeat(5000);
    renderPreview('```\n' + code + '\n```');
    await clickCopy();
    expect(copy).toHaveBeenCalledWith(code);
  });

  it('announces the result through the live region only', async () => {
    renderPreview('```\nx\n```');
    await clickCopy();
    expect(screen.getByRole('status').textContent).toBe('Copied');
    expect(screen.getByTestId('code-block-copy').getAttribute('aria-label')).toBe('Copy code');
  });

  it('adds no button to inline code or mermaid fences', () => {
    const { container } = renderPreview('Use `npm test`.\n\n```mermaid\ngraph TD; A-->B\n```');
    expect(screen.queryByRole('button', { name: 'Copy code' })).toBeNull();
    expect(container.querySelector('pre code.language-mermaid')?.textContent).toBe('graph TD; A-->B\n');
  });

  it('copying does not trigger the document link handler, and links still open', async () => {
    const open = vi.fn();
    renderPreview('[Other](other.md)\n\n```\nx\n```', open);
    await clickCopy();
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('link', { name: 'Other' }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ path: '/repo/other.md' }));
  });
});
