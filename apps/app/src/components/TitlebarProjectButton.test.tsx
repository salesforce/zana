// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@zana-ai/zcc-domain/product';

vi.mock('./listpane/FocusedProjectMenu.js', () => ({
  FocusedProjectMenu: ({ project, x, y, onClose }: { project: Project; x: number; y: number; onClose: () => void }) => (
    <div data-testid="focused-project-menu" data-project={project.id} data-x={x} data-y={y}>
      <button onClick={onClose}>Close project menu</button>
    </div>
  )
}));

import { TitlebarProjectButton } from './TitlebarProjectButton.js';

const project: Project = {
  id: 'proj-1',
  name: 'btgsdigico--agentaidev',
  path: '/tmp/agentaidev',
  createdAt: 0,
  lastActiveAt: 0
};

const trigger = () => screen.getByRole('button', { name: 'Project actions for btgsdigico--agentaidev' });

describe('TitlebarProjectButton', () => {
  afterEach(cleanup);

  it('names the project in the titlebar slot and stays a no-drag menu trigger', () => {
    render(<TitlebarProjectButton project={project} />);
    const button = trigger();
    expect(button.className).toContain('titlebar-title');
    expect(button.className).toContain('titlebar-project');
    expect(button.textContent).toBe('btgsdigico--agentaidev');
    expect(button.getAttribute('title')).toBe('/tmp/agentaidev');
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Remote SSH project')).toBeNull();
  });

  it('opens the project actions menu under the name and toggles it closed on a second click', () => {
    render(<TitlebarProjectButton project={project} />);
    const button = trigger();
    button.getBoundingClientRect = () => ({ left: 300, bottom: 30 } as DOMRect);
    fireEvent.click(button);
    const menu = screen.getByTestId('focused-project-menu');
    expect(menu.dataset.project).toBe(project.id);
    expect(menu.dataset.x).toBe('300');
    expect(menu.dataset.y).toBe('34');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.className).toContain('active');

    // The menu dismisses on window mousedown; the open trigger must not let that
    // close-then-reopen, so its mousedown is stopped and the click closes it.
    const windowMouseDown = vi.fn();
    window.addEventListener('mousedown', windowMouseDown);
    fireEvent.mouseDown(button);
    window.removeEventListener('mousedown', windowMouseDown);
    expect(windowMouseDown).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(screen.queryByTestId('focused-project-menu')).toBeNull();
  });

  it('lets mousedown through while closed, so other open menus still dismiss', () => {
    render(<TitlebarProjectButton project={project} />);
    const windowMouseDown = vi.fn();
    window.addEventListener('mousedown', windowMouseDown);
    fireEvent.mouseDown(trigger());
    window.removeEventListener('mousedown', windowMouseDown);
    expect(windowMouseDown).toHaveBeenCalledTimes(1);
  });

  it('opens at the pointer on right-click and closes through the menu', () => {
    render(<TitlebarProjectButton project={project} />);
    fireEvent.contextMenu(trigger(), { clientX: 410, clientY: 18 });
    const menu = screen.getByTestId('focused-project-menu');
    expect(menu.dataset.x).toBe('410');
    expect(menu.dataset.y).toBe('18');
    fireEvent.click(screen.getByRole('button', { name: 'Close project menu' }));
    expect(screen.queryByTestId('focused-project-menu')).toBeNull();
  });

  it('marks remote projects like the rail did', () => {
    render(<TitlebarProjectButton project={{ ...project, remote: { host: 'limited-pony' } } as Project} />);
    expect(screen.getByLabelText('Remote SSH project')).toBeTruthy();
  });
});
