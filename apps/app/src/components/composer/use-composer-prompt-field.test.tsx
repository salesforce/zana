/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@zana-ai/zcc-domain/product';
import type { DragEvent as ReactDragEvent } from 'react';
import { useComposerPromptField } from './use-composer-prompt-field.js';
import { PROJECT_DRAG_MIME } from '../../lib/project-drag.js';
import { serializePromptEditor } from './serialize-prompt-editor.js';
import { COMPOSER_TERMINAL_COMMAND } from './composer-terminal-command.js';
import type { PromptInput } from '@zana-ai/zcc-domain/thread-runtime';

const native = vi.hoisted(() => vi.fn());
vi.mock('../../lib/native-capabilities.js', () => ({ nativeCapabilities: native }));

const attachments = vi.hoisted(() => ({ desktop: false, pickFiles: vi.fn(async (): Promise<string[]> => []) }));
const suggestionState = vi.hoisted(() => ({ commands: [] as Array<{ name: string; description: string }> }));
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
  on: vi.fn(), off: vi.fn(),
  getJSON: () => editorState.json,
  state: {
    selection: { empty: true, from: 0, to: 0, $from: { parent: { textBetween: () => '' } } },
    doc: { textBetween: () => '' }
  },
  setEditable: vi.fn(),
  isDestroyed: false,
  commands: { focus: vi.fn(), clearContent: vi.fn(), setContent: vi.fn((_content: unknown) => undefined) },
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
vi.mock('../../lib/app-surface.js', () => ({ hasDesktopBridge: () => attachments.desktop }));
vi.mock('../../lib/product-client.js', () => ({
  product: {
    pluginApps: { onChanged: () => () => {} },
    skills: { onChanged: () => () => {} },
    threads: { commands: async () => ({ commands: [] }) },
    commands: { list: async () => [] },
    files: { pathForFile: () => '' },
    fs: { pickFiles: attachments.pickFiles }
  }
}));
vi.mock('./use-composer-suggestions.js', () => ({
  useMentionProviderRows: () => [],
  useComposerSuggestions: (args: { commands: Array<{ name: string; description: string }> }) => {
    suggestionState.commands = args.commands;
    return { suggestions: [], menuOpen: false };
  }
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
  beforeEach(() => {
    vi.clearAllMocks();
    native.mockReset().mockResolvedValue({ commands: [], skills: [], diagnostics: [] });
    attachments.desktop = false;
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('keeps local terminal commands in the catalog when remote catalogs are empty', async () => {
    const localCommands = [COMPOSER_TERMINAL_COMMAND];
    renderHook(() => useComposerPromptField({
      placeholder: 'Prompt', testId: 'prompt', projectId: 'p1', projects: [],
      slashCatalog: { kind: 'thread', localCommands }, onSubmit: vi.fn()
    }));
    await waitFor(() => expect(suggestionState.commands).toContainEqual(COMPOSER_TERMINAL_COMMAND));
  });

  it('scopes native suggestions to the selected provider, host and recorded environment', async () => {
    native.mockResolvedValue({ commands: [{ name: '/grill-me', description: 'Challenge the plan' }], skills: [], diagnostics: [] });
    const { rerender } = renderHook(({ providerId }) => useComposerPromptField({
      placeholder: 'Prompt', testId: 'prompt', projectId: 'p1', hostId: 'remote', environmentId: 'worktree', projects: [],
      slashCatalog: { kind: 'thread', providerId }, onSubmit: vi.fn()
    }), { initialProps: { providerId: 'claude-code' } });
    await waitFor(() => expect(suggestionState.commands).toContainEqual({ name: '/grill-me', description: 'Challenge the plan' }));
    expect(native).toHaveBeenCalledWith({ projectId: 'p1', providerId: 'claude-code', hostId: 'remote', environmentId: 'worktree' });
    native.mockResolvedValue({ commands: [], skills: [], diagnostics: [] });
    rerender({ providerId: 'codex' });
    await waitFor(() => expect(suggestionState.commands).not.toContainEqual(expect.objectContaining({ name: '/grill-me' })));
    expect(native).toHaveBeenLastCalledWith({ projectId: 'p1', providerId: 'codex', hostId: 'remote', environmentId: 'worktree' });
  });

  it('reports a native discovery failure while retaining local commands', async () => {
    native.mockRejectedValue(new Error('Execution host offline'));
    const onError = vi.fn();
    const localCommands = [COMPOSER_TERMINAL_COMMAND];
    renderHook(() => useComposerPromptField({
      placeholder: 'Prompt', testId: 'prompt', projectId: 'p1', projects: [], onError,
      slashCatalog: { kind: 'cli', providerId: 'claude-code', localCommands }, onSubmit: vi.fn()
    }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Execution host offline'));
    expect(suggestionState.commands).toContainEqual(COMPOSER_TERMINAL_COMMAND);
  });

  it('keeps an offline host out of the composer error and reloads native commands on reconnect', async () => {
    native.mockRejectedValueOnce(Object.assign(new Error('host h1 is not connected'), { status: 503, code: 'host-unavailable' }));
    const onError = vi.fn();
    const { rerender } = renderHook(({ hostConnected }) => useComposerPromptField({
      placeholder: 'Prompt', testId: 'prompt', projectId: 'p1', hostId: 'h1', hostConnected, projects: [], onError,
      slashCatalog: { kind: 'thread', providerId: 'claude-code' }, onSubmit: vi.fn()
    }), { initialProps: { hostConnected: false } });
    await waitFor(() => expect(native).toHaveBeenCalledTimes(1));
    native.mockResolvedValue({ commands: [{ name: '/review', description: 'Review' }], skills: [], diagnostics: [] });
    rerender({ hostConnected: true });
    await waitFor(() => expect(suggestionState.commands).toContainEqual({ name: '/review', description: 'Review' }));
    expect(native).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps partial discovery diagnostics out of the composer error while showing suggestions', async () => {
    native.mockResolvedValue({ commands: [{ name: '/review', description: 'Review' }], skills: [], diagnostics: ['Claude Code: Invalid frontmatter in /skills/broken/SKILL.md (line 3): bad indentation of a mapping entry'] });
    const onError = vi.fn();
    renderHook(() => useComposerPromptField({
      placeholder: 'Prompt', testId: 'prompt', projectId: 'p1', projects: [], onError,
      slashCatalog: { kind: 'thread', providerId: 'claude-code' }, onSubmit: vi.fn()
    }));
    await waitFor(() => expect(suggestionState.commands).toContainEqual({ name: '/review', description: 'Review' }));
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports non-Error discovery failures without losing local commands', async () => {
    native.mockRejectedValue('Native resolver unavailable');
    const onError = vi.fn();
    const localCommands = [COMPOSER_TERMINAL_COMMAND];
    renderHook(() => useComposerPromptField({
      placeholder: 'Prompt', testId: 'prompt', projectId: 'p1', projects: [], onError,
      slashCatalog: { kind: 'cli', providerId: 'fixture', localCommands }, onSubmit: vi.fn()
    }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Native resolver unavailable'));
    expect(suggestionState.commands).toContainEqual(COMPOSER_TERMINAL_COMMAND);
  });

  it.each(['diagnostic', 'failure'])('ignores a late native %s after the composer has unmounted', async (kind) => {
    let finish!: () => void;
    native.mockImplementationOnce(() => new Promise((resolve, reject) => {
      finish = () => kind === 'failure'
        ? reject(new Error('Previous host offline'))
        : resolve({ commands: [], skills: [], diagnostics: ['Previous host warning'] });
    }));
    const onError = vi.fn();
    const { unmount } = renderHook(() => useComposerPromptField({
      placeholder: 'Prompt', testId: 'prompt', projectId: 'p1', projects: [], onError,
      slashCatalog: { kind: 'thread', providerId: 'fixture' }, onSubmit: vi.fn()
    }));
    unmount();
    await act(async () => finish());
    expect(onError).not.toHaveBeenCalled();
  });

  it('claims Cmd/Ctrl+Enter so the editor inserts no line break, and leaves the submit to the chrome handler', () => {
    const onSubmit = vi.fn();
    const { result } = renderHook(() => useComposerPromptField({
      placeholder: 'Prompt', testId: 'prompt', projectId: 'p1', projects: [],
      slashCatalog: { kind: 'cli' }, onSubmit
    }));
    const { handleKeyDown } = editorState.options!.editorProps as unknown as { handleKeyDown: (view: unknown, event: KeyboardEvent) => boolean };
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
      const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, ...modifier });
      expect(handleKeyDown({}, event)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(onSubmit).not.toHaveBeenCalled();
    expect(handleKeyDown({}, new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true }))).toBe(false);
    act(() => result.current.handleChromeKeyDown(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, cancelable: true }) as never));
    expect(onSubmit).toHaveBeenCalledWith({ modifierEnter: true });
  });

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

  it('restores structured text and attachments, supports removing one attachment and clearing the draft', () => {
    const { result } = renderHook(() => useComposerPromptField({
      placeholder: 'Prompt', testId: 'prompt', projectId: 'p1', projects: [],
      slashCatalog: { kind: 'cli' }, onSubmit: vi.fn()
    }));
    const text: PromptInput = { type: 'text', text: 'Review @Thread', mentions: [
      { start: 7, end: 14, resource: { kind: 'thread', threadId: 't1', label: 'Thread' } }
    ] };
    const first: PromptInput = { type: 'localImage', path: '/tmp/first.png' };
    const second: PromptInput = { type: 'localImage', path: '/tmp/second.png' };
    act(() => result.current.replacePrompt([text, first, second]));
    expect(serializePromptEditor(editor.commands.setContent.mock.calls.at(-1)![0])).toEqual({
      text: text.text, mentions: text.mentions
    });
    expect(result.current.restoredAttachments).toEqual([first, second]);
    act(() => result.current.removeRestoredAttachment(0));
    expect(result.current.restoredAttachments).toEqual([second]);
    act(() => result.current.clear());
    expect(result.current.restoredAttachments).toEqual([]);
    expect(editor.commands.clearContent).toHaveBeenCalled();
    act(() => result.current.replacePrompt([]));
    expect(serializePromptEditor(editor.commands.setContent.mock.calls.at(-1)![0])).toEqual({ text: '', mentions: [] });
  });

  it('rejects a malformed restored prompt without clearing the current draft or attachments', () => {
    const { result } = renderHook(() => useComposerPromptField({
      placeholder: 'Prompt', testId: 'prompt', projectId: 'p1', projects: [],
      slashCatalog: { kind: 'cli' }, onSubmit: vi.fn()
    }));
    const image: PromptInput = { type: 'localImage', path: '/tmp/kept.png' };
    act(() => result.current.replacePrompt([image]));
    editor.commands.clearContent.mockClear();
    editor.commands.setContent.mockClear();
    expect(() => result.current.replacePrompt([{ type: 'localImage', path: 123 } as unknown as PromptInput])).toThrow();
    expect(result.current.restoredAttachments).toEqual([image]);
    expect(editor.commands.clearContent).not.toHaveBeenCalled();
    expect(editor.commands.setContent).not.toHaveBeenCalled();
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

  function ImagePicker({ disabled = false, onError = vi.fn() }) {
    const field = useComposerPromptField({
      placeholder: 'Prompt', testId: 'prompt', projectId: 'p1', projects: [],
      disabled, slashCatalog: { kind: 'cli' }, onSubmit: vi.fn(), onError
    });
    return <>
      <input {...field.imageInputProps} data-testid="image-picker" />
      <button onClick={field.attachPickedFiles} disabled={!field.canAttach}>Attach files</button>
      {field.images.map((image) => <button key={image.id} onClick={() => field.removeImage(image.id)}>
        {image.name}
      </button>)}
    </>;
  }

  it('opens the browser picker synchronously, previews multiple images, and allows reselection', () => {
    const urls = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:screenshot');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const { unmount } = render(<ImagePicker />);
    const input = screen.getByTestId('image-picker') as HTMLInputElement;
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    expect(input.hidden).toBe(true);
    expect(input.accept).toBe('image/*');
    expect(input.multiple).toBe(true);
    fireEvent.click(screen.getByText('Attach files'));
    expect(click).toHaveBeenCalledOnce();
    expect(attachments.pickFiles).not.toHaveBeenCalled();
    const screenshot = new File(['png'], 'screenshot.png', { type: 'image/png' });
    const photo = new File(['jpeg'], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [screenshot, photo] } });
    expect(screen.getByText('screenshot.png')).toBeTruthy();
    expect(screen.getByText('photo.jpg')).toBeTruthy();
    expect(input.value).toBe('');
    expect(urls).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByText('screenshot.png'));
    expect(screen.queryByText('screenshot.png')).toBeNull();
    expect(revoke).toHaveBeenCalledOnce();
    fireEvent.change(input, { target: { files: [screenshot] } });
    expect(screen.getByText('screenshot.png')).toBeTruthy();
    unmount();
    expect(revoke).toHaveBeenCalledTimes(3);
  });

  it('leaves the draft intact on cancellation and reports rejected selections', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:valid');
    const onError = vi.fn();
    render(<ImagePicker onError={onError} />);
    const input = screen.getByTestId('image-picker');
    fireEvent.change(input, { target: { files: [] } });
    expect(onError).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { files: [
      new File(['text'], 'notes.txt', { type: 'text/plain' }),
      new File(['png'], 'valid.png', { type: 'image/png' })
    ] } });
    expect(onError).toHaveBeenCalledWith('Only image files can be attached as previews.');
    expect(screen.getByText('valid.png')).toBeTruthy();
    expect(chain.insertContent).not.toHaveBeenCalled();
  });

  it('ignores picker results while sending', () => {
    const urls = vi.spyOn(URL, 'createObjectURL');
    render(<ImagePicker disabled />);
    const input = screen.getByTestId('image-picker') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect((screen.getByText('Attach files') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { files: [new File(['png'], 'busy.png', { type: 'image/png' })] } });
    expect(urls).not.toHaveBeenCalled();
    const { result } = renderField(true);
    act(() => result.current.attachPickedFiles());
    expect(attachments.pickFiles).not.toHaveBeenCalled();
  });

  it('keeps the desktop file dialog and mention insertion', async () => {
    attachments.desktop = true;
    attachments.pickFiles.mockResolvedValueOnce(['/tmp/example.txt']);
    render(<ImagePicker />);
    const click = vi.spyOn(screen.getByTestId('image-picker'), 'click');
    fireEvent.click(screen.getByText('Attach files'));
    await waitFor(() => expect(chain.insertContent).toHaveBeenCalledOnce());
    expect(attachments.pickFiles).toHaveBeenCalledOnce();
    expect(click).not.toHaveBeenCalled();
    expect(chain.focus).toHaveBeenCalledOnce();
  });
});
