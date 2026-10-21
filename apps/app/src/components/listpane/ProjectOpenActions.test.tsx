// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Project } from '@zana-ai/zcc-domain/product';

const h = vi.hoisted(() => ({ open: vi.fn(), copy: vi.fn(), toast: vi.fn(), settings: vi.fn(), desktop: true }));
vi.mock('../../lib/product-client.js', () => ({ product: { openers: { openIn: h.open } } }));
vi.mock('../../lib/app-surface.js', () => ({ hasDesktopBridge: () => h.desktop }));
vi.mock('../../lib/copy-text.js', () => ({ copyText: h.copy }));
vi.mock('../../store.js', () => ({ useUi: (selector: (state: unknown) => unknown) => selector({
  pushToast: h.toast, openProjectSettings: h.settings
}) }));

import { ProjectOpenActions } from './ProjectOpenActions.js';
import { FocusedProjectMenu } from './FocusedProjectMenu.js';
import { fileManagerName } from '../../lib/file-manager.js';

const project: Project = { id: 'p1', name: 'Example', path: '/tmp/project with spaces', createdAt: 0, lastActiveAt: 0 };
const close = vi.fn();
beforeEach(() => { vi.clearAllMocks(); h.desktop = true; h.open.mockResolvedValue({ ok: true }); h.copy.mockResolvedValue(undefined); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('project open actions', () => {
  it.each([
    ['Open in Cursor', 'cursor'], ['Open in VS Code', 'code'], ['Open in IntelliJ IDEA', 'intellij'],
    [`Reveal in ${fileManagerName()}`, 'finder'], ['Open in external Terminal', 'terminal']
  ])('opens the project root with %s and closes the menu', async (label, target) => {
    render(<ProjectOpenActions project={project} onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(h.open).toHaveBeenCalledWith(target, project.path));
    expect(close).toHaveBeenCalledOnce();
    expect(h.toast).not.toHaveBeenCalled();
  });
  it.each([{ remote: { host: 'devbox' } }, { hostId: 'other-host' }])('keeps local apps out of a remote project menu: %j', (patch) => {
    render(<ProjectOpenActions project={{ ...project, ...patch }} onClose={close} />);
    expect(screen.getAllByRole('button').map(el => el.textContent)).toEqual(['Copy path']);
  });
  it('keeps local apps out of browser and mobile surfaces', () => {
    h.desktop = false;
    render(<ProjectOpenActions project={project} onClose={close} />);
    expect(screen.getAllByRole('button').map(el => el.textContent)).toEqual(['Copy path']);
  });
  it.each([
    [{ ok: false, message: 'Install Cursor' }, 'Install Cursor'],
    [{ ok: false }, 'Failed to open in cursor']
  ])('surfaces a failed launch: %j', async (result, message) => {
    h.open.mockResolvedValue(result);
    render(<ProjectOpenActions project={project} onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open in Cursor' }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(message, 'error'));
  });
  it.each([[new Error('Bridge unavailable'), 'Bridge unavailable'], ['unexpected', 'Failed to open in cursor']])('surfaces a rejected launch: %s', async (error, message) => {
    h.open.mockRejectedValue(error);
    render(<ProjectOpenActions project={project} onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open in Cursor' }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(message, 'error'));
  });
  it.each([true, false])('reports whether copying the path succeeds: %s', async (success) => {
    if (!success) h.copy.mockRejectedValue(new Error('clipboard denied'));
    render(<ProjectOpenActions project={project} onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy path' }));
    expect(h.copy).toHaveBeenCalledWith(project.path);
    expect(close).toHaveBeenCalledOnce();
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(success ? 'Path copied' : 'Failed to copy path', success ? 'info' : 'error'));
  });
});

describe('focused project menu', () => {
  it('portals outside the rail, clamps to the viewport, and restores focus on dismiss', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 220, height: 260 } as DOMRect);
    const view = render(<FocusedProjectMenu project={project} x={window.innerWidth} y={window.innerHeight} onClose={close} />);
    const menu = screen.getByRole('group', { name: 'Project actions for Example' });
    expect(menu.parentElement).toBe(document.body);
    expect(menu.style.left).toBe(`${Math.max(8, window.innerWidth - 228)}px`);
    expect(menu.style.top).toBe(`${Math.max(8, window.innerHeight - 268)}px`);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open in Cursor' }));
    fireEvent.mouseDown(menu);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
    view.unmount();
    expect(document.activeElement).toBe(trigger);
    fireEvent.mouseDown(document.body);
    expect(close).toHaveBeenCalledOnce();
    trigger.remove();
  });
  it('dismisses on an outside click', () => {
    render(<FocusedProjectMenu project={project} x={-10} y={-10} onClose={close} />);
    expect(screen.getByRole('group').style.left).toBe('8px');
    expect(screen.getByRole('group').style.top).toBe('8px');
    fireEvent.mouseDown(document.body);
    expect(close).toHaveBeenCalledOnce();
  });
  it('opens settings for the selected project and closes the menu', () => {
    render(<FocusedProjectMenu project={project} x={10} y={10} onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Project settings…' }));
    expect(h.settings).toHaveBeenCalledWith(project.id);
    expect(close).toHaveBeenCalledOnce();
  });
});
