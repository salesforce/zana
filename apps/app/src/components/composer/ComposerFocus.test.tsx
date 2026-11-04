// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { EditorContent } from '@tiptap/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useComposerPromptField } from './use-composer-prompt-field.js';
import { resetComposerSessions } from './composer-session.js';

vi.mock('../../lib/fetch-with-app-surface.js', () => ({ apiJson: async () => ({}) }));
vi.mock('../../lib/product-client.js', () => ({ product: {
  pluginApps: { onChanged: () => () => {} }, skills: { onChanged: () => () => {} }
} }));
vi.mock('./use-composer-suggestions.js', () => ({
  useMentionProviderRows: () => [], useComposerSuggestions: () => ({ suggestions: [], menuOpen: false })
}));

let field: ReturnType<typeof useComposerPromptField>;
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
function Probe({ autoFocus = false, disabled = false, initialText }: { autoFocus?: boolean; disabled?: boolean; initialText?: string }) {
  field = useComposerPromptField({
    placeholder: 'Message', testId: 'composer', projectId: '', projects: [],
    autoFocus, disabled, initialText, slashCatalog: { kind: 'cli' }, onSubmit: () => {}
  });
  return <><EditorContent editor={field.editor} /><textarea aria-label="Side-panel assistant" /></>;
}
async function ready() { await waitFor(() => expect(field.editor).not.toBeNull()); }
function flushFrames() {
  act(() => {
    const pending = [...frames.values()]; frames.clear();
    pending.forEach(callback => callback(0));
  });
}
beforeEach(() => {
  resetComposerSessions(); frames.clear(); nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each([undefined, 'Seeded draft'])('keeps a side-panel input focused when a composer mounts (%s)', async initialText => {
  render(<Probe autoFocus initialText={initialText} />); await ready();
  const panel = screen.getByRole('textbox', { name: 'Side-panel assistant' });
  panel.focus(); flushFrames(); flushFrames();
  expect(document.activeElement).toBe(panel);
  expect(field.text).toBe(initialText ?? '');
});

it('keeps typing focus when an approval finishing re-enables composer autofocus', async () => {
  const view = render(<Probe />); await ready();
  const panel = screen.getByRole('textbox', { name: 'Side-panel assistant' });
  panel.focus();
  view.rerender(<Probe autoFocus />); flushFrames(); flushFrames();
  expect(document.activeElement).toBe(panel);
});

it('does not reclaim focus when a delayed send finishes after moving to the assistant', async () => {
  const view = render(<Probe />); await ready();
  act(() => { field.setText('Message'); field.editor!.view.focus(); field.markRestoreFocus(); });
  view.rerender(<Probe disabled />);
  view.rerender(<Probe />);
  const panel = screen.getByRole('textbox', { name: 'Side-panel assistant' });
  panel.focus(); flushFrames(); flushFrames();
  expect(document.activeElement).toBe(panel);
  // The skipped restore is consumed, so a later busy transition cannot revive it.
  panel.blur(); view.rerender(<Probe disabled />); view.rerender(<Probe />); flushFrames();
  expect(document.activeElement).toBe(document.body);
});

it('autofocuses an unclaimed composer and restores the caret after sending', async () => {
  const view = render(<Probe autoFocus initialText="Message" />); await ready(); flushFrames();
  expect(document.activeElement).toBe(field.editor!.view.dom);
  act(() => { field.editor!.commands.setTextSelection(1); field.markRestoreFocus(); });
  view.rerender(<Probe autoFocus disabled initialText="Message" />);
  view.rerender(<Probe autoFocus initialText="Message" />); flushFrames();
  expect(document.activeElement).toBe(field.editor!.view.dom);
  expect(field.editor!.state.selection.from).toBe(field.editor!.state.doc.content.size - 1);
});

it('cancels deferred autofocus when the surface unmounts', async () => {
  const view = render(<Probe autoFocus />); await ready();
  view.unmount(); flushFrames();
  expect(document.activeElement).toBe(document.body);
});
