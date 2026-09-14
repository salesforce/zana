/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent } from '@testing-library/react';
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
          read: () => ({ ok: true, content: '# Auth\n' }),
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
    await vi.advanceTimersByTimeAsync(700);
    expect(writes).toEqual([{
      path: 'findings/auth.md',
      scope: 'project',
      projectId: 'p1',
      content: '# Auth\n\nUpdated.\n'
    }]);
  });
});
