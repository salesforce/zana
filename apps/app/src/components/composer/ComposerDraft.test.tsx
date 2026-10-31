// @vitest-environment happy-dom
import { act, cleanup, render, renderHook, waitFor, fireEvent, screen } from '@testing-library/react';
import { EditorContent, type JSONContent } from '@tiptap/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComposerDraftProvider, useComposerSession, useComposerSetting, useRetainedText } from './ComposerDraft.js';
import { ComposerSession, composerSession, resetComposerSessions, MAX_COMPOSER_SESSIONS } from './composer-session.js';
import { useComposerPromptField } from './use-composer-prompt-field.js';
import { EDITOR_SELECTION_MIME, type EditorSelection } from '@zana-ai/zcc-plugin-sdk/app';
import { mentionAttrsForSuggestion } from './mention-attrs.js';

vi.mock('../../lib/fetch-with-app-surface.js', () => ({ apiJson: async () => ({}) }));
vi.mock('../../lib/app-surface.js', () => ({ hasDesktopBridge: () => false }));
vi.mock('../../lib/product-client.js', () => ({
  product: {
    pluginApps: { onChanged: () => () => {} },
    skills: { onChanged: () => () => {} },
    threads: { commands: async () => ({ commands: [] }) },
    commands: { list: async () => [] }
  }
}));
vi.mock('./use-composer-suggestions.js', () => ({
  useMentionProviderRows: () => [],
  useComposerSuggestions: () => ({ suggestions: [], menuOpen: false })
}));

let field: ReturnType<typeof useComposerPromptField>;
function Probe({ initialText, initialSelection }: { initialText?: string; initialSelection?: EditorSelection }) {
  field = useComposerPromptField({
    placeholder: 'Prompt', testId: 'prompt', projectId: 'project', projects: [],
    initialText, initialSelection, slashCatalog: { kind: 'cli' }, onSubmit: () => {}
  });
  return <EditorContent editor={field.editor} />;
}
function Surface({ mode, initialText, initialSelection, sessionKey }: { mode: string; initialText?: string; initialSelection?: EditorSelection; sessionKey?: string }) {
  return <ComposerDraftProvider sessionKey={sessionKey}><Probe key={mode} initialText={initialText} initialSelection={initialSelection} /></ComposerDraftProvider>;
}
const ready = () => waitFor(() => expect(field.editor).not.toBeNull());
beforeEach(() => { localStorage.clear(); resetComposerSessions(); });
afterEach(cleanup);

