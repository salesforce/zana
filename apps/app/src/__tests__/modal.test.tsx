import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Modal } from '../components/Modal.js';

/**
 * The shared Modal primitive replaced 20+ hand-rolled dialogs. These pin its
 * structural contract (the classes/roles the CSS + a11y depend on) using
 * static server rendering — the project has no jsdom, matching its
 * dependency-light component-test style. Interactive behavior (Escape / Tab
 * trap) lives in useDialogFocusTrap, which Modal wires unconditionally.
 */
describe('Modal', () => {
  const base = { title: 'My Dialog', onClose: () => {}, children: 'body text' };

  it('renders the backdrop + dialog shell with aria wiring', () => {
    const html = renderToStaticMarkup(h(Modal, base));
    expect(html).toContain('class="modal-backdrop"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="My Dialog"');
    expect(html).toContain('<h3>My Dialog</h3>');
    expect(html).toContain('class="modal-body"');
    expect(html).toContain('body text');
  });

  it('appends caller classNames to the shell and body', () => {
    const html = renderToStaticMarkup(
      h(Modal, { ...base, className: 'scheduler-modal', bodyClassName: 'scheduler-confirm-body' })
    );
    expect(html).toContain('class="modal scheduler-modal"');
    expect(html).toContain('class="modal-body scheduler-confirm-body"');
  });

  it('renders a footer only when provided', () => {
    const without = renderToStaticMarkup(h(Modal, base));
    expect(without).not.toContain('modal-footer');
    const withFooter = renderToStaticMarkup(
      h(Modal, { ...base, footer: h('button', null, 'OK') })
    );
    expect(withFooter).toContain('class="modal-footer"');
    expect(withFooter).toContain('>OK</button>');
  });

  it('renders the close button by default and hides it with hideClose', () => {
    expect(renderToStaticMarkup(h(Modal, base))).toContain('aria-label="Close"');
    expect(renderToStaticMarkup(h(Modal, { ...base, hideClose: true }))).not.toContain(
      'aria-label="Close"'
    );
  });

  it('replaces the default header when a custom header is passed', () => {
    const html = renderToStaticMarkup(
      h(Modal, { ...base, header: h('div', { className: 'custom-head' }, 'Custom') })
    );
    expect(html).toContain('class="custom-head"');
    expect(html).not.toContain('<h3>My Dialog</h3>');
    // aria-label still comes from title even with a custom header.
    expect(html).toContain('aria-label="My Dialog"');
  });
});
