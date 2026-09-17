import { product } from '../lib/product-client.js';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';
import { useFileDrop } from '../hooks/useFileDrop.js';
import { posixQuote } from '../lib/quote.js';
import { registerFinder, registerTerminal } from '../lib/findRegistry.js';
import { scrapeUrls } from '../lib/urlScrape.js';
import { shouldSuppressWheelArrows } from '../lib/terminalWheel.js';
import { createResizeSettleScheduler, resyncXtermAndPty } from '../lib/terminalResync.js';
import { perfCount, perfTime } from '../lib/perfMark.js';
import { resolveTerminalTheme } from '../lib/terminalThemes.js';
import { openXtermHttpLink } from '../lib/xterm-http-link.js';
import { useData, useUi } from '../store.js';

type Area = 'a' | 'b' | 'c' | 'd';

// Attach WebGL to a freshly-opened terminal when the platform supports it.
// xterm 6 has no compatible canvas renderer addon, so its DOM renderer is the
// fallback for headless, blocklisted, or lost GPU contexts.
function attachRenderer(term: Terminal): () => void {
  let webgl: WebglAddon | null = null;

  try {
    webgl = new WebglAddon();
    // A lost GPU context cannot host a renderer; xterm falls back to DOM.
    webgl.onContextLoss(() => {
      try {
        webgl?.dispose();
      } catch {
        /* already gone */
      }
      webgl = null;
    });
    term.loadAddon(webgl);
  } catch {
    webgl = null;
  }

  return () => {
    try {
      webgl?.dispose();
    } catch {
      /* ignore */
    }
  };
}

interface Props {
  session: TerminalSession;
  /** Grid area assigned by TerminalSurface; `undefined` = hidden. */
  area: Area | undefined;
}