describe('shared composer draft', () => {
  it('restores a scoped draft and attachments after leaving and returning', async () => {
    const first = render(<Surface mode="modern" sessionKey="thread:a" />);
    await ready();
    act(() => {
      field.replacePrompt([{ type: 'text', text: 'Keep this' }, { type: 'localImage', path: '/project/image.png' }]);
      field.editor!.commands.setTextSelection(4);
    });
    const saved = field.editor!.getJSON();
    first.unmount();
    const other = render(<Surface mode="modern" sessionKey="thread:b" />);
    await ready();
    expect(field.text).toBe('');
    other.unmount();
    render(<Surface mode="modern" sessionKey="thread:a" initialText="Do not replace draft" />);
    await ready();
    expect(field.editor!.getJSON()).toEqual(saved);
    expect(field.restoredAttachments).toEqual([{ type: 'localImage', path: '/project/image.png' }]);
    expect(field.editor!.state.selection.from).toBe(4);
  });

  it('retains pasted image previews across navigation and releases them on clear', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:kept-image');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const view = render(<Surface mode="modern" sessionKey="images" />);
    await ready();
    const file = new File(['png'], 'image.png', { type: 'image/png' });
    act(() => field.imageInputProps.onChange({ currentTarget: { files: [file], value: 'image.png' } } as any));
    expect(field.images).toHaveLength(1);
    view.unmount();
    expect(revoke).not.toHaveBeenCalled();
    render(<Surface mode="modern" sessionKey="images" />);
    await ready();
    expect(field.images[0]?.file).toBe(file);
    act(() => field.clear());
    expect(revoke).toHaveBeenCalledWith('blob:kept-image');
    create.mockRestore(); revoke.mockRestore();
  });

  it('synchronizes a session updated by another mounted pane without changing its revision', async () => {
    render(<Surface mode="modern" sessionKey="shared" />);
    await ready();
    const session = composerSession('shared');
    const revision = session.getSnapshot().revision;
    act(() => session.setContent({ document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Other pane' }] }] } }));
    expect(field.text).toBe('Other pane');
    expect(session.getSnapshot().revision).toBe(revision + 1);
  });

  it('a late successful send clears the saved session but not newer content', async () => {
    const view = render(<Surface mode="modern" sessionKey="thread:a" initialText="Submitted" />);
    await ready();
    const submitted = field.captureRevision();
    const clearSubmitted = field.clearIfRevision;
    view.unmount();
    render(<Surface mode="modern" sessionKey="thread:a" />);
    await ready();
    act(() => field.setText('New draft'));
    act(() => { expect(clearSubmitted(submitted)).toBe(false); });
    expect(field.text).toBe('New draft');
    const current = field.captureRevision();
    act(() => { expect(clearSubmitted(current)).toBe(true); });
    expect(field.text).toBe('');
  });

  it('restores scoped settings and functional updates without changing content revisions', () => {
    let settings!: [number, (next: number | ((previous: number) => number)) => void, boolean];
    function Settings() {
      settings = useComposerSetting(useComposerSession(), 'mode.count', () => 2);
      return <div>{settings[0]}</div>;
    }
    const session = composerSession('settings');
    const view = render(<ComposerDraftProvider sessionKey="settings"><Settings /></ComposerDraftProvider>);
    expect(settings[0]).toBe(2);
    act(() => settings[1](previous => previous + 1));
    expect(settings[2]).toBe(true);
    expect(session.getSnapshot().revision).toBe(0);
    view.unmount();
    render(<ComposerDraftProvider sessionKey="settings"><Settings /></ComposerDraftProvider>);
    expect(settings[0]).toBe(3);
  });
  it('preserves rich text and mention identities through repeated mode changes', async () => {
    const { rerender } = render(<Surface mode="cli" />);
    await ready();
    const content: JSONContent = {
      type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'Review this ', marks: [{ type: 'bold' }] },
        { type: 'mention', attrs: mentionAttrsForSuggestion({ kind: 'project', projectId: 'project', name: 'Example' }) }
      ] }, { type: 'paragraph', content: [{ type: 'text', text: 'Second line' }] }]
    };
    act(() => { field.editor!.commands.setContent(content); });
    const saved = field.editor!.getJSON();
    const serialized = field.serialize();
    expect(serialized.mentions).toHaveLength(1);
    for (const mode of ['modern', 'squad', 'cli']) {
      const previous = field.editor;
      rerender(<Surface mode={mode} />);
      await ready();
      expect(field.editor).not.toBe(previous);
      expect(field.editor!.getJSON()).toEqual(saved);
      expect(field.serialize()).toEqual(serialized);
    }
    act(() => { field.setText('Edited in CLI'); });
    rerender(<Surface mode="squad" />);
    await ready();
    expect(field.text).toBe('Edited in CLI');
  });

  it('seeds once and keeps the edited draft instead of restoring the original seed', async () => {
    const { rerender } = render(<Surface mode="cli" initialText="Original seed" />);
    await ready();
    expect(field.text).toBe('Original seed');
    act(() => { field.setText('Edited seed'); });
    rerender(<Surface mode="modern" initialText="Original seed" />);
    await ready();
    expect(field.text).toBe('Edited seed');
  });

  it.each(['clear', 'delete'] as const)('keeps an empty draft after %s instead of resurrecting a seed', async (action) => {
    const { rerender } = render(<Surface mode="modern" initialText="Original seed" />);
    await ready();
    act(() => { action === 'clear' ? field.clear() : field.setText(''); });
    rerender(<Surface mode="squad" initialText="Original seed" />);
    await ready();
    expect(field.text).toBe('');
  });

  it('does not leak drafts into a different launcher or an existing thread composer', async () => {
    const { unmount } = render(<Surface mode="cli" initialText="Private draft" />);
    await ready();
    expect(field.text).toBe('Private draft');
    unmount();
    const other = render(<Surface mode="modern" />);
    await ready();
    expect(field.text).toBe('');
    other.unmount();
    render(<Probe initialText="Thread follow-up" />);
    await ready();
    expect(field.text).toBe('Thread follow-up');
  });
});

describe('seeded surfaces', () => {
  it('replaces an unedited earlier seed with a new one for the same surface', async () => {
    const first = render(<Surface mode="cli" sessionKey="launcher:p" initialText="Message A" />);
    await ready();
    expect(field.text).toBe('Message A');
    first.unmount();
    render(<Surface mode="cli" sessionKey="launcher:p" initialText="Message B" />);
    await ready();
    expect(field.text).toBe('Message B');
  });

  it('applies a new seed after the previous one was sent, and keeps the same seed cleared', async () => {
    const first = render(<Surface mode="cli" sessionKey="launcher:p" initialText="Message A" />);
    await ready();
    act(() => field.clear());
    first.unmount();
    const again = render(<Surface mode="cli" sessionKey="launcher:p" initialText="Message A" />);
    await ready();
    expect(field.text).toBe('');
    again.unmount();
    render(<Surface mode="cli" sessionKey="launcher:p" initialText="Message B" />);
    await ready();
    expect(field.text).toBe('Message B');
  });

  it('keeps user edits instead of a new seed, and reseeds on a prop change without remount', async () => {
    const view = render(<Surface mode="cli" sessionKey="panel:v" initialText="Plugin draft 1" />);
    await ready();
    view.rerender(<Surface mode="cli" sessionKey="panel:v" initialText="Plugin draft 2" />);
    await waitFor(() => expect(field.text).toBe('Plugin draft 2'));
    act(() => field.setText('My own words'));
    view.unmount();
    render(<Surface mode="cli" sessionKey="panel:v" initialText="Plugin draft 3" />);
    await ready();
    expect(field.text).toBe('My own words');
  });
});

