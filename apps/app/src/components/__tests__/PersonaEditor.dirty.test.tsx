// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn(), descriptors: vi.fn() }));
vi.mock('../../lib/product-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/product-client.js')>();
  return {
    ...actual,
    product: {
      ...actual.product,
      harness: { ...actual.product.harness, descriptors: mocks.descriptors },
      personas: { ...actual.product.personas, save: mocks.save, delete: mocks.remove }
    }
  };
});

import { PersonaEditor } from '../PersonaEditor.js';

const persona = { id: 'reviewer', name: 'Reviewer', source: 'user' as const };
const open = (onClose = vi.fn(), value = persona) => ({
  onClose,
  ...render(<PersonaEditor persona={value} mode="edit" onClose={onClose} />)
});

function makeDirty() {
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Changed' } });
}

beforeEach(() => {
  (globalThis as any).CSS ??= { escape: (value: string) => value };
  Element.prototype.scrollIntoView ??= () => {};
  mocks.descriptors.mockReset();
  mocks.descriptors.mockResolvedValue([]);
  mocks.save.mockReset();
  mocks.save.mockImplementation(async (input: { name: string }) => ({ ok: true, value: { ...persona, ...input } }));
  mocks.remove.mockReset();
  mocks.remove.mockResolvedValue({ ok: true });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('PersonaEditor dirty draft protection', () => {
  it('does not prompt after an edit is restored or descriptors load', async () => {
    let resolveDescriptors!: (value: []) => void;
    mocks.descriptors.mockReturnValue(new Promise((resolve) => { resolveDescriptors = resolve; }));
    const { onClose } = open();
    makeDirty();
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '' } });
    resolveDescriptors([]);
    await waitFor(() => expect(mocks.descriptors).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('sets a fresh baseline after switching from detail to edit', () => {
    const onClose = vi.fn();
    render(<PersonaEditor persona={persona} mode="view" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not refocus dialog after a field edit', () => {
    open();
    const description = screen.getByLabelText('Description') as HTMLInputElement;
    description.focus();
    fireEvent.change(description, { target: { value: 'Changed' } });
    expect(document.activeElement).toBe(description);
  });

  it('tracks raw hidden draft values', () => {
    const { onClose } = open();
    fireEvent.click(screen.getByLabelText('Restrict skills'));
    fireEvent.change(screen.getByLabelText('Allowed skills'), { target: { value: '  review  ' } });
    fireEvent.click(screen.getByLabelText('Restrict skills'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(window.confirm).toHaveBeenCalledWith('Discard unsaved changes?');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('clears dirty after a raw edit is restored', () => {
    const { onClose } = open(vi.fn(), { ...persona, skills: ['review'] });
    const skills = screen.getByLabelText('Allowed skills');
    fireEvent.change(skills, { target: { value: ' review ' } });
    fireEvent.change(skills, { target: { value: 'review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each(['Cancel', 'Close'])('keeps fields and rejects %s discard', (action) => {
    vi.mocked(window.confirm).mockReturnValue(false);
    const { onClose } = open();
    makeDirty();
    fireEvent.click(screen.getByRole('button', { name: action }));
    expect(window.confirm).toHaveBeenCalledWith('Discard unsaved changes?');
    expect((screen.getByLabelText('Description') as HTMLInputElement).value).toBe('Changed');
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each(['Escape', 'backdrop'])('keeps fields and rejects %s discard', (way) => {
    vi.mocked(window.confirm).mockReturnValue(false);
    const { container, onClose } = open();
    makeDirty();
    if (way === 'Escape') fireEvent.keyDown(container.querySelector('[role="dialog"]')!, { key: 'Escape' });
    else fireEvent.mouseDown(container.querySelector('.modal-backdrop')!);
    expect(window.confirm).toHaveBeenCalledWith('Discard unsaved changes?');
    expect((screen.getByLabelText('Description') as HTMLInputElement).value).toBe('Changed');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('allows discard close', () => {
    const { onClose } = open();
    makeDirty();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each([
    ['Delete', 'Discard unsaved changes and delete this persona?', persona],
    ['Reset', 'Discard unsaved changes and reset to the built-in default?', { ...persona, id: 'builtin:reviewer', source: 'builtin' as const }]
  ])('rejecting %s keeps draft and skips API', async (label, prompt, value) => {
    vi.mocked(window.confirm).mockReturnValue(false);
    open(vi.fn(), value);
    makeDirty();
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(window.confirm).toHaveBeenCalledWith(prompt);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Description') as HTMLInputElement).value).toBe('Changed');
  });

  it('accepting delete discards draft then calls delete without a close prompt', async () => {
    const { onClose } = open();
    makeDirty();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('reviewer'));
    expect(onClose).toHaveBeenCalledOnce();
    expect(window.confirm).toHaveBeenCalledTimes(1);
  });

  it('treats a persisted built-in override as Reset', async () => {
    const override = { ...persona, id: 'builtin:reviewer', source: 'user' as const };
    open(vi.fn(), override);
    expect(screen.getByRole('button', { name: 'Reset' }).getAttribute('title')).toBe('Reset to the built-in default');
    makeDirty();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(window.confirm).toHaveBeenCalledWith('Discard unsaved changes and reset to the built-in default?');
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('builtin:reviewer'));
  });

  it('save success closes without discard prompt, failure preserves draft', async () => {
    const success = open();
    makeDirty();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(success.onClose).toHaveBeenCalledOnce());
    expect(window.confirm).not.toHaveBeenCalled();
    cleanup();
    mocks.save.mockResolvedValueOnce({ ok: false, message: 'blocked' });
    const failure = open();
    makeDirty();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect((screen.getByLabelText('Description') as HTMLInputElement).value).toBe('Changed');
    expect(failure.onClose).not.toHaveBeenCalled();
  });
});
