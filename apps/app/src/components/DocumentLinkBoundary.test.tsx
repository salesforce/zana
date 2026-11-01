// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReactMarkdown from 'react-markdown';
import { DocumentLinkBoundary } from './DocumentLinkBoundary.js';
import { documentLinkUrlTransform, resolveDocumentLink, scrollToDocumentFragment } from './document-links.js';

const http = vi.hoisted(() => ({ open: vi.fn((href: string) => /^https?:/u.test(href)) }));
vi.mock('../lib/in-app-browser-link-preference.js', () => ({ handleHttpLinkClick: http.open }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('document-relative links', () => {
  it.each([
    ['b.md', { path: 'notes/b.md', fragment: '' }],
    ['./b.md', { path: 'notes/b.md', fragment: '' }],
    ['../b.md', { path: 'b.md', fragment: '' }],
    ['/notes/b.md', { path: '/notes/b.md', fragment: '' }],
    ['b%20notes.md#Section%202', { path: 'notes/b notes.md', fragment: 'Section 2' }],
    ['b.md?view=preview#section-2', { path: 'notes/b.md', fragment: 'section-2' }],
    ['#section-2', { path: 'notes/a.md', fragment: 'section-2' }],
    ['file:///project/b.md#section-2', { path: '/project/b.md', fragment: 'section-2' }],
    ['file://localhost/project/b.md', { path: '/project/b.md', fragment: '' }],
    ['../../outside.md', { path: '../outside.md', fragment: '' }],
    ['', null], ['bad%xx.md', null], ['b.md#%xx', null], ['https://example.com/b.md', null],
    ['//example.com/b.md', null], ['javascript:alert(1)', null], ['data:text/html,test', null],
    ['file://other/project/b.md', null], ['file://%', null], ['%00.md', null]
  ])('resolves %s without using the app URL', (href, expected) => {
    expect(resolveDocumentLink('notes/a.md', href)).toEqual(expected);
  });

  it('preserves file hrefs only for intercepted anchors', () => {
    expect(documentLinkUrlTransform('file:///tmp/b.md', 'href')).toBe('file:///tmp/b.md');
    expect(documentLinkUrlTransform('file:///tmp/b.md', 'src')).toBe('');
    expect(documentLinkUrlTransform('javascript:alert(1)', 'href')).toBe('');
    expect(documentLinkUrlTransform('https://example.com', 'href')).toBe('https://example.com');
  });
});

describe('document link activation', () => {
  function mount(href = 'b.md', props: { fragment?: string; onOpenDocument?: ReturnType<typeof vi.fn> } = {}) {
    const open = props.onOpenDocument ?? vi.fn();
    const view = render(<DocumentLinkBoundary documentPath="notes/a.md" onOpenDocument={open} fragment={props.fragment}>
      <a href={href}><strong>Linked note</strong></a>
      <h2 id="explicit">Section 2</h2><h2>Section 2</h2><h2>Section 2</h2><p>Plain text</p>
    </DocumentLinkBoundary>);
    return { ...view, open };
  }

  it.each([{}, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }])('prevents full-window navigation, including modified clicks: %j', modifiers => {
    const view = mount();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...modifiers });
    fireEvent(view.getByText('Linked note'), event);
    expect(event.defaultPrevented).toBe(true);
    expect(view.open).toHaveBeenCalledWith({ path: 'notes/b.md', fragment: '' });
  });

  it('intercepts middle clicks and ignores right clicks and non-links', () => {
    const view = mount();
    fireEvent(view.getByText('Linked note'), new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
    expect(view.open).toHaveBeenCalledTimes(1);
    fireEvent(view.getByText('Linked note'), new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 2 }));
    fireEvent.click(view.getByText('Plain text'));
    expect(view.open).toHaveBeenCalledTimes(1);
  });

  it.each(['', 'javascript:alert(1)', 'file://other/b.md', 'bad%xx.md'])('blocks malformed or unsupported href %s', href => {
    const view = mount(href);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    fireEvent(view.getByText('Linked note'), event);
    expect(event.defaultPrevented).toBe(true);
    expect(view.open).not.toHaveBeenCalled();
  });

  it('uses the existing HTTP opener and keeps email and telephone links external', () => {
    const external = vi.spyOn(window, 'open').mockReturnValue(null);
    const view = mount('https://example.com/b.md');
    fireEvent.click(view.getByText('Linked note'), { ctrlKey: true });
    expect(http.open).toHaveBeenCalledWith('https://example.com/b.md', { event: expect.objectContaining({ ctrlKey: true }) });
    expect(view.open).not.toHaveBeenCalled();
    const anchor = view.getByRole('link');
    for (const href of ['mailto:friend@example.com', 'tel:+123']) {
      anchor.setAttribute('href', href); fireEvent.click(anchor);
      expect(external).toHaveBeenLastCalledWith(href, '_blank', 'noopener,noreferrer');
    }
  });

  it('handles same-document anchors without replacing the document', () => {
    const view = mount('#section-2');
    const heading = view.getAllByRole('heading')[0];
    heading.scrollIntoView = vi.fn();
    fireEvent.click(view.getByText('Linked note'));
    expect(heading.scrollIntoView).toHaveBeenCalled();
    expect(view.open).not.toHaveBeenCalled();
    const second = view.getAllByRole('heading')[1]; second.scrollIntoView = vi.fn();
    view.getByRole('link').setAttribute('href', '#section-2-1'); fireEvent.click(view.getByRole('link'));
    expect(second.scrollIntoView).toHaveBeenCalled();
    view.getByRole('link').setAttribute('href', '#explicit'); fireEvent.click(view.getByRole('link'));
    expect(heading.scrollIntoView).toHaveBeenCalledTimes(2);
    view.getByRole('link').setAttribute('href', '#missing'); fireEvent.click(view.getByRole('link'));
    expect(view.open).not.toHaveBeenCalled();
    const root = view.container.firstElementChild as HTMLElement;
    root.scrollTo = vi.fn(); scrollToDocumentFragment(root, '');
    expect(root.scrollTo).toHaveBeenCalledWith({ top: 0 });
  });

  it('scrolls to the requested heading when a linked document mounts', () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    mount('b.md', { fragment: 'section-2' });
    expect(scroll).toHaveBeenCalled();
  });

  it('preserves and intercepts file links rendered from Markdown', () => {
    const open = vi.fn();
    const view = render(<DocumentLinkBoundary documentPath="notes/a.md" onOpenDocument={open}>
      <ReactMarkdown urlTransform={documentLinkUrlTransform}>{'[B](file:///project/b.md#section-2)'}</ReactMarkdown>
    </DocumentLinkBoundary>);
    fireEvent.click(view.getByRole('link'));
    expect(open).toHaveBeenCalledWith({ path: '/project/b.md', fragment: 'section-2' });
  });

  it('prevents native navigation when no document opener is installed', () => {
    const view = render(<DocumentLinkBoundary documentPath="a.md"><a href="b.md">B</a></DocumentLinkBoundary>);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    fireEvent(view.getByRole('link'), event);
    expect(event.defaultPrevented).toBe(true);
  });
});
