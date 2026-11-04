// @vitest-environment happy-dom
import { useEffect } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const mounts = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));
vi.mock('./TerminalView.js', () => ({ TerminalView: ({ session, area }: any) => {
  useEffect(() => { mounts.mount(session.id); return () => mounts.unmount(session.id); }, [session.id]);
  return <div data-testid={session.id} data-area={area}>scrollback</div>;
} }));
import { PersistentTerminal } from './PersistentTerminal.js';
import { registerTerminalDock, useTerminalDockTargets } from '../lib/terminal-dock-targets.js';
afterEach(() => { cleanup(); vi.clearAllMocks(); document.body.innerHTML = ''; });
it('reparents the same mounted terminal between two docks and its original grid', () => {
  const a = document.createElement('div'), b = document.createElement('div');document.body.append(a, b);
  const session = { id: 'pty' } as any;
  const view = render(<PersistentTerminal session={session} area="b" target={null} />);
  const original = view.getByTestId('pty');
  view.rerender(<PersistentTerminal session={session} area={undefined} target={a} />);
  expect(a.contains(original)).toBe(true);expect(original.dataset.area).toBe('a');
  view.rerender(<PersistentTerminal session={session} area={undefined} target={b} />);
  expect(b.contains(original)).toBe(true);expect(a.children).toHaveLength(0);
  view.rerender(<PersistentTerminal session={session} area="b" target={null} />);
  expect(view.container.contains(original)).toBe(true);expect(original.dataset.area).toBe('b');
  expect(mounts.mount).toHaveBeenCalledTimes(1);expect(mounts.unmount).not.toHaveBeenCalled();
  view.unmount();expect(mounts.unmount).toHaveBeenCalledTimes(1);
});
it('releases only its own target registration when another surface owns the same terminal', () => {
  const a = document.createElement('div'), b = document.createElement('div');
  let targets: ReadonlyMap<string, HTMLElement> = new Map();
  function Probe() { targets = useTerminalDockTargets(); return null; }
  const view = render(<Probe />);
  let releaseA!: () => void, releaseB!: () => void;
  act(() => { releaseA = registerTerminalDock('pty', a); releaseB = registerTerminalDock('pty', b); });
  expect(targets.get('pty')).toBe(b);
  act(() => releaseA());expect(targets.get('pty')).toBe(b);
  act(() => releaseB());expect(targets.size).toBe(0);
  view.unmount();
});
