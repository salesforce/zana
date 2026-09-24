/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { DragEvent as ReactDragEvent } from 'react';
import { useComposerPromptField } from './use-composer-prompt-field.js';
import { PROJECT_DRAG_MIME } from '../../lib/project-drag.js';
import { serializePromptEditor } from './serialize-prompt-editor.js';

const editorState = vi.hoisted(() => ({
  json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'before' }] }] } as unknown,
  options: undefined as undefined | {
    onUpdate?: (event: { editor: unknown }) => void;
    editorProps: {
      handleDrop: (view: unknown, event: DragEvent) => boolean;
      handleDOMEvents: { dragover: (view: unknown, event: DragEvent) => boolean };
    };
  }
}));

const chain = {
  focus: vi.fn().mockReturnThis(),
  setTextSelection: vi.fn().mockReturnThis(),
  insertContent: vi.fn().mockReturnThis(),
  run: vi.fn(() => true)
};
const editor = {
  getJSON: () => editorState.json,
  state: {
    selection: { empty: true, from: 0, to: 0, $from: { parent: { textBetween: () => '' } } },
    doc: { textBetween: () => '' }
  },
  setEditable: vi.fn(),
  isDestroyed: false,
  commands: { focus: vi.fn(), clearContent: vi.fn(), setContent: vi.fn() },
  view: { posAtCoords: vi.fn((): { pos: number } | null => ({ pos: 4 })) },
  chain: () => chain
};

vi.mock('@tiptap/react', () => ({
  useEditor: (options: typeof editorState.options) => {
    editorState.options = options;
    return editor;
  }
}));
vi.mock('../../lib/use-boolean-preference.js', () => ({ useBooleanPreference: () => [false] }));
vi.mock('../../lib/thread-composer-preferences.js', () => ({
  composerPromptExtensions: () => [],
  MARKDOWN_IN_PROMPT_DEFAULT: false,
  MARKDOWN_IN_PROMPT_KEY: 'markdown'
}));
vi.mock('../../lib/fetch-with-app-surface.js', () => ({ apiJson: async () => ({}) }));
vi.mock('../../lib/app-surface.js', () => ({ hasDesktopBridge: () => false }));
vi.mock('../../lib/product-client.js', () => ({
  product: {
    pluginApps: { onChanged: () => () => {} },
    skills: { onChanged: () => () => {} },
    threads: { commands: async () => ({ commands: [] }) },
    commands: { list: async () => [] },
    files: { pathForFile: () => '' },
    fs: { pickFiles: async () => [] }
  }
}));
vi.mock('./use-composer-suggestions.js', () => ({
  useMentionProviderRows: () => [],
  useComposerSuggestions: () => ({ suggestions: [], menuOpen: false })
}));

function Probe() {
  const field = useComposerPromptField({
    placeholder: 'Prompt',
    testId: 'prompt',
    projectId: 'p1',
    projects: [],
    slashCatalog: { kind: 'cli' },
    onSubmit: () => {}
  });
  return <span data-testid="text">{field.text}</span>;
}

describe('useComposerPromptField', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('rerenders consumers with updated serialized editor text', () => {
    render(<Probe />);
    expect(screen.getByTestId('text').textContent).toBe('before');

    editorState.json = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'after' }] }]
    };
    act(() => editorState.options?.onUpdate?.({ editor }));

    expect(screen.getByTestId('text').textContent).toBe('after');
  });

  const project = { id: 'other-project', name: 'Other project', path: '/other' } as Project;
  function renderField(disabled = false) {
    return renderHook(() => useComposerPromptField({
      placeholder: 'Prompt', testId: 'prompt', projectId: 'p1',
      projects: [project], disabled, slashCatalog: { kind: 'cli' }, onSubmit: vi.fn()
    }));
  }
  function projectDrop(id = project.id) {
    return {
      dataTransfer: {
        types: [PROJECT_DRAG_MIME, 'text/plain'], files: [],
        getData: (type: string) => type === PROJECT_DRAG_MIME ? id : '@Untrusted label'
      },
      clientX: 40, clientY: 20, preventDefault: vi.fn(), stopPropagation: vi.fn()
    } as unknown as DragEvent;
  }

  it('inserts a serializable project mention at the editor drop position and focuses the draft', () => {
    const { result } = renderField();
    const event = projectDrop();
    act(() => {
      result.current.dropHandlers.onDragOver(event as unknown as ReactDragEvent);
    });
    expect(result.current.dropOver).toBe(true);
    expect(event.dataTransfer?.dropEffect).toBe('copy');
    act(() => { expect(editorState.options?.editorProps.handleDrop(null, event)).toBe(true); });
    expect(chain.focus).toHaveBeenCalled();
    expect(chain.setTextSelection).toHaveBeenCalledWith(4);
    expect(serializePromptEditor({ type: 'doc', content: [{ type: 'paragraph', content: chain.insertContent.mock.calls[0][0] }] })).toEqual({
      text: '@Other project ',
      mentions: [{ start: 0, end: 14, resource: { kind: 'project', projectId: project.id, label: project.name } }]
    });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(result.current.dropOver).toBe(false);
  });

  it('uses the current selection when dropped on composer chrome', () => {
    const { result } = renderField();
    const event = projectDrop();
    act(() => result.current.dropHandlers.onDrop({
      nativeEvent: event, preventDefault: event.preventDefault
    } as unknown as ReactDragEvent));
    expect(chain.insertContent).toHaveBeenCalledOnce();
    expect(chain.setTextSelection).not.toHaveBeenCalled();
  });

  it.each([PROJECT_DRAG_MIME, 'Files', 'text/plain'])('recognizes %s consistently over the editor and composer chrome', (type) => {
    const { result } = renderField();
    const event = projectDrop();
    Object.assign(event.dataTransfer!, { types: [type] });
    act(() => { editorState.options?.editorProps.handleDOMEvents.dragover(null, event); });
    expect(result.current.dropOver).toBe(type !== 'text/plain');
    act(() => result.current.dropHandlers.onDragOver(event as unknown as ReactDragEvent));
    expect(result.current.dropOver).toBe(type !== 'text/plain');
    if (type === 'text/plain') expect(event.preventDefault).not.toHaveBeenCalled();
    else expect(event.preventDefault).toHaveBeenCalled();
  });

  it('keeps the selection when the editor cannot resolve drop coordinates', () => {
    renderField();
    editor.view.posAtCoords.mockReturnValueOnce(null);
    act(() => { editorState.options?.editorProps.handleDrop(null, projectDrop()); });
    expect(chain.insertContent).toHaveBeenCalledOnce();
    expect(chain.setTextSelection).not.toHaveBeenCalled();
  });

  it('consumes unknown projects without inserting their plain-text fallback', () => {
    renderField();
    const event = projectDrop('removed-project');
    act(() => { expect(editorState.options?.editorProps.handleDrop(null, event)).toBe(true); });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(chain.insertContent).not.toHaveBeenCalled();
  });

  it('does not change a disabled composer', () => {
    const { result } = renderField(true);
    const event = projectDrop();
    act(() => {
      result.current.dropHandlers.onDragOver(event as unknown as ReactDragEvent);
      expect(editorState.options?.editorProps.handleDrop(null, event)).toBe(false);
    });
    expect(result.current.dropOver).toBe(false);
    expect(chain.insertContent).not.toHaveBeenCalled();
  });
});
