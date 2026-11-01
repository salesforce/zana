// @vitest-environment jsdom
import { createRef, Profiler } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ComposerTypeaheadMenu } from './ComposerTypeaheadMenu.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});

const suggestions = Array.from({ length: 24 }, (_, index) => ({
  kind: 'command' as const, name: `/command-${index}`, description: 'Available command'
}));

it('escapes clipping ancestors and preserves editor focus on pointer selection', () => {
  const anchorRef = createRef<HTMLDivElement>();
  const apply = vi.fn();
  const backdrop = vi.fn();
  const { container } = render(<div onMouseDown={backdrop} style={{ overflow: 'hidden' }}>
    <div ref={anchorRef}><input aria-label="Prompt" /></div>
    <ComposerTypeaheadMenu anchorRef={anchorRef} suggestions={suggestions} selectedIndex={0} triggerKind="command" onApply={apply} />
  </div>);
  const menu = screen.getByRole('listbox');
  expect(menu.parentElement).toBe(document.body);
  expect(container.contains(menu)).toBe(false);
  const input = screen.getByRole('textbox');
  input.focus();
  fireEvent.mouseDown(screen.getAllByRole('option')[23]);
  expect(apply).toHaveBeenCalledWith(suggestions[23]);
  expect(document.activeElement).toBe(input);
  expect(backdrop).not.toHaveBeenCalled();
});

it('scrolls only the menu to reveal keyboard selection below and above the visible rows', () => {
  const props = { suggestions, selectedIndex: 0, triggerKind: 'command' as const, onApply: vi.fn() };
  const { rerender } = render(<ComposerTypeaheadMenu {...props} />);
  const menu = screen.getByRole('listbox');
  vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 300 } as DOMRect);
  const options = screen.getAllByRole('option');
  vi.spyOn(options[23], 'getBoundingClientRect').mockReturnValue({ top: 400, bottom: 430 } as DOMRect);
  rerender(<ComposerTypeaheadMenu {...props} selectedIndex={23} />);
  expect(menu.scrollTop).toBe(130);
  vi.spyOn(options[0], 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 30 } as DOMRect);
  rerender(<ComposerTypeaheadMenu {...props} selectedIndex={0} />);
  expect(menu.scrollTop).toBe(30);
});

it('tracks anchor resizing and ancestor scrolling and releases every subscription on close', () => {
  let resized = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const anchor = document.createElement('div');
  const parent = document.createElement('div');
  parent.className = 'launch-modal';
  parent.append(anchor);
  document.body.append(parent);
  const anchorRef = { current: anchor };
  let top = 350;
  const measure = vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => ({ left: 10, top, bottom: top + 60, width: 500 }) as DOMRect);
  vi.stubGlobal('innerHeight', 600);
  const remove = vi.spyOn(window, 'removeEventListener');
  const { unmount } = render(<ComposerTypeaheadMenu anchorRef={anchorRef} suggestions={suggestions} selectedIndex={-1} triggerKind="command" onApply={vi.fn()} />);
  const menu = screen.getByRole('listbox');
  expect(menu.style.bottom).toBe('258px');
  const measurements = measure.mock.calls.length;
  fireEvent.scroll(menu);
  expect(measure).toHaveBeenCalledTimes(measurements);
  top = 20;
  fireEvent.resize(window);
  expect(menu.style.top).toBe('88px');
  expect(menu.style.bottom).toBe('');
  top = 30;
  fireEvent.scroll(parent);
  expect(menu.style.top).toBe('98px');
  top = 40;
  act(() => resized());
  expect(menu.style.top).toBe('108px');
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
  expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function), true);
  parent.remove();
});

it('renders mention kinds and safely handles an empty selection', () => {
  render(<ComposerTypeaheadMenu suggestions={[
    { kind: 'path', path: 'src', name: 'src', entryKind: 'directory' },
    { kind: 'project', projectId: 'p1', name: 'Project' },
    { kind: 'plugin', pluginId: 'test-plugin', providerId: 'test', id: '1', label: 'Plugin item' },
    { kind: 'thread', threadId: 't1', projectId: 'p1', title: 'Thread' }
  ]} selectedIndex={-1} triggerKind="mention" onApply={vi.fn()} />);
  expect(screen.getByRole('listbox', { name: 'Mentions' })).toBeTruthy();
  expect(screen.getAllByRole('option')).toHaveLength(4);
});

