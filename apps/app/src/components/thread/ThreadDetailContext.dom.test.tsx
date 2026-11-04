// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThreadDetailContext, type ThreadDetailContextAgent } from './ThreadDetailContext.js';

const agent: ThreadDetailContextAgent = {
  providerId: 'claude-code', model: 'claude-opus-5[1m]',
  projectName: 'zana-command-center', branchName: 'fix/a-very-long-project-context-menu-branch',
  machineName: 'Development machine', machineRemote: true
};
const empty: ThreadDetailContextAgent = { providerId: null, model: null, projectName: null, branchName: null };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const trigger = () => screen.getByRole('button', { name: 'Thread context', exact: true });
const dialog = () => screen.getByRole('dialog', { name: 'Thread context' });

describe('balanced thread metadata', () => {
  it('reveals all current values in a named, portaled popover and restores focus on close', () => {
    const { container, rerender } = render(<ThreadDetailContext agent={agent} />);
    expect(screen.getByTitle('Claude Code · Opus 5 (1M)').textContent).toBe('Claude Code · Opus 5 (1M)');
    expect(trigger().textContent).toContain(agent.projectName);
    expect(trigger().textContent).toContain(agent.branchName);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(trigger());
    const popover = dialog();
    expect(container.contains(popover)).toBe(false);
    expect(trigger().getAttribute('aria-controls')).toBe(popover.id);
    for (const text of ['Claude Code', 'Opus 5 (1M)', agent.projectName!, agent.branchName!, agent.machineName!]) {
      expect(within(popover).getByText(text)).toBeTruthy();
    }
    expect(popover.querySelector('.lucide-server')).toBeTruthy();
    expect(document.activeElement).toBe(within(popover).getByRole('button', { name: 'Close thread context' }));
    rerender(<ThreadDetailContext agent={{ ...agent, branchName: 'fix/updated', machineRemote: false }} />);
    expect(within(dialog()).getByText('fix/updated')).toBeTruthy();
    expect(dialog().querySelector('.lucide-laptop')).toBeTruthy();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close thread context' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('supports keyboard dismissal and ignores unrelated keys and interactions inside the popover', () => {
    render(<ThreadDetailContext agent={agent} />);
    fireEvent.click(trigger());
    fireEvent.pointerDown(within(dialog()).getByText(agent.branchName!));
    fireEvent.scroll(dialog());
    fireEvent.keyDown(dialog(), { key: 'ArrowDown' });
    expect(dialog()).toBeTruthy();
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger());
    fireEvent.click(trigger());
    fireEvent.pointerDown(trigger());
    fireEvent.click(trigger());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('dismisses on outside pointer or focus without stealing focus from the new target', () => {
    render(<><ThreadDetailContext agent={agent} /><button>Outside</button></>);
    fireEvent.click(trigger());
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(trigger());
    act(() => screen.getByRole('button', { name: 'Outside' }).focus());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Outside' }));
  });

  it('dismisses stale positioning on resize and ancestor scroll', () => {
    render(<ThreadDetailContext agent={agent} />);
    fireEvent.click(trigger());
    fireEvent.resize(window);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(trigger());
    fireEvent.scroll(document);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders only known rows, even when provider identity is unavailable', () => {
    const { rerender } = render(<ThreadDetailContext agent={empty} />);
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<ThreadDetailContext agent={{ ...empty, projectName: 'Only project' }} />);
    expect(trigger().textContent).toBe('Only project');
    fireEvent.click(trigger());
    expect(dialog().querySelectorAll('dt')).toHaveLength(1);
    expect(within(dialog()).getByText('Only project')).toBeTruthy();
    expect(dialog().querySelector('.lucide-folder')).toBeTruthy();
    rerender(<ThreadDetailContext agent={{ ...empty, model: 'custom-model' }} />);
    expect(screen.getByTitle('custom-model').textContent).toBe('custom-model');
    expect(within(dialog()).getByText('Model')).toBeTruthy();
  });

  it('clamps the popover to the viewport and keeps long context as safe text', () => {
    render(<ThreadDetailContext agent={{ ...empty, branchName: '<script>long-branch</script>' }} />);
    vi.spyOn(trigger(), 'getBoundingClientRect').mockReturnValue({
      left: window.innerWidth - 30, right: window.innerWidth - 2,
      top: 10, bottom: 38, width: 28, height: 28, x: window.innerWidth - 30, y: 10, toJSON() {}
    });
    fireEvent.click(trigger());
    expect(parseFloat(dialog().style.left) + parseFloat(dialog().style.width)).toBeLessThanOrEqual(window.innerWidth - 8);
    expect(within(dialog()).getByText('<script>long-branch</script>')).toBeTruthy();
    expect(dialog().querySelector('script')).toBeNull();
  });

  it('releases document and window listeners and its portal when unmounted', () => {
    const addDocument = vi.spyOn(document, 'addEventListener');
    const removeDocument = vi.spyOn(document, 'removeEventListener');
    const addWindow = vi.spyOn(window, 'addEventListener');
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<ThreadDetailContext agent={agent} />);
    fireEvent.click(trigger());
    const owned = addDocument.mock.calls.filter(([name]) => ['pointerdown', 'focusin', 'keydown', 'scroll'].includes(name));
    const resize = addWindow.mock.calls.find(([name]) => name === 'resize')!;
    unmount();
    for (const call of owned) expect(removeDocument.mock.calls).toContainEqual(call);
    expect(removeWindow.mock.calls).toContainEqual(resize);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows machine context when a project is unavailable', () => {
    render(<ThreadDetailContext agent={{ ...empty, machineName: 'Remote devbox', machineRemote: true }} />);
    expect(trigger().textContent).toBe('Remote devbox');
    expect(trigger().querySelector('.lucide-server')).toBeTruthy();
    fireEvent.click(trigger());
    expect(within(dialog()).getByText('Remote devbox')).toBeTruthy();
  });

  it('keeps context interaction out of the heading drag handler, including portaled controls', () => {
    const drag = vi.fn();
    render(<div onPointerDown={drag}><ThreadDetailContext agent={agent} /></div>);
    fireEvent.pointerDown(trigger());
    fireEvent.click(trigger());
    fireEvent.pointerDown(within(dialog()).getByRole('button', { name: 'Close thread context' }));
    expect(drag).not.toHaveBeenCalled();
  });
});
