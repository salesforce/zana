/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useComposerPromptField } from './use-composer-prompt-field.js';

const editorState = vi.hoisted(() => ({
  json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'before' }] }] } as unknown,
  options: undefined as undefined | { onUpdate?: (event: { editor: unknown }) => void }
}));

const editor = {
  getJSON: () => editorState.json,
  state: {
    selection: { empty: true, from: 0, to: 0, $from: { parent: { textBetween: () => '' } } },
    doc: { textBetween: () => '' }
  },
  setEditable: vi.fn(),
  isDestroyed: false,
  commands: { focus: vi.fn(), clearContent: vi.fn(), setContent: vi.fn() },
  chain: () => ({ insertContent: () => ({ run: vi.fn() }) })
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
});