describe('composer session ownership', () => {
  it('re-evaluates a setting fallback until the user chooses, and clear returns to it', () => {
    const session = new ComposerSession();
    const { result, rerender } = renderHook(({ host }) => useComposerSetting(session, 'modern.hostId', () => host), { initialProps: { host: '' } });
    rerender({ host: 'late-host' });
    expect(result.current[0]).toBe('late-host');
    expect(result.current[2]).toBe(false);
    act(() => result.current[1]('picked'));
    rerender({ host: 'other' });
    expect(result.current[0]).toBe('picked');
    act(() => result.current[3]());
    expect(result.current[0]).toBe('other');
  });

  it('shares a parent-supplied session with descendants', () => {
    const session = new ComposerSession('Draft storage is full.');
    let seen: ComposerSession | undefined;
    function Child() { seen = useComposerSession(); return null; }
    render(<ComposerDraftProvider sessionKey="launcher" session={session}><Child /></ComposerDraftProvider>);
    expect(seen).toBe(session);
  });

  it('disposes overflow sessions it handed out once their surface unmounts', () => {
    for (let index = 0; index < MAX_COMPOSER_SESSIONS; index++) composerSession(`full:${index}`).setSetting('team.title', 'x', { content: true });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    let seen: ComposerSession | undefined;
    function Child() { seen = useComposerSession(JSON.stringify(['thread', 'overflow'])); return null; }
    const view = render(<Child />);
    expect(seen?.retentionError).toMatch(/Draft storage is full/);
    const image = { id: 'i', previewSrc: 'blob:overflow', sizeBytes: 1 } as never;
    act(() => seen!.setContent({ images: [image] }));
    view.unmount();
    expect(revoke).toHaveBeenCalledWith('blob:overflow');
    revoke.mockRestore();
  });
});

describe('retained reply text', () => {
  it('keeps unsent text per key through unmount and frees it once cleared', () => {
    const first = renderHook(({ id }) => useRetainedText(JSON.stringify(['inbox-reply', id])), { initialProps: { id: 'a' } });
    expect(first.result.current[0]).toBe('');
    act(() => first.result.current[1]('Unsent answer'));
    first.rerender({ id: 'b' });
    expect(first.result.current[0]).toBe('');
    act(() => first.result.current[1](text => `${text}other`));
    expect(first.result.current[0]).toBe('other');
    first.unmount();
    const again = renderHook(() => useRetainedText(JSON.stringify(['inbox-reply', 'a'])));
    expect(again.result.current[0]).toBe('Unsent answer');
    expect(composerSession(JSON.stringify(['inbox-reply', 'a'])).reclaimable).toBe(false);
    act(() => again.result.current[1](''));
    again.unmount();
    expect(composerSession(JSON.stringify(['inbox-reply', 'a'])).reclaimable).toBe(true);
  });

  it('stays instance-local when draft storage is full', () => {
    for (let index = 0; index < MAX_COMPOSER_SESSIONS; index++) composerSession(`full:${index}`).setSetting('text', 'x', { content: true });
    const view = renderHook(() => useRetainedText('overflow'));
    act(() => view.result.current[1]('typed'));
    expect(view.result.current[0]).toBe('typed');
    view.unmount();
    expect(renderHook(() => useRetainedText('overflow')).result.current[0]).toBe('');
  });
});


const copiedSelection = { version: 1, path: 'force-app/Review.agent', startLine: 12, endLine: 14, text: 'reasoning:\n    instructions: |\n        Unsaved instruction' };
function pasteSelection(metadata = JSON.stringify(copiedSelection), text = copiedSelection.text) {
  const clipboardData = { getData: (type: string) => type === EDITOR_SELECTION_MIME ? metadata : type === 'text/plain' ? text : '', types: ['text/plain', EDITOR_SELECTION_MIME], files: [], items: [] };
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: clipboardData });
  act(() => field.editor!.view.dom.dispatchEvent(event));
  return event;
}

