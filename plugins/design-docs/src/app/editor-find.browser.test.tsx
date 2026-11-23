// @vitest-environment happy-dom
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesignDocFile } from '../shared/contract.js';
import { FileEditor } from './FileEditor.js';
import { createHarness } from './test-harness.js';

const TEXT = 'Alpha beta\nbeta Gamma\nBETA end';
const FILE: DesignDocFile = {
  fileId: 'f1', path: 'README.md', kind: 'markdown', size: TEXT.length, revision: 1, updatedAt: 0, updatedBy: { kind: 'user', label: 'You' }, content: TEXT, encoding: 'utf8'
};

function renderEditor(split = false) {
  createHarness().render(<FileEditor docId="d1" file={FILE} split={split} renderPreview={() => null} />);
  return screen.getByRole('textbox', { name: 'Edit README.md' }) as HTMLTextAreaElement;
}
const ctrlF = (target: Element) => fireEvent.keyDown(target, { key: 'f', ctrlKey: true });
const findInput = () => screen.getByRole('searchbox', { name: 'Find in editor' }) as HTMLInputElement;
const count = () => screen.getByTestId('dom-find-bar-count').textContent;
const selected = (input: HTMLTextAreaElement) => input.value.slice(input.selectionStart, input.selectionEnd);
const type = (value: string) => fireEvent.change(findInput(), { target: { value } });

afterEach(() => vi.restoreAllMocks());

