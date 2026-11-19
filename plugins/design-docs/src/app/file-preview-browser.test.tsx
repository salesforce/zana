// @vitest-environment happy-dom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UI_USER } from '../server/rpc.js';
import { FilePreview } from './FilePreview.js';
import { createHarness, type HarnessOptions } from './test-harness.js';

afterEach(() => vi.unstubAllGlobals());

function mount(path: string, props: { draft?: boolean; kind?: 'doc' | 'template' } = {}, options: HarnessOptions = {}) {
  const harness = createHarness(options);
  const doc = harness.store.create({ title: 'Notes', projectId: 'p1', files: [{ path, content: '# Hi' }] }, UI_USER);
  const kind = path.endsWith('.md') || path.endsWith('.markdown') ? 'markdown' : 'text';
  harness.render(
    <FilePreview docId={doc.id} file={{ path, kind, content: '# Hi', encoding: 'utf8' }} files={harness.store.get(doc.id).files} {...props} />
  );
  return { harness, doc };
}

const button = () => screen.queryByRole('button', { name: 'Open in browser' });

describe('markdown Open in browser', () => {
  it('opens the standalone page', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const { doc } = mount('notes.md', {}, { pageUrl: (docId, path) => `http://127.0.0.1:8780/page?doc=${docId}&path=${path}` });
    fireEvent.click(button()!);
    await waitFor(() => expect(open).toHaveBeenCalledWith(`http://127.0.0.1:8780/page?doc=${doc.id}&path=notes.md`, '_blank', 'noopener,noreferrer'));
  });

  it('toasts when pages are not served', async () => {
    const { harness } = mount('notes.markdown');
    fireEvent.click(button()!);
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'standalone pages are not served here', kind: 'error' }));
  });

  it('is absent for drafts', () => {
    mount('notes.md', { draft: true });
    expect(button()).toBeNull();
  });

  it('is absent for templates', () => {
    mount('notes.md', { kind: 'template' });
    expect(button()).toBeNull();
  });

  it('is absent for non-renderable markdown', () => {
    mount('AGENTS.md');
    expect(button()).toBeNull();
  });

  it('is absent for other files', () => {
    mount('data.txt');
    expect(button()).toBeNull();
  });
});
