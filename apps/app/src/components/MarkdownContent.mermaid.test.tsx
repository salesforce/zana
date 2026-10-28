/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
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

  it('exposes natural width for a tall diagram without fixing its rendered width', async () => {
    mermaidRender.mockResolvedValueOnce({ svg: '<svg width="100%" viewBox="0 0 180 2400"><g></g></svg>' });
    const { container, getByRole } = render(<MarkdownContent text={SOURCE} threadId="thread-1" />);
    await waitFor(() => expect(container.querySelector('.inbox-mermaid-frame')).toBeTruthy());
    const frame = container.querySelector<HTMLElement>('.inbox-mermaid-frame')!;
    expect(frame.classList.contains('is-sized')).toBe(true);
    expect(frame.style.aspectRatio).toBe('180 / 2400');
    expect(frame.style.getPropertyValue('--mermaid-intrinsic-width')).toBe('180px');
    expect(frame.querySelector('svg')?.hasAttribute('width')).toBe(false);
    expect(getByRole('button', { name: 'Open diagram in full screen' })).toBeTruthy();
  });

  it('keeps the unsized fallback when the SVG has no usable viewBox', async () => {
    mermaidRender.mockResolvedValueOnce({ svg: '<svg width="100%" height="40"><g></g></svg>' });
    const { container } = render(<MarkdownContent text={SOURCE} />);
    await waitFor(() => expect(container.querySelector('.inbox-mermaid-frame')).toBeTruthy());
    const frame = container.querySelector<HTMLElement>('.inbox-mermaid-frame')!;
    expect(frame.classList.contains('is-sized')).toBe(false);
    expect(frame.getAttribute('style')).toBeNull();
    expect(container.querySelector('.inbox-mermaid-toolbar')).toBeNull();
  });

  it('switches between source and the sized diagram without losing the layout', async () => {
    const { container, getByRole } = render(<MarkdownContent text={SOURCE} exportable />);
    await waitFor(() => expect(container.querySelector('.inbox-mermaid-frame')).toBeTruthy());
    fireEvent.click(getByRole('button', { name: 'Source', exact: true }));
    expect(container.querySelector('.inbox-mermaid-frame')).toBeNull();
    expect(container.querySelector('.inbox-mermaid-source')?.textContent).toBe('graph TD; A-->B');
    fireEvent.click(getByRole('button', { name: 'Diagram', exact: true }));
    expect(container.querySelector('.inbox-mermaid-source')).toBeNull();
    expect(container.querySelector<HTMLElement>('.inbox-mermaid-frame')?.style.aspectRatio).toBe('20 / 10');
  });
});
