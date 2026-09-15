/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mermaidRender = vi.hoisted(() =>
  vi.fn(async () => ({ svg: '<svg viewBox="0 0 20 10"><g></g></svg>' }))
);

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: mermaidRender
  }
}));

import { MarkdownContent } from './MarkdownContent.js';
import { resetMermaidSvgCache } from '../lib/mermaid-svg-cache.js';

const SOURCE = '```mermaid\ngraph TD; A-->B\n```';

describe('MarkdownContent mermaid remounts', () => {
  beforeEach(() => {
    mermaidRender.mockClear();
    resetMermaidSvgCache();
  });

  afterEach(() => {
    cleanup();
    resetMermaidSvgCache();
  });

  it('does not restart mermaid.render when markdown re-renders with a new filePathHints array', async () => {
    const { rerender } = render(
      <MarkdownContent text={SOURCE} filePathHints={['a.md']} />
    );
    await waitFor(() => {
      expect(document.querySelector('[data-mermaid-state="settled"]')).toBeTruthy();
    });
    expect(mermaidRender).toHaveBeenCalledTimes(1);
    rerender(<MarkdownContent text={SOURCE} filePathHints={['a.md']} />);
    expect(document.querySelector('.inbox-mermaid-loading')).toBeNull();
    expect(document.querySelector('[data-mermaid-state="settled"]')).toBeTruthy();
    expect(mermaidRender).toHaveBeenCalledTimes(1);
  });

  it('shows the cached SVG immediately on remount', async () => {
    const first = render(<MarkdownContent text={SOURCE} />);
    await waitFor(() => {
      expect(document.querySelector('[data-mermaid-state="settled"]')).toBeTruthy();
    });
    first.unmount();
    render(<MarkdownContent text={SOURCE} />);
    expect(document.querySelector('.inbox-mermaid-loading')).toBeNull();
    expect(document.querySelector('[data-mermaid-state="settled"]')).toBeTruthy();
    expect(mermaidRender).toHaveBeenCalledTimes(1);
  });

  it('reuses an in-flight render across unmount so the placeholder cannot loop', async () => {
    let finish: (value: { svg: string }) => void = () => undefined;
    mermaidRender.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const first = render(<MarkdownContent text={SOURCE} />);
    expect(document.querySelector('.inbox-mermaid-loading')).toBeTruthy();
    await waitFor(() => expect(mermaidRender).toHaveBeenCalledTimes(1));
    first.unmount();
    render(<MarkdownContent text={SOURCE} />);
    expect(document.querySelector('.inbox-mermaid-loading')).toBeTruthy();
    finish({ svg: '<svg viewBox="0 0 20 10"><g></g></svg>' });
    await waitFor(() => {
      expect(document.querySelector('[data-mermaid-state="settled"]')).toBeTruthy();
    });
    expect(mermaidRender).toHaveBeenCalledTimes(1);
  });
});
