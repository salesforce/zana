/**
 * @vitest-environment happy-dom
 */
import { useState } from 'react';
import type { PluginThreadPanelProps } from '@zana-ai/zcc-plugin-sdk/app';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { renderSlot } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { DocumentPanel } from './DocumentPanel.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

vi.mock('./LibraryMarkdownEditor.js', () => ({
  LibraryMarkdownEditor: ({
    value,
    onChange
  }: {
    value: string;
    onChange: (next: string) => void;
  }) => (
    <textarea
      data-testid="mock-md"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}));

function DelayedOwner(props: PluginThreadPanelProps) {
  const [owner, setOwner] = useState<string>();
  return <><button onClick={() => setOwner('owner')}>Resolve project</button><DocumentPanel {...props} projectId={owner} /></>;
}

describe('DocumentPanel', () => {
  it('shows an empty state for invalid params', () => {
    const slot = renderSlot(
      { component: DocumentPanel },
      {
        pluginId: 'docs',
        threadId: 't1',
        params: { path: '../secret.md' }
      }
    );
    expect(slot.getByRole('status').textContent).toMatch(/missing a library path/i);
  });

  it('loads and saves a card opened before its owning project has resolved', async () => {
    const read = vi.fn(() => ({ ok: true, content: '# Note', sha256: 'a'.repeat(64) }));
    const write = vi.fn(() => ({ ok: true }));
    const slot = renderSlot({ component: DelayedOwner }, { pluginId: 'docs', threadId: 'thread', params: { path: 'note.md' } }, { rpc: { read, write } });
    expect(slot.getByRole('status').textContent).toContain('missing a library path');
    expect(read).not.toHaveBeenCalled();
    fireEvent.click(slot.getByRole('button', { name: 'Resolve project' }));
    const editor = await slot.findByTestId('mock-md');
    expect(read).toHaveBeenCalledWith({ path: 'note.md', scope: 'project', projectId: 'owner' });
    vi.useFakeTimers();
    fireEvent.change(editor, { target: { value: '# Updated' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(write).toHaveBeenCalledWith({ path: 'note.md', scope: 'project', projectId: 'owner', content: '# Updated', expectedSha256: 'a'.repeat(64) });
  });

  it.each([{ path: 'note.md', projectId: 'explicit' }, { path: 'note.md', scope: 'global' }])('retains an already scoped draft when thread metadata arrives: %o', async params => {
    const read = vi.fn(() => ({ ok: true, content: '# Note' }));
    const slot = renderSlot({ component: DelayedOwner }, { pluginId: 'docs', threadId: 'thread', params }, { rpc: { read, write: () => ({ ok: true }) } });
    const editor = await slot.findByTestId('mock-md');
    vi.useFakeTimers();
    fireEvent.change(editor, { target: { value: 'Unsaved draft' } });
    fireEvent.click(slot.getByRole('button', { name: 'Resolve project' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect((slot.getByTestId('mock-md') as HTMLTextAreaElement).value).toBe('Unsaved draft');
    expect(read).toHaveBeenCalledOnce();
  });

  it('renders HTML in a script-only sandbox', async () => {
    const slot = renderSlot(
      { component: DocumentPanel },
      {
        pluginId: 'docs',
        threadId: 't1',
        params: { path: 'ideas/note.html', scope: 'global', title: 'Note' }
      },
      {
        rpc: {
          read: () => ({ ok: true, content: '<h1>Hello</h1>' })
        }
      }
    );
    const frame = await slot.findByTitle('Note');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(frame.getAttribute('srcdoc')).toBe('<h1>Hello</h1>');
  });

  it('autosaves markdown edits', async () => {
    const writes: unknown[] = [];
    const slot = renderSlot(
      { component: DocumentPanel },
      {
        pluginId: 'docs',
        threadId: 't1',
        params: {
          path: 'findings/auth.md',
          scope: 'project',
          projectId: 'p1',
          title: 'Auth'
        }
      },
      {
        rpc: {
          read: () => ({ ok: true, content: '# Auth\n', sha256: 'a'.repeat(64) }),
          write: (input) => {
            writes.push(input);
            return { ok: true };
          }
        }
      }
    );
    const editor = await slot.findByTestId('mock-md');
    vi.useFakeTimers();
    fireEvent.change(editor, { target: { value: '# Auth\n\nUpdated.\n' } });
    expect(writes).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(writes).toEqual([{
      path: 'findings/auth.md',
      scope: 'project',
      projectId: 'p1',
      content: '# Auth\n\nUpdated.\n',
      expectedSha256: 'a'.repeat(64)
    }]);
  });
  it.each([false, true])('shows a read error without enabling edits (throws=%s)', async throws => {
    const slot = renderSlot({ component: DocumentPanel }, { pluginId: 'docs', threadId: 't1', params: { path: 'note.md', scope: 'global' } }, { rpc: { read: () => { if (throws) throw new Error('Offline'); return { ok: false, message: 'Missing document' }; } } });
    const alert = await slot.findByRole('alert'); expect(alert.textContent).toMatch(/Offline|Missing document/); expect(slot.queryByTestId('mock-md')).toBeNull();
  });
  it('keeps the draft visible when a revision conflict stops autosave', async () => {
    const write = vi.fn((_input: unknown) => ({ ok: false, message: 'Changed elsewhere; reload before saving' }));
    const slot = renderSlot({ component: DocumentPanel }, { pluginId: 'docs', threadId: 't1', params: { path: 'note.md', scope: 'global' } }, { rpc: { read: () => ({ ok: true, content: '# Note', sha256: 'a'.repeat(64) }), write } });
    const editor = await slot.findByTestId('mock-md'); vi.useFakeTimers();
    fireEvent.change(editor, { target: { value: 'Unsaved draft' } }); await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(slot.getByRole('alert').textContent).toContain('Changed elsewhere'); expect((slot.getByTestId('mock-md') as HTMLTextAreaElement).value).toBe('Unsaved draft');
    fireEvent.change(editor, { target: { value: 'Later draft' } }); await act(async () => { await vi.advanceTimersByTimeAsync(700); }); expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith({ path: 'note.md', scope: 'global', content: 'Unsaved draft', expectedSha256: 'a'.repeat(64) });
  });
  it('advances the revision between sequential saves', async () => {
    const write = vi.fn((_input: unknown) => ({ ok: true, sha256: 'b'.repeat(64) }));
    const slot = renderSlot({ component: DocumentPanel }, { pluginId: 'docs', threadId: 't1', params: { path: 'note.md', scope: 'global' } }, { rpc: { read: () => ({ ok: true, content: '# Note', sha256: 'a'.repeat(64) }), write } });
    const editor = await slot.findByTestId('mock-md'); vi.useFakeTimers();
    fireEvent.change(editor, { target: { value: 'First' } }); await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    fireEvent.change(editor, { target: { value: 'Second' } }); await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(write.mock.calls[1][0]).toMatchObject({ expectedSha256: 'b'.repeat(64) });
    fireEvent.click(slot.getByRole('button', { name: 'Open in Library' }));
  });
  it('ignores a late read after the panel is closed', async () => {
    let release!: (value: unknown) => void;
    const read = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const slot = renderSlot({ component: DocumentPanel }, { pluginId: 'docs', threadId: 't1', params: { path: 'note.md', scope: 'global' } }, { rpc: { read } });
    await waitFor(() => expect(read).toHaveBeenCalledOnce()); slot.unmount(); release({ ok: true, content: 'Late' }); await Promise.resolve();
    expect(slot.queryByTestId('mock-md')).toBeNull();
  });
});