it.each(['home', 'expanded'])('prefers above the %s mobile composer and follows the visible viewport', (context) => {
  const shell = document.createElement('div');
  shell.className = 'app-shell';
  shell.dataset.mobile = 'true';
  const anchor = document.createElement('div');
  if (context === 'home') anchor.className = 'home-agent-composer';
  else anchor.dataset.mobileExpanded = 'true';
  shell.append(anchor);
  document.body.append(shell);
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 220, bottom: 260, width: 350 } as DOMRect);
  vi.stubGlobal('innerHeight', 800);
  const viewport = Object.assign(new EventTarget(), { width: 390, height: 600, offsetTop: 0, offsetLeft: 0 });
  vi.stubGlobal('visualViewport', viewport);
  const remove = vi.spyOn(viewport, 'removeEventListener');
  const { unmount } = render(<ComposerTypeaheadMenu anchorRef={{ current: anchor }} suggestions={suggestions} selectedIndex={-1} triggerKind="command" onApply={vi.fn()} />);
  const menu = screen.getByRole('listbox');
  expect(menu.style.bottom).toBe('588px');
  expect(menu.style.maxHeight).toBe('204px');
  viewport.height = 300;
  act(() => viewport.dispatchEvent(new Event('resize')));
  expect(menu.style.maxHeight).toBe('126px');
  viewport.offsetTop = 180;
  viewport.offsetLeft = 20;
  act(() => viewport.dispatchEvent(new Event('scroll')));
  expect(menu.style.left).toBe('28px');
  expect(menu.style.top).toBe(context === 'expanded' ? '228px' : '268px');
  expect(menu.style.bottom).toBe('');
  unmount();
  expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
  expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
  shell.remove();
});

it('keeps desktop home below the prompt when both sides have room', () => {
  const anchor = document.createElement('div');
  anchor.className = 'home-agent-composer';
  document.body.append(anchor);
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 220, bottom: 260, width: 350 } as DOMRect);
  vi.stubGlobal('innerHeight', 800);
  render(<ComposerTypeaheadMenu anchorRef={{ current: anchor }} suggestions={suggestions} selectedIndex={-1} triggerKind="command" onApply={vi.fn()} />);
  expect(screen.getByRole('listbox').style.top).toBe('268px');
  anchor.remove();
});

it('overlays the expanded editor when the field fills the visible viewport', () => {
  const anchor = document.createElement('div');
  anchor.dataset.mobileExpanded = 'true';
  document.body.append(anchor);
  vi.stubGlobal('innerHeight', 600);
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 72, bottom: 580, width: 350 } as DOMRect);
  render(<ComposerTypeaheadMenu anchorRef={{ current: anchor }} suggestions={suggestions} selectedIndex={-1} triggerKind="command" onApply={vi.fn()} />);
  const menu = screen.getByRole('listbox');
  expect(menu.style.top).toBe('80px');
  expect(menu.style.maxHeight).toBe('252px');
  anchor.remove();
});

it('preserves a manual scroll when the anchor moves and skips unchanged placement commits', () => {
  const anchor = document.createElement('div');
  document.body.append(anchor);
  let top = 100;
  vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => ({ left: 10, top, bottom: top + 60, width: 500 }) as DOMRect);
  const committed = vi.fn();
  render(<Profiler id="menu" onRender={committed}><ComposerTypeaheadMenu anchorRef={{ current: anchor }} suggestions={suggestions} selectedIndex={0} triggerKind="command" onApply={vi.fn()} /></Profiler>);
  const menu = screen.getByRole('listbox');
  vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 300 } as DOMRect);
  vi.spyOn(screen.getAllByRole('option')[0], 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 30 } as DOMRect);
  menu.scrollTop = 150;
  fireEvent.scroll(menu);
  top = 120;
  fireEvent.scroll(window);
  expect(menu.scrollTop).toBe(150);
  committed.mockClear();
  fireEvent.resize(window);
  fireEvent.scroll(window);
  expect(committed).not.toHaveBeenCalled();
  anchor.remove();
});
