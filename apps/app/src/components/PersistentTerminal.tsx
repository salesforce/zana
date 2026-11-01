import { useLayoutEffect, useRef, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { TerminalView } from './TerminalView.js';
import './thread/secondary-panel/thread-tool-dock.css';

/** One portal container per session for its entire lifetime, even across docks. */
export function PersistentTerminal({ target, ...props }: ComponentProps<typeof TerminalView> & { target: HTMLElement | null }) {
  const parking = useRef<HTMLSpanElement>(null);
  const container = useRef<HTMLDivElement | null>(null);
  if (!container.current) container.current = document.createElement('div');
  useLayoutEffect(() => {
    const node = container.current!;
    const parent = target ?? parking.current;
    node.className = target ? 'terminal-session-portal is-docked terminal-surface layout-single' : 'terminal-session-portal';
    if (parent && node.parentElement !== parent) parent.appendChild(node);
  });
  useLayoutEffect(() => () => { container.current?.remove(); }, []);
  return <><span ref={parking} style={{ display: 'contents' }} />{createPortal(<TerminalView {...props} area={target ? 'a' : props.area} />, container.current)}</>;
}