describe('pasted editor selection references', () => {
  it('seeds a passage chip, sends its snapshot and preserves removal across remounts', async () => {
    const selection = { version: 1 as const, path: 'README.md', text: 'Tokens expire after one hour.' };
    const view = render(<Surface mode="modern" sessionKey="doc-selection" initialText="Explain this" initialSelection={selection} />);
    await ready();
    const chip = await screen.findByRole('button', { name: 'Inspect README.md (selection)' });
    expect(screen.getByTestId('prompt').textContent).not.toContain(selection.text);
    expect(field.serialize().text).toContain(selection.text);
    fireEvent.click(chip);
    expect(screen.getByRole('dialog').textContent).toContain(selection.text);
    fireEvent.click(screen.getByRole('button', { name: 'Close selection preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove README.md (selection)' }));
    expect(field.serialize().text).not.toContain(selection.text);
    view.unmount();
    render(<Surface mode="modern" sessionKey="doc-selection" initialText="Explain this" initialSelection={selection} />);
    await ready();
    expect(screen.queryByRole('button', { name: 'Inspect README.md (selection)' })).toBeNull();
    expect(field.text).toBe('Explain this ');
  });
  it('pastes an inline chip with its exact snapshot, inspects, dismisses, removes and undoes', async () => {
    render(<Surface mode="modern" sessionKey="code-selection" />);
    await ready();
    act(() => field.editor!.commands.insertContent('Explain '));
    expect(pasteSelection().defaultPrevented).toBe(true);
    const chip = await screen.findByRole('button', { name: 'Inspect Review.agent (12–14)' });
    expect(screen.getByTestId('prompt').textContent).not.toContain('Unsaved instruction');
    expect(field.text).toContain(copiedSelection.text);
    expect(field.serialize().mentions).toEqual([]);
    expect(field.editor!.getHTML()).toContain('Review.agent (12–14)');
    expect(field.editor!.getText()).toContain(copiedSelection.text);
    fireEvent.click(chip);
    expect(screen.getByRole('dialog').textContent).toContain(copiedSelection.text);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(chip); fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
    vi.spyOn(chip, 'getBoundingClientRect').mockReturnValue({ top: 500, left: 30, bottom: 520 } as DOMRect);
    fireEvent.click(chip);
    expect(screen.getByRole('dialog').style.bottom).not.toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Close selection preview' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Review.agent (12–14)' }));
    expect(screen.queryByRole('button', { name: 'Inspect Review.agent (12–14)' })).toBeNull();
    expect(field.text).toBe('Explain ');
    act(() => field.editor!.commands.undo());
    expect(await screen.findByRole('button', { name: 'Inspect Review.agent (12–14)' })).toBeTruthy();
  });

  it('retains multiple references through navigation and clears them after submission', async () => {
    const view = render(<Surface mode="modern" sessionKey="retained-code" />);
    await ready(); pasteSelection(); pasteSelection();
    const json = field.editor!.getJSON();
    view.unmount();
    render(<Surface mode="modern" sessionKey="retained-code" />);
    await ready();
    expect(field.editor!.getJSON()).toEqual(json);
    expect(await screen.findAllByRole('button', { name: 'Inspect Review.agent (12–14)' })).toHaveLength(2);
    act(() => field.clear());
    expect(field.text).toBe('');
    expect(screen.queryByRole('button', { name: 'Inspect Review.agent (12–14)' })).toBeNull();
  });

  it('leaves ordinary, stale and paste-as-plain-text content as editable text', async () => {
    render(<Surface mode="modern" />); await ready();
    pasteSelection('{broken', 'ordinary paste');
    expect(screen.queryByRole('button', { name: /Inspect/ })).toBeNull();
    expect(field.text).toBe('ordinary paste');
    act(() => field.clear());
    pasteSelection(JSON.stringify(copiedSelection), 'unrelated clipboard');
    expect(field.text).toBe('unrelated clipboard');
    act(() => field.clear());
    // Native menu accelerators can consume V after delivering the Shift key.
    fireEvent.keyDown(field.editor!.view.dom, { key: 'Shift', ctrlKey: true, shiftKey: true });
    pasteSelection();
    expect(screen.queryByRole('button', { name: /Inspect/ })).toBeNull();
    expect(field.text).toBe(copiedSelection.text);
    act(() => field.clear());
    fireEvent.keyDown(field.editor!.view.dom, { key: 'v', ctrlKey: true, shiftKey: true });
    fireEvent.keyUp(field.editor!.view.dom, { key: 'v' });
    pasteSelection();
    expect(await screen.findByRole('button', { name: /Inspect/ })).toBeTruthy();
  });
});


it('ignores invalid retained selection nodes when displaying or serializing a draft', async () => {
  render(<Surface mode="modern" />); await ready();
  act(() => field.editor!.commands.insertContent({ type: 'editorSelection', attrs: { selection: null } }));
  expect(screen.queryByRole('button', { name: /Inspect/ })).toBeNull();
  expect(field.editor!.getText()).toBe('');
  expect(field.editor!.getHTML()).not.toContain('Review.agent');
});
