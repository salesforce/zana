import { useRef, useSyncExternalStore } from 'react';

type Listener = () => void;

let activeId: symbol | null = null;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((listener) => listener());
}

function open(id: symbol) {
  if (activeId === id) return;
  activeId = id;
  emit();
}

function close(id: symbol) {
  if (activeId !== id) return;
  activeId = null;
  emit();
}

function isOpen(id: symbol) {
  return activeId === id;
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Drop-in replacement for `useState(false)` on a popover's open flag, except
 * only one such popover can be open across the whole app at a time — opening
 * one closes any other (harness/model/project pickers all share this, so they
 * no longer stack on screen simultaneously, see the composer toolbar).
 */
export function useExclusivePopover(): readonly [boolean, (next: boolean | ((current: boolean) => boolean)) => void] {
  const idRef = useRef<symbol | null>(null);
  if (!idRef.current) idRef.current = Symbol('popover');
  const id = idRef.current;
  const isCurrentlyOpen = useSyncExternalStore(subscribe, () => isOpen(id), () => false);

  const setOpen = (next: boolean | ((current: boolean) => boolean)) => {
    const resolved = typeof next === 'function' ? next(isOpen(id)) : next;
    if (resolved) open(id);
    else close(id);
  };

  return [isCurrentlyOpen, setOpen] as const;
}
