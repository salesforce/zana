/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Dialog } from './Dialog.js';
import { ConfirmDialog } from './settings/ui.js';

afterEach(cleanup);

describe('shared PR Monitor dialog', () => {
  it('keeps confirmation actions labeled and disabled during a destructive operation', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(<ConfirmDialog title="Delete repository?" message="Its monitored PRs will be removed."
      confirmLabel="Delete" danger busy onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    rerender(<ConfirmDialog title="Continue?" message="Confirm the change." onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('portals outside clipped panels, labels the dialog, traps focus and restores the opener', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    const { container, unmount } = render(<Dialog title="Repository settings" onClose={onClose} wide
      footer={<footer><button>Save</button></footer>}>
      <div className="prm-modal-body"><input aria-label="Repository" autoFocus /><button disabled>Disabled</button>
        <button hidden>Hidden</button><textarea aria-label="Notes" /></div>
    </Dialog>);
    const dialog = screen.getByRole('dialog', { name: 'Repository settings' });
    expect(container.contains(dialog)).toBe(false);
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(dialog.parentElement!);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('keeps focus contained and blocks every dismiss path while busy without resetting focus on updates', () => {
    const onClose = vi.fn();
    const { rerender } = render(<Dialog title="Import" onClose={onClose} busy><button disabled>Add</button></Dialog>);
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(dialog.parentElement!);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).not.toHaveBeenCalled();
    rerender(<Dialog title="Import" onClose={onClose}><button>Add</button></Dialog>);
    screen.getByRole('button', { name: 'Add' }).focus();
    rerender(<Dialog title="Import updated" onClose={onClose}><button>Add</button></Dialog>);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('lets only the top dialog handle Escape and respects a child handling the event', () => {
    const parentClose = vi.fn();
    const childClose = vi.fn();
    render(<><Dialog title="Parent" onClose={parentClose}>Parent content</Dialog>
      <Dialog title="Child" onClose={childClose}><button onKeyDown={(event) => event.preventDefault()}>Picker</button></Dialog>
    </>);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Picker' }), { key: 'Escape' });
    expect(childClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(childClose).toHaveBeenCalledTimes(1);
    expect(parentClose).not.toHaveBeenCalled();
  });
});
