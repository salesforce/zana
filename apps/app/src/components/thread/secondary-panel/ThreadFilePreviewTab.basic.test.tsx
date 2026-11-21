// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setBasicUiMode } from '../../../lib/basic-ui.js';
import { ThreadFilePreviewChrome, ThreadFilePreviewTab } from './ThreadFilePreviewTab.js';

vi.mock('../../../lib/product-client.js', () => ({ product: {
  fs: { readFile: vi.fn(async () => ({ ok: true, content: '<h1>Release plan</h1>\n<p>Next step</p>' })) },
  threads: { hostFileContent: vi.fn(async () => ({ content: '<h1>Release plan</h1>\n<p>Next step</p>' })) }
} }));
const openers: never[] = [];
vi.mock('../../../plugins/plugin-slots.js', () => ({ listFileOpeners: () => openers, subscribePluginSlots: () => () => {} }));
beforeEach(() => setBasicUiMode('advanced'));
afterEach(() => { cleanup(); setBasicUiMode('advanced'); });

describe('Basic document presentation', () => {
  it('shows the document name while omitting code, paths and opener configuration', () => {
    const props = { path: '/project/release/plan.html', matches: [{ id: 'open', pluginId: 'test', generation: 1, title: 'Reader', extensions: ['html'], component: () => null }], selectedKey: 'host', onSelect: vi.fn(), htmlMode: 'preview' as const, onHtmlModeChange: vi.fn() };
    const view = render(<ThreadFilePreviewChrome {...props} basic />);
    expect(screen.getByText('plan.html')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Code' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy path' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Open with' })).toBeNull();
    expect(view.container.querySelector('.thread-file-preview-dir')).toBeNull();
    view.rerender(<ThreadFilePreviewChrome {...props} />);
    expect(screen.getByRole('button', { name: 'Code' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy path' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Open with' })).toBeTruthy();
    expect(view.container.querySelector('.thread-file-preview-dir')).not.toBeNull();
  });
  it('renders output in Basic and restores the Advanced code choice without changing it', async () => {
    const view = render(<ThreadFilePreviewTab path="plan.html" threadId="thread" />);
    expect(screen.getByTestId('thread-file-preview-html')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Code' }));
    await view.findByTestId('thread-file-preview');
    expect(screen.queryByTestId('thread-file-preview-html')).toBeNull();
    act(() => setBasicUiMode('basic'));
    expect(screen.getByTestId('thread-file-preview-html')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Code' })).toBeNull();
    act(() => setBasicUiMode('advanced'));
    expect(screen.queryByTestId('thread-file-preview-html')).toBeNull();
    expect(screen.getByRole('button', { name: 'Code' }).getAttribute('aria-pressed')).toBe('true');
  });
  it('opens a linked HTML source line as output in Basic, then restores the source in Advanced', async () => {
    setBasicUiMode('basic');
    render(<ThreadFilePreviewTab path="plan.html" threadId="thread" lineNumber={2} />);
    expect(screen.getByTestId('thread-file-preview-html')).toBeTruthy();
    act(() => setBasicUiMode('advanced'));
    expect(screen.queryByTestId('thread-file-preview-html')).toBeNull();
    await screen.findByTestId('thread-file-preview-focus-line');
  });
});