// Memoized: TerminalSurface subscribes to nav/modal/monitor/split state and
// re-renders (recreating this element for EVERY live session) whenever any of
// those change — e.g. every time the "New agent" modal opens/closes. Props are
// just `session` + `area`, so memo lets React skip reconciling the terminals
// whose placement didn't actually change, instead of re-running N instances on
// the exact frame we want to stay cheap. `session` objects are stable by id
// from the store, so default shallow-equal is correct here.
function TerminalViewImpl({ session, area }: Props) {
  const visible = area !== undefined;
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const offsRef = useRef<Array<() => void>>([]);
  const fontSize = useData((s) => s.fontSize);
  const wheelArrowsEnabled = useData((s) => s.terminalWheelArrowsEnabled);
  const theme = useData((s) => s.theme);
  const terminalTheme = useData((s) => s.terminalTheme);
  const disposedRef = useRef(false);
  // Read by the custom wheel handler (registered once at construction) so a
  // Settings flip takes effect on this already-open terminal without reopening.
  const wheelArrowsEnabledRef = useRef(wheelArrowsEnabled);
  // Tracks whether the viewport is pinned to the bottom (tailing live output).
  // Computed from buffer indices, not the DOM, so it stays correct even when
  // the tab is hidden (display:none) and xterm's own measurement is zeroed.
  const stickToBottomRef = useRef(true);
  // xterm fires onScroll during programmatic fit/resize (column reflow moves
  // viewportY). That is not user intent — if we let it clear the tail lock,
  // settle resync skips scrollToBottom and the user is left scrolling through
  // wrapped TUI junk. Ignore onScroll only while WE are fitting.
  const ignoreProgrammaticScrollRef = useRef(false);
  const settleRef = useRef<ReturnType<typeof createResizeSettleScheduler> | null>(null);
  const runResyncRef = useRef<(opts?: { pinViewport?: boolean }) => (() => void) | void>(
    () => {}
  );
  runResyncRef.current = (opts) => {
    const term = termRef.current;
    if (!term || disposedRef.current) return;
    const pin = opts?.pinViewport === true || stickToBottomRef.current;
    ignoreProgrammaticScrollRef.current = true;
    try {
      const cancelResync = resyncXtermAndPty({
        term,
        fit: fitRef.current,
        resizePty: (cols, rows) => {
          void product.terminals.resize(session.id, cols, rows).catch(() => {});
        },
        stickToBottom: pin,
        isDisposed: () => disposedRef.current
      });
      // Keep ignoring onScroll until after the helper's deferred refresh +
      // scrollToBottom, otherwise that pin would look like a user scroll-away.
      const clearId = requestAnimationFrame(() => {
        ignoreProgrammaticScrollRef.current = false;
      });
      return () => {
        cancelResync();
        cancelAnimationFrame(clearId);
        ignoreProgrammaticScrollRef.current = false;
      };
    } catch {
      ignoreProgrammaticScrollRef.current = false;
    }
  };

  useLayoutEffect(() => {
    if (!ref.current) return;
    const activateHttpLink = (event: MouseEvent, uri: string) =>
      openXtermHttpLink(event, uri, session.id);
    const term = new Terminal({
      cursorBlink: true,
      // Prefer Nerd Font / Powerline-capable families first so prompts
       // like agnoster / powerlevel10k render their private-use-area
       // glyphs instead of falling back to box-drawing tofu.
      fontFamily:
        '"MesloLGS NF", "JetBrainsMono Nerd Font", "FiraCode Nerd Font", "Hack Nerd Font", "Source Code Pro for Powerline", "Menlo for Powerline", JetBrains Mono, SF Mono, Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: useData.getState().fontSize,
      theme: resolveTerminalTheme(
        useData.getState().terminalTheme,
        useData.getState().theme
      ),
      allowProposedApi: true,
      // OSC 8 (gh, etc.): without this, xterm confirm()s then window.open()
      // with no URL and Electron denies about:blank — OK does nothing.
      linkHandler: { activate: activateHttpLink },
      // Keep a deep scrollback: a long-running agent easily emits more than a
      // few thousand lines, and the old 5k cap silently dropped the oldest — so
      // peeking the agent in the modal (or scrolling back in the tab) lost early
      // output for good. 50k lines is still cheap in memory but covers a full
      // session. xterm reflow on resize trims at this cap, so a higher cap also
      // shrinks the window where re-parenting into the modal could drop lines.
      scrollback: 50000
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon(activateHttpLink));
    term.loadAddon(search);
    term.open(ref.current);
    // Upgrade off the DOM renderer to WebGL now that the terminal has a DOM
    // element to attach the rendering surface to. MUST come after open().
    const disposeRenderer = attachRenderer(term);

    termRef.current = term;
    fitRef.current = fit;
    disposedRef.current = false;

    const offFinder = registerFinder(session.id, {
      findNext: (q, { caseSensitive }) => search.findNext(q, { caseSensitive }),
      findPrev: (q, { caseSensitive }) => search.findPrevious(q, { caseSensitive }),
      clear: () => search.clearDecorations()
    });
    const offHandle = registerTerminal(session.id, {
      clear: () => term.clear(),
      getUrls: () => scrapeUrls(term)
    });

    // Initial fit + resize. Do NOT fit on a single bare rAF: a TerminalView that
    // mounts straight into the agent-inspector modal anchor can have its host
    // element still detached / zero-size on the next frame (TerminalSurface's
    // appendChild reparent is a sibling layout effect that may not have run yet).
    // fit() against a zero-size container caches a degenerate grid and bad cell
    // geometry, so rows paint on TOP of each other — the "overlapping text until
    // I click the sidepanel" symptom (the click resizes the stage → ResizeObserver
    // → a clean re-fit). So retry across frames until the element is genuinely
    // sized (bounded by a short deadline), mirroring the modal-reparent effect.
    //
    // Only spin while the terminal is MEANT to be on screen. A session that
    // mounts hidden (any non-active tab — the common case at boot when many
    // sessions restore at once) is display:none → 0×0 for as long as it stays
    // hidden, and the old blind 2s retry burned a rAF every frame for each such
    // terminal right when the app is busiest restoring. A hidden terminal never
    // needs an initial fit: the `visible`/`area` effect below fits it the moment
    // it's shown. So bail immediately when it's not visible, and only retry when
    // it's visible-but-not-yet-laid-out (a real slot mid-layout, or the modal
    // anchor reparent still pending). Read `visible` off the ref so this closure
    // isn't stale across renders (the layout effect only runs on mount).
    let initialFitRaf = 0;
    const initialDeadline = Date.now() + 2000;
    const initialFit = () => {
      if (disposedRef.current) return;
      const el = ref.current;
      const sized = !!el && el.clientHeight > 0 && el.clientWidth > 0;
      if (!sized) {
        // Not laid out. Keep retrying only if this terminal is currently shown
        // (offsetParent is null for a display:none element); otherwise stop —
        // the visible-transition effect will do the first fit when it appears.
        const onScreen = !!el && el.offsetParent !== null;
        if (onScreen && Date.now() < initialDeadline) {
          initialFitRaf = requestAnimationFrame(initialFit);
        }
        return;
      }
      try {
        fit.fit();
        void product.terminals.resize(session.id, term.cols, term.rows).catch(() => {});
      } catch {
        /* ignore */
      }
    };
    initialFitRaf = requestAnimationFrame(initialFit);

    // Refit once web fonts settle. The terminal prefers a Nerd Font family that
    // may still be loading when xterm first measures the character cell; a measure
    // against the fallback font caches a cell width/height that no longer matches
    // the glyphs once the real font paints, again leaving text overlapping until a
    // later resize. document.fonts.ready resolves after all @font-face loads are
    // done, so a fit() here re-measures against the final metrics.
    void document.fonts?.ready
      ?.then(() => {
        if (disposedRef.current) return;
        try {
          fit.fit();
          void product.terminals.resize(session.id, term.cols, term.rows).catch(() => {});
          if (stickToBottomRef.current) term.scrollToBottom();
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});

    // Track the user's scroll intent: any wheel/scroll that lands above the
    // last line breaks the "tail" lock; scrolling back to the bottom re-arms
    // it. We read buffer indices rather than DOM offsets so this is correct
    // even while the tab is hidden.
    const atBottom = () => {
      const buf = term.buffer.active;
      return buf.viewportY >= buf.baseY;
    };
    const offScroll = term.onScroll(() => {
      if (ignoreProgrammaticScrollRef.current) return;
      stickToBottomRef.current = atBottom();
    });

    // Break the tail lock synchronously on a scroll-up gesture. term.onScroll
    // fires only *after* the viewport has moved, so during live output an
    // onData chunk (or a font-load/modal-reparent refit) can land between the
    // wheel event and onScroll and re-pin to bottom using the stale `follow`
    // flag — cancelling the scroll mid-gesture. Reading the wheel directly
    // disarms tailing before the next write callback reads the ref. Guard on
    // baseY > 0: with no scrollback above, scrolling up is a no-op and must not
    // strand the flag (onScroll would never re-arm it).
    const wheelEl = ref.current;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0 && term.buffer.active.baseY > 0) {
        stickToBottomRef.current = false;
      }
    };
    wheelEl.addEventListener('wheel', onWheel, { passive: true });

    // Replay any output the pty emitted BEFORE this view subscribed. A terminal
    // launched straight into the inspector modal / List-view monitor mounts
    // only after `create` resolved and the agent already printed its banner —
    // those bytes were broadcast to no listener, so without a replay the xterm
    // shows just a cursor on an empty buffer. We fetch main's retained tail and
    // write it before any live output.
    //
    // Ordering matters: `onData` is registered synchronously below, but the
    // backlog fetch is an async IPC round-trip, so a live chunk can arrive
    // BEFORE the replay resolves. Writing it straight to the terminal would put
    // newer output above the older replayed tail. So until the replay is
    // written we QUEUE live chunks in `pendingData` and flush them right after,
    // preserving order. Any overlap between the backlog snapshot and the first
    // live chunk is at worst a few duplicated bytes at the seam — far less
    // jarring than a blank terminal or scrambled output.
    let replayDone = false;
    let pendingData: string[] | null = [];
    const writeFollowing = (data: string) => {
      // Decide BEFORE writing whether we were tailing; new rows push baseY
      // down, and xterm's built-in auto-scroll can miss the last row when the
      // viewport height is stale (hidden tab, mid-resize), leaving the wheel
      // unable to reach bottom until an arrow key forces a sync. Re-pinning in
      // the write callback (after the buffer settles) closes that gap.
      //
      // Read the LIVE buffer position, not the cached `stickToBottomRef`: xterm's
      // `onScroll` (which maintains the ref) doesn't fire on a mouse-wheel scroll
      // in all versions, so the ref can be stale-true while the user has scrolled
      // up — making every chunk a working agent emits yank the view back to the
      // bottom. `atBottom()` reads viewportY/baseY directly, so it's correct
      // regardless of whether onScroll fired.
      const follow = atBottom();
      term.write(data, () => {
        // Don't yank the viewport to bottom while the user has an active
        // selection — auto-scrolling mid-selection loses their highlight and
        // makes copy-from-terminal impossible.
        if (follow && !disposedRef.current && !term.hasSelection()) term.scrollToBottom();
      });
    };
    void product.terminals
      .backlog(session.id)
      .then((tail) => {
        if (disposedRef.current) return;
        if (tail) term.write(tail);
        const queued = pendingData ?? [];
        pendingData = null;
        replayDone = true;
        for (const chunk of queued) term.write(chunk);
        if (!disposedRef.current) term.scrollToBottom();
      })
      .catch(() => {
        // Replay failed — don't strand queued live output; flush it as-is.
        if (disposedRef.current) return;
        const queued = pendingData ?? [];
        pendingData = null;
        replayDone = true;
        for (const chunk of queued) term.write(chunk);
      });

    const offData = product.terminals.onData((id, data) => {
      if (id !== session.id) return;
      // Before the backlog replay lands, hold live chunks so they can't be
      // written ahead of the older tail (see the replay block above).
      if (!replayDone && pendingData) {
        pendingData.push(data);
        return;
      }
      writeFollowing(data);
    });
    const offExit = product.terminals.onExit((id, code) => {
      if (id !== session.id) return;
      // 0 / undefined → dim "[session exited]"; non-zero → red "[exited code N]".
      const bad = typeof code === 'number' && code !== 0;
      const sgr = bad ? '\x1b[31m' : '\x1b[2m';
      const label = bad ? `[exited code ${code}]` : '[session exited]';
      term.write(`\r\n${sgr}${label}\x1b[0m\r\n`);
    });
    offsRef.current = [offData, offExit, () => offScroll.dispose()];

    const onInput = term.onData((data) => {
      void product.terminals.write(session.id, data).catch(() => {});
    });

    // Shift+Enter → insert a newline in Claude Code's prompt instead of
    // submitting. xterm sends a bare CR (\r, 0x0D) for BOTH Enter and
    // Shift+Enter, so the CLI can't tell them apart and Shift+Enter submits.
    // We intercept it and send LF (\x0A) — the same byte Ctrl+J produces, which
    // Claude Code's input handler treats as "insert newline" with no
    // terminal-setup needed. Scoped to claude profiles so a plain shell still
    // gets its native Enter behavior.
    //
    // We MUST preventDefault() ourselves: xterm's `_keyDown` early-returns the
    // moment a custom handler returns false, *before* it would call its own
    // `cancel()` (which is what normally calls preventDefault). Without it, the
    // browser still fires the follow-up `keypress`, and xterm's `_keyPress`
    // sends CR (0x0D) — so Shift+Enter would emit BOTH our LF and a CR, and the
    // CR submits the prompt. Cancelling the event here stops that keypress so
    // only our LF reaches the PTY.
    // Every non-shell profile is an interactive agent TUI (claude / cursor /
    // codex) that wants Shift+Enter → newline; a plain shell keeps native Enter.
    const isAgentTui = session.profile !== 'shell';
    term.attachCustomKeyEventHandler((e) => {
      // Cmd+C on macOS: when there's a selection, copy it to the system
      // clipboard and let the browser's native copy path proceed. xterm's default
      // handler would otherwise swallow the key and neither our copy nor the
      // application's runs — the "can't copy from the terminal" symptom.
      if (e.type === 'keydown' && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        if (e.key === 'c' || e.key === 'C') {
          const sel = term.getSelection();
          if (sel) {
            void navigator.clipboard?.writeText(sel).catch(() => {});
            return false;
          }
        }
      }
      if (
        isAgentTui &&
        e.type === 'keydown' &&
        e.key === 'Enter' &&
        e.shiftKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        e.stopPropagation();
        void product.terminals.write(session.id, '\x0A').catch(() => {});
        return false;
      }
      return true;
    });

    // xterm's built-in wheel handler turns a wheel notch into Up/Down arrow
    // keypresses on the *alternate* screen buffer (with mouse tracking off).
    // Pagers (less/man/git) rely on that to scroll, but a shell/prompt on the
    // alt buffer reads the arrows as command-history navigation — the reported
    // "wheel cycles my history" bug. When the user opts out we cancel just that
    // path (return false), leaving normal-buffer scrollback and mouse-tracking
    // (tmux `mouse on`) untouched. Registered once; reads the live setting via a
    // ref so a Settings flip applies without reopening the terminal.
    term.attachCustomWheelEventHandler(() => {
      const suppress = shouldSuppressWheelArrows({
        wheelArrowsEnabled: wheelArrowsEnabledRef.current,
        bufferType: term.buffer.active.type,
        mouseTrackingActive: term.modes.mouseTrackingMode !== 'none'
      });
      // Returning false cancels xterm's default wheel handling for this notch.
      // Note: xterm early-returns before its own cancel(e), so preventDefault is
      // NOT called on suppress — harmless here (the alt buffer has no scrollback
      // to scroll and the pane has no scrollable ancestor; "wheel does nothing"
      // is the intended opted-out behavior).
      return !suppress;
    });

    // Refit on container resize. Every live session across every project keeps a
    // TerminalView mounted at once (see TerminalSurface) so scrollback survives
    // nav changes — so a layout change that touches the terminal region (opening
    // a launcher/inspector modal, a split, a nav) fires N observers in one frame.
    // The OLD code called fit() SYNCHRONOUSLY in each callback; each fit forces a
    // reflow + xterm renderer reconfigure, so N back-to-back stalled the whole
    // renderer thread ("the app freezes when the modal opens").
    //
    // The load-bearing fix is the two early-returns below, NOT cross-instance
    // batching: each TerminalView owns its OWN observer + rAF, so the rAF only
    // dedupes repeated fires of THIS terminal within a frame (a drag-resize) — it
    // does NOT batch across terminals. What kills the modal-open freeze is that
    // almost every mounted terminal is hidden (display:none → a 0×0 box): those
    // now bail WITHOUT fitting, and only the ≤N genuinely-visible panes (bounded
    // by the split layout, at most 4) ever fit. A re-observation at an unchanged
    // size is likewise a no-op. NOTE the residual risk: if a future layout keeps
    // many terminals visible AND resizes them together (e.g. a window resize in a
    // multi-pane grid), you again get several synchronous fits in one frame — if
    // that ever bites, switch to a single module-level rAF + queue for true
    // cross-instance batching.
    let roRaf = 0;
    let lastW = -1;
    let lastH = -1;
    // Live drag: cheap fit + PTY resize every frame. After the size stops
    // changing, settle fires the modal-style SIGWINCH nudge + refresh so a
    // Claude TUI redraws instead of stacking frames on a stale grid.
    const settle = createResizeSettleScheduler(() => {
      if (disposedRef.current) return;
      const el = ref.current;
      if (!el || el.clientHeight <= 0 || el.clientWidth <= 0) return;
      if (el.offsetParent === null) return;
      // Reflow during the drag already moved the viewport off the TUI frame
      // and may have cleared the tail lock via onScroll. Always pin: a layout
      // resize is not a user scroll, and the old scroll offset is meaningless
      // once columns have wrapped.
      stickToBottomRef.current = true;
      runResyncRef.current({ pinViewport: true });
    });
    settleRef.current = settle;
    const ro = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      const w = box ? Math.round(box.width) : ref.current?.clientWidth ?? 0;
      const h = box ? Math.round(box.height) : ref.current?.clientHeight ?? 0;
      // Hidden / not-yet-laid-out, or unchanged from the last fit — nothing to do.
      if (w === 0 || h === 0) {
        settle.cancel();
        return;
      }
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      if (roRaf) return; // a fit is already scheduled for this frame
      roRaf = requestAnimationFrame(() => {
        roRaf = 0;
        if (disposedRef.current) return;
        try {
          perfCount('terminal-fit'); // TEMP diagnostic — remove after verifying
          ignoreProgrammaticScrollRef.current = true;
          try {
            perfTime('terminal-fit', () => fit.fit());
            void product.terminals.resize(session.id, term.cols, term.rows).catch(() => {});
            if (stickToBottomRef.current) term.scrollToBottom();
          } finally {
            ignoreProgrammaticScrollRef.current = false;
          }
          settle.ping();
        } catch {
          /* ignore */
        }
      });
    });
    ro.observe(ref.current);

    return () => {
      disposedRef.current = true;
      settle.dispose();
      settleRef.current = null;
      cancelAnimationFrame(initialFitRaf);
      if (roRaf) cancelAnimationFrame(roRaf);
      ro.disconnect();
      wheelEl.removeEventListener('wheel', onWheel);
      onInput.dispose();
      offsRef.current.forEach((off) => off());
      offFinder();
      offHandle();
      // Dispose the WebGL/canvas addon before the terminal so its GPU context /
      // canvas surface is released deterministically (not left to GC).
      disposeRenderer();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [session.id]);

  // Live font size updates
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (term.options.fontSize === fontSize) return;
    term.options.fontSize = fontSize;
    requestAnimationFrame(() => {
      try {
        if (disposedRef.current) return;
        fitRef.current?.fit();
        void product.terminals.resize(session.id, term.cols, term.rows).catch(() => {});
      } catch {
        /* ignore */
      }
    });
  }, [fontSize, session.id]);

  // Keep the wheel handler's live view of the opt-out setting current. The
  // handler is registered once at construction and reads this ref, so flipping
  // the Settings toggle takes effect on this open terminal immediately.
  useEffect(() => {
    wheelArrowsEnabledRef.current = wheelArrowsEnabled;
  }, [wheelArrowsEnabled]);

  // Live theme swap. xterm paints glyphs itself (WebGL/canvas renderer), so
  // changing the terminal palette must repaint it explicitly (the CSS
  // `data-theme` cascade doesn't reach it).
  // Assigning `options.theme` re-tints the whole buffer in place — no refit or
  // scrollback loss. Depends on BOTH `terminalTheme` and `theme` because the
  // 'auto' selection follows the app's light/dark mode.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = resolveTerminalTheme(terminalTheme, theme);
  }, [terminalTheme, theme]);

  // Refit when becoming visible OR when area placement changes (split open/
  // close also resizes the host element under us). The ResizeObserver above
  // will also catch most pane resizes, but firing here removes a one-frame
  // mismatch when the layout class changes without a size change yet.
  useEffect(() => {
    if (!visible) {
      settleRef.current?.cancel();
      return;
    }
    if (!fitRef.current) return;
    let cancelResync: (() => void) | undefined;
    const raf = requestAnimationFrame(() => {
      try {
        if (disposedRef.current) return;
        // Split open/close can change layout without a lasting pixel delta
        // (ResizeObserver then skips). The settled-style nudge still has to
        // run so a Claude TUI redraws and xterm busts a stale cell cache.
        cancelResync = runResyncRef.current() ?? undefined;
        // Only focus the primary area ('a') on transition; secondary panes
        // get focus only from explicit click.
        if (area === 'a') termRef.current?.focus();
      } catch {
        /* ignore */
      }
    });
    return () => {
      cancelAnimationFrame(raf);
      cancelResync?.();
    };
  }, [visible, area, session.id]);

  // When this session becomes the agent-inspector modal's session, TerminalSurface
  // reparents its live xterm node into the modal anchor with appendChild. A DOM
  // move neither resizes the element nor notifies xterm, and if the agent's tab
  // was ALREADY the active tab `area`/`visible` don't change either — so the
  // refit effect above never re-fires. The result: xterm keeps painting a stale
  // (often blank) viewport until some input (e.g. an arrow key) forces a sync,
  // which is exactly the "I have to press arrow keys before I see the history"
  // symptom. Force a fit + full refresh + tail-snap on the reparent so the whole
  // scrollback shows the instant the modal opens.
  //
  // A FRESHLY-launched agent (global board "+" → inspector modal) is the hard
  // case: its TerminalView mounts for the FIRST time straight into the modal
  // anchor, so `term.open()` (a child layout effect) can run BEFORE
  // TerminalSurface's parent layout effect has appendChild'd the portal node
  // into the anchor — xterm then initializes against a detached / zero-size
  // container and a single rAF fit can still land before layout settles,
  // leaving the viewport blank. So instead of one rAF we retry across frames
  // until the element actually has a non-zero size (or a short deadline), then
  // do the fit + full refresh + tail-snap.
  //
  // SYMMETRIC on close too: the reparent BACK (modal anchor → workspace) is the
  // same bare appendChild and leaves the same stale viewport / SIGWINCH-starved
  // TUI. It used to be masked by the ResizeObserver firing at a new size, but now
  // that the observer skips an unchanged-size re-fit (the freeze fix), a modal
  // whose pane happens to be the SAME pixel size as the workspace pane would fire
  // no observer and leave xterm desynced until a keystroke. So we run the same
  // fit + refresh + tail-snap on BOTH edges of `isModalSession` (open AND close),
  // detected via a prev-value ref, independent of the size cache.
  const isModalSession = useUi((s) => s.agentModal?.sessionId === session.id);
  const wasModalSessionRef = useRef(false);
  useEffect(() => {
    const was = wasModalSessionRef.current;
    wasModalSessionRef.current = isModalSession;
    // Run the reparent re-sync when the modal ownership TOGGLES in either
    // direction. A steady `false` (a terminal that never enters the modal) is the
    // common case and must stay a no-op.
    if (isModalSession === was) return;
    let raf = 0;
    let cancelResync: (() => void) | undefined;
    const deadline = Date.now() + 2000;
    const sync = () => {
      const term = termRef.current;
      if (disposedRef.current || !term) return;
      const el = ref.current;
      const sized = !!el && el.clientHeight > 0 && el.clientWidth > 0;
      // Not laid out yet — retry only while the node is actually on screen
      // (offsetParent is null for display:none). On CLOSE the session may land
      // back on a hidden workspace tab; there's nothing to resync there — the
      // visible-transition effect handles it when the tab is next shown — so
      // don't burn a 2s rAF spin on it. On OPEN the modal anchor is always
      // visible, so this keeps retrying until layout settles as before.
      if (!sized) {
        const onScreen = !!el && el.offsetParent !== null;
        if (onScreen && Date.now() < deadline) raf = requestAnimationFrame(sync);
        return;
      }
      try {
        cancelResync = runResyncRef.current() ?? undefined;
      } catch {
        /* ignore */
      }
    };
    raf = requestAnimationFrame(sync);
    return () => {
      cancelAnimationFrame(raf);
      cancelResync?.();
    };
  }, [isModalSession, session.id]);

  // Drop a file (or absolute path) onto the terminal to type its shell-quoted
  // path straight into the pty, then refocus so the user can keep typing. For a
  // REMOTE session the dropped path is local and meaningless to the devbox, so
  // we first upload each file into `<cwd>/.zcc-uploads/` and type the resulting
  // REMOTE paths instead. A failed upload surfaces a toast and is omitted.
  const remote = useData((s) => s.projects.find((p) => p.id === session.projectId)?.remote);
  const pushToast = useUi((s) => s.pushToast);
  const { dropOver, dropHandlers } = useFileDrop(
    (paths) => {
      void product.terminals.write(session.id, paths).catch(() => {});
      termRef.current?.focus();
    },
    remote
      ? async (localPaths) => {
          // The terminal may preserve a configured remote path which is a
          // symlink, whereas main authorizes transfers against `pwd -P`'s
          // canonical project root. Use the root-relative destination; main
          // resolves it after authorizing the remote project.
          const destDir = '.';
          const uploaded: string[] = [];
          for (const local of localPaths) {
            const r = await product.fs.uploadToRemote(session.projectId, local, destDir);
            if (r.ok && r.path) {
              uploaded.push(r.path);
              pushToast(`Uploaded ${local.split('/').pop()} → ${remote.host}`);
            } else {
              pushToast(r.message ?? `Failed to upload ${local.split('/').pop()}`, 'error');
            }
          }
          return uploaded.map(posixQuote).join(' ');
        }
      : undefined
  );

  return (
    <div
      ref={ref}
      className={`term ${dropOver ? 'drop-over' : ''} ${area ? `area-${area}` : ''}`}
      style={{ display: visible ? 'block' : 'none', gridArea: area }}
      {...dropHandlers}
    />
  );
}

export const TerminalView = memo(TerminalViewImpl);
