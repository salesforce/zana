import { useEffect, useRef, useState, type RefObject } from 'react';
import { useUi } from '../store.js';
import { registerThreadFindTarget } from './thread-find.js';

export interface ThreadFindTargetOptions {
  /** The whole thread view, side panel included. */
  viewRef: RefObject<HTMLElement | null>;
  /** The conversation column that owns the search field. */
  mainRef: RefObject<HTMLElement | null>;
  embedded: boolean;
  modal: boolean;
  paneFocused: boolean;
  /** Compact header: open the collapsed search before focusing it. */
  onOpenCollapsed?: () => void;
}

/**
 * Registers a thread view for the `thread.find` shortcut. Returns a counter
 * that goes up on each press, for `ThreadDetailSearch`'s `focusRequest`.
 */
export function useThreadFindTarget({ viewRef, mainRef, ...state }: ThreadFindTargetOptions): number {
  const [focusRequest, setFocusRequest] = useState(0);
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => registerThreadFindTarget({
    root: () => viewRef.current,
    main: () => mainRef.current,
    isPrimary: () => {
      const view = viewRef.current;
      const { embedded, modal, paneFocused } = latest.current;
      if (!view || view.getClientRects().length === 0 || embedded || !paneFocused) return false;
      const ui = useUi.getState();
      return modal || (!ui.threadModal && !ui.agentModal);
    },
    open: () => {
      latest.current.onOpenCollapsed?.();
      setFocusRequest((value) => value + 1);
    }
  }), [viewRef, mainRef]);
  return focusRequest;
}