describe('find in the text editor', () => {
  it('opens on Ctrl+F while the textarea has focus, claiming the key', () => {
    const input = renderEditor();
    input.focus();
    expect(screen.queryByTestId('dom-find-bar')).toBeNull();
    // fireEvent returns false when the handler called preventDefault.
    expect(ctrlF(input)).toBe(false);
    expect(document.activeElement).toBe(findInput());
    expect(document.querySelector('.dd-editor[data-own-find]')).not.toBeNull();
  });

  it('counts case-insensitive matches, selects them and steps with wrap', () => {
    const input = renderEditor();
    ctrlF(input);
    type('beta');
    expect(count()).toBe('1/3');
    expect(input.selectionStart).toBe(6);
    expect(selected(input)).toBe('beta');
    fireEvent.keyDown(findInput(), { key: 'Enter' });
    expect(count()).toBe('2/3');
    expect(input.selectionStart).toBe(11);
    fireEvent.keyDown(findInput(), { key: 'Enter' });
    expect(selected(input)).toBe('BETA');
    fireEvent.keyDown(findInput(), { key: 'Enter' });
    expect(count()).toBe('1/3');
    fireEvent.keyDown(findInput(), { key: 'Enter', shiftKey: true });
    expect(count()).toBe('3/3');
    fireEvent.click(screen.getByRole('button', { name: 'Previous match' }));
    expect(count()).toBe('2/3');
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
    expect(count()).toBe('3/3');
  });

  it('shows 0/0 for no matches and leaves the selection alone', () => {
    const input = renderEditor();
    input.setSelectionRange(2, 2);
    ctrlF(input);
    type('zzz');
    expect(count()).toBe('0/0');
    expect(input.selectionStart).toBe(2);
    expect((screen.getByRole('button', { name: 'Next match' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('paints the matches on a backdrop behind the textarea, current match marked, and syncs its scroll', () => {
    const input = renderEditor();
    expect(document.querySelector('.dd-editor-backdrop')).toBeNull();
    ctrlF(input);
    type('beta');
    const backdrop = document.querySelector<HTMLElement>('.dd-editor-backdrop')!;
    expect(backdrop.textContent).toBe(TEXT);
    expect(Array.from(backdrop.querySelectorAll('mark')).map((mark) => mark.textContent)).toEqual(['beta', 'beta', 'BETA']);
    expect(backdrop.querySelectorAll('mark.dd-find-current')).toHaveLength(1);
    fireEvent.keyDown(findInput(), { key: 'Enter' });
    expect(backdrop.querySelectorAll('mark')[1].className).toContain('dd-find-current');
    input.scrollTop = 33;
    fireEvent.scroll(input);
    expect(backdrop.scrollTop).toBe(33);
    fireEvent.keyDown(findInput(), { key: 'Escape' });
    expect(document.querySelector('.dd-editor-backdrop')).toBeNull();
  });

  it('closes on Escape and returns focus to the editor, keeping the match selected', () => {
    const input = renderEditor();
    ctrlF(input);
    type('gamma');
    fireEvent.keyDown(findInput(), { key: 'Escape' });
    expect(screen.queryByTestId('dom-find-bar')).toBeNull();
    expect(document.activeElement).toBe(input);
    expect(selected(input)).toBe('Gamma');
  });

  it('does not change the text or the saved state', () => {
    const input = renderEditor();
    ctrlF(input);
    type('beta');
    fireEvent.keyDown(findInput(), { key: 'Enter' });
    fireEvent.keyDown(findInput(), { key: 'Escape' });
    expect(input.value).toBe(TEXT);
    expect(screen.getByText(/Saved · rev 1/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Save/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('seeds the query from a single-line selection and steps with F3', () => {
    const input = renderEditor();
    input.setSelectionRange(6, 10);
    ctrlF(input);
    expect(findInput().value).toBe('beta');
    fireEvent.keyDown(findInput(), { key: 'F3' });
    expect(count()).toBe('2/3');
    fireEvent.keyDown(findInput(), { key: 'F3', shiftKey: true });
    expect(count()).toBe('1/3');
  });

  it('does not seed from a multi-line selection', () => {
    const input = renderEditor();
    input.setSelectionRange(0, 15);
    ctrlF(input);
    expect(findInput().value).toBe('');
  });

  it('keeps the typed query and the current match on a second Ctrl+F, even when the match differs in case', () => {
    const input = renderEditor();
    ctrlF(input);
    type('beta');
    fireEvent.keyDown(findInput(), { key: 'Enter' });
    fireEvent.keyDown(findInput(), { key: 'Enter' });
    expect(selected(input)).toBe('BETA');
    expect(count()).toBe('3/3');
    ctrlF(findInput());
    expect(findInput().value).toBe('beta');
    expect(count()).toBe('3/3');
    expect(document.activeElement).toBe(findInput());
  });

  it('starts at the match nearest the caret, wrapping to the first', () => {
    const input = renderEditor();
    input.setSelectionRange(12, 12);
    ctrlF(input);
    type('beta');
    expect(count()).toBe('3/3');
    fireEvent.keyDown(findInput(), { key: 'Escape' });
    input.setSelectionRange(0, 0);
    ctrlF(input);
    type('beta');
    expect(count()).toBe('1/3');
    fireEvent.keyDown(findInput(), { key: 'Escape' });
    input.setSelectionRange(TEXT.length, TEXT.length);
    ctrlF(input);
    type('beta');
    expect(count()).toBe('1/3');
  });

  it('measures wrapping in a copy with the textarea usable width and the whole text', () => {
    const input = renderEditor();
    Object.defineProperty(input, 'clientWidth', { value: 321, configurable: true });
    const mirrors: Array<{ width: string; text: string }> = [];
    const append = document.body.append.bind(document.body);
    vi.spyOn(document.body, 'append').mockImplementation((...nodes: Array<Node | string>) => {
      const first = nodes[0] as HTMLElement;
      mirrors.push({ width: first.style.width, text: first.textContent ?? '' });
      append(...nodes);
    });
    ctrlF(input);
    type('gamma');
    expect(mirrors[0].width).toBe('321px');
    expect(mirrors[0].text.replace(String.fromCharCode(0x200b), '')).toBe(TEXT);
  });

  it('keeps the caret while typing in the editor with the bar open', () => {
    const input = renderEditor();
    ctrlF(input);
    type('beta');
    input.focus();
    fireEvent.change(input, { target: { value: `x${TEXT}` } });
    expect(count()).toBe('1/3');
    // The text changed, but the match was not re-selected over the caret.
    expect(input.selectionStart).toBe(input.selectionEnd);
  });

  it('works in split mode and ignores Escape when the bar is closed', () => {
    const input = renderEditor(true);
    expect(fireEvent.keyDown(input, { key: 'Escape' })).toBe(true);
    ctrlF(input);
    expect(findInput()).toBeTruthy();
  });

  it('scrolls a match that is off screen into view', () => {
    const input = renderEditor();
    Object.defineProperty(input, 'clientHeight', { value: 100, configurable: true });
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockReturnValue(900);
    ctrlF(input);
    type('end');
    expect(input.scrollTop).toBe(900 - (100 - 20) / 2);
  });

  it('leaves the scroll alone when the match is already visible', () => {
    const input = renderEditor();
    Object.defineProperty(input, 'clientHeight', { value: 500, configurable: true });
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockReturnValue(40);
    ctrlF(input);
    type('end');
    expect(input.scrollTop).toBe(0);
  });
});
