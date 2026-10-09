import { useCallback, useEffect, useMemo, useRef, type MutableRefObject, type RefObject } from 'react';
import {
  isPlaygroundToHost,
  PLAYGROUND_BRIDGE_SOURCE,
  readDocumentTheme,
  type HostToPlayground,
  type PlaygroundToHost
} from '../playground-bridge.js';

type Body<T extends HostToPlayground['type']> = Omit<Extract<HostToPlayground, { type: T }>, 'source' | 'type'>;
type Incoming<T extends PlaygroundToHost['type']> = Extract<PlaygroundToHost, { type: T }>;

export function postToPlayground(frame: HTMLIFrameElement | null, message: HostToPlayground): void {
  try {
    frame?.contentWindow?.postMessage(message, window.location.origin);
  } catch {
    // iframe may still be about:blank (tests) or not yet same-origin
  }
}

/** Typed host -> playground senders. Every sender is stable across renders. */
export interface PlaygroundSend {
  init(body: Body<'init'>): void;
  setFile(body: Body<'setFile'>): void;
  setOrg(org: Body<'setOrg'>['org']): void;
  setTheme(theme: 'light' | 'dark'): void;
  saved(body: Body<'saved'>): void;
  revealLine(line: number): void;
  /** Ask the editor to persist its current draft (optionally as a new file). */
  flushSave(body?: Body<'flushSave'>): void;
  proposeEdit(body: Body<'proposeEdit'>): void;
  clearProposal(proposalId: string): void;
  setComments(comments: Body<'setComments'>['comments']): void;
  setHits(lines: number[]): void;
  setLayout(compact: boolean): void;
  /** Escape hatch for messages without a dedicated sender. */
  raw(message: HostToPlayground): void;
}

/** Playground -> host callbacks. All optional; the latest closures are always used. */
export interface PlaygroundHandlers {
  onSnapshot?(message: Incoming<'snapshot'>): void;
  onOpenAction?(id: string): void;
  onReady?(): void;
  onDirty?(message: Incoming<'dirty'>): void;
  onRequestOpen?(path: string): void;
  onPersist?(message: Incoming<'persist'>): void;
  onCursor?(message: Incoming<'cursor'>): void;
  onProposalResolved?(message: Incoming<'proposalResolved'>): void;
  onCommentAction?(message: Incoming<'commentAction'>): void;
  onAskSelection?(message: Incoming<'askSelection'>): void;
  onSaveRequest?(): void;
}

export interface UsePlaygroundBridgeResult {
  frameRef: RefObject<HTMLIFrameElement | null>;
  send: PlaygroundSend;
  /** Assign during render: `handlers.current = { onReady, ... }`. The listener always reads the latest value. */
  handlers: MutableRefObject<PlaygroundHandlers>;
}

/**
 * Owns the playground iframe wiring (frame ref, typed `send.*`, `handlers` ref): the frame ref, typed senders, the validated
 * window message listener (origin + source + draft-key filtered) and the theme observer.
 * `activeDraft` holds the draft key of the open file; messages tagged with another key are dropped.
 */
export function usePlaygroundBridge(activeDraft: MutableRefObject<string>): UsePlaygroundBridgeResult {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const handlers = useRef<PlaygroundHandlers>({});

  const post = useCallback((message: HostToPlayground) => postToPlayground(frameRef.current, message), []);
  const send = useMemo<PlaygroundSend>(() => {
    const make = <T extends HostToPlayground['type']>(type: T, body?: object) =>
      post({ source: PLAYGROUND_BRIDGE_SOURCE, type, ...body } as HostToPlayground);
    return {
      init: body => make('init', body),
      setFile: body => make('setFile', body),
      setOrg: org => make('setOrg', { org }),
      setTheme: theme => make('setTheme', { theme }),
      saved: body => make('saved', body),
      revealLine: line => make('revealLine', { line }),
      flushSave: body => make('flushSave', body),
      proposeEdit: body => make('proposeEdit', body),
      clearProposal: proposalId => make('clearProposal', { proposalId }),
      setComments: comments => make('setComments', { comments }),
      setHits: lines => make('setHits', { lines }),
      setLayout: compact => make('setLayout', { compact }),
      raw: post
    };
  }, [post]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== frameRef.current?.contentWindow) return;
      if (!isPlaygroundToHost(event.data)) return;
      const message = event.data;
      if ('draftKey' in message && message.draftKey && message.draftKey !== activeDraft.current) return;
      const on = handlers.current;
      switch (message.type) {
        case 'snapshot': on.onSnapshot?.(message); return;
        case 'openAction': on.onOpenAction?.(message.id); return;
        case 'ready': on.onReady?.(); return;
        case 'dirty': on.onDirty?.(message); return;
        case 'requestOpen': on.onRequestOpen?.(message.path); return;
        case 'persist': on.onPersist?.(message); return;
        case 'cursor': on.onCursor?.(message); return;
        case 'proposalResolved': on.onProposalResolved?.(message); return;
        case 'commentAction': on.onCommentAction?.(message); return;
        case 'askSelection': on.onAskSelection?.(message); return;
        case 'saveRequest': on.onSaveRequest?.(); return;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [activeDraft]);

  // The iframe posts saveRequest for focused-editor shortcuts; the host covers the rest of the window.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 's') return;
      if (!handlers.current.onSaveRequest) return;
      event.preventDefault();
      handlers.current.onSaveRequest();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => send.setTheme(readDocumentTheme()));
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [send]);

  return { frameRef, send, handlers };
}
