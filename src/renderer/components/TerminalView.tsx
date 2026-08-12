import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import type { TerminalSession } from '@shared/types';
import { useFileDrop } from '../util/useFileDrop';
import { posixQuote } from '../util/quote';
import { registerFinder, registerTerminal } from '../util/findRegistry';
import { scrapeUrls } from '../util/urlScrape';
import { shouldSuppressWheelArrows } from '../util/terminalWheel';
import { perfCount, perfTime } from '../util/perfMark';
import { resolveTerminalTheme } from '../util/terminalThemes';
import { useData, useUi } from '../store';

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

  useLayoutEffect(() => {
    if (!ref.current) return;
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
    // Links open in the system browser via shell.openExternal (window.open).
    term.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, '_blank', 'noopener')));
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
        void window.cc.terminals.resize(session.id, term.cols, term.rows).catch(() => {});
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
          void window.cc.terminals.resize(session.id, term.cols, term.rows).catch(() => {});
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
    void window.cc.terminals
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

    const offData = window.cc.terminals.onData((id, data) => {
      if (id !== session.id) return;
      // Before the backlog replay lands, hold live chunks so they can't be
      // written ahead of the older tail (see the replay block above).
      if (!replayDone && pendingData) {
        pendingData.push(data);
        return;
      }
      writeFollowing(data);
    });
    const offExit = window.cc.terminals.onExit((id, code) => {
      if (id !== session.id) return;
      // 0 / undefined → dim "[session exited]"; non-zero → red "[exited code N]".
      const bad = typeof code === 'number' && code !== 0;
      const sgr = bad ? '\x1b[31m' : '\x1b[2m';
      const label = bad ? `[exited code ${code}]` : '[session exited]';
      term.write(`\r\n${sgr}${label}\x1b[0m\r\n`);
    });
    offsRef.current = [offData, offExit, () => offScroll.dispose()];

    const onInput = term.onData((data) => {
      void window.cc.terminals.write(session.id, data).catch(() => {});
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
        void window.cc.terminals.write(session.id, '\x0A').catch(() => {});
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
    const ro = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      const w = box ? Math.round(box.width) : ref.current?.clientWidth ?? 0;
      const h = box ? Math.round(box.height) : ref.current?.clientHeight ?? 0;
      // Hidden / not-yet-laid-out, or unchanged from the last fit — nothing to do.
      if (w === 0 || h === 0) return;
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      if (roRaf) return; // a fit is already scheduled for this frame
      roRaf = requestAnimationFrame(() => {
        roRaf = 0;
        if (disposedRef.current) return;
        try {
          perfCount('terminal-fit'); // TEMP diagnostic — remove after verifying
          perfTime('terminal-fit', () => fit.fit());
          void window.cc.terminals.resize(session.id, term.cols, term.rows).catch(() => {});
        } catch {
          /* ignore */
        }
      });
    });
    ro.observe(ref.current);

    return () => {
      disposedRef.current = true;
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
        void window.cc.terminals.resize(session.id, term.cols, term.rows).catch(() => {});
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
    if (visible && fitRef.current) {
      requestAnimationFrame(() => {
        try {
          if (disposedRef.current) return;
          fitRef.current?.fit();
          if (termRef.current) {
            void window.cc.terminals
              .resize(session.id, termRef.current.cols, termRef.current.rows)
              .catch(() => {});
            // Output that arrived while hidden couldn't auto-scroll (zero-height
            // viewport). If we were tailing, snap to bottom now that the tab is
            // measurable again so the latest output is visible.
            if (stickToBottomRef.current) termRef.current.scrollToBottom();
          }
          // Only focus the primary area ('a') on transition; secondary panes
          // get focus only from explicit click.
          if (area === 'a') termRef.current?.focus();
        } catch {
          /* ignore */
        }
      });
    }
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
        fitRef.current?.fit();
        const cols = term.cols;
        const rows = term.rows;

        // Re-sync xterm's NATIVE scrollbar to the rendered viewport. The
        // appendChild reparent silently resets the browser's `.xterm-viewport`
        // scrollTop to 0, but xterm's Viewport caches the pre-reparent geometry
        // (`_lastRecordedViewportHeight` / `_lastScrollTop` / cell height) — and
        // `syncScrollArea()` early-returns when all three still match, which
        // they do after a bare DOM move. fit() is ALSO a no-op when it lands on
        // the same grid, so no onResize fires to bust that cache. Result: the
        // scrollbar THUMB sits at the top while the canvas shows the bottom
        // (the reported desync). Force it: a rows-only resize on the xterm
        // OBJECT down one row then back changes the canvas height, so the guard
        // fails and Viewport re-runs `_innerRefresh`, which writes
        // scrollTop = ydisp*rowHeight — re-pinning the thumb to the real
        // position WITHOUT changing scroll position. Rows-only never triggers a
        // buffer reflow (that's gated on a COLUMN change), so it's cheap and
        // loses no scrollback. `resize()` early-returns on unchanged dims, hence
        // the down-then-up round-trip: each leg is a genuine change that fires.
        term.resize(cols, Math.max(1, rows - 1));
        term.resize(cols, rows);

        // claude is a full-screen TUI that repaints IN PLACE on the normal
        // buffer (verified: no alt-screen `\x1b[?1049h`; it uses ESC7/ESC8
        // save-restore + cursor-relative moves and assumes it knows the current
        // grid). It only redraws when it receives new output OR a real SIGWINCH.
        // node-pty suppresses SIGWINCH when the new dims equal the dims it
        // already holds — exactly the case if fit() lands on the same grid the
        // agent was spawned at. So we NUDGE the PTY too: resize to one row
        // short, then back on the next frame. The round-trip guarantees a
        // genuine dimension change (two SIGWINCHs), prompting claude to redraw
        // its whole frame so an idle agent isn't left showing a stale grid after
        // the reparent. Harmless for a shell — it just re-wraps once.
        void window.cc.terminals.resize(session.id, cols, Math.max(1, rows - 1)).catch(() => {});
        requestAnimationFrame(() => {
          if (disposedRef.current) return;
          void window.cc.terminals.resize(session.id, cols, rows).catch(() => {});
          // Repaint xterm's own viewport too: the reparent can leave the
          // renderer's texture stale, so refresh the visible rows and tail-snap.
          try {
            term.refresh(0, term.rows - 1);
            if (stickToBottomRef.current) term.scrollToBottom();
          } catch {
            /* ignore */
          }
        });
      } catch {
        /* ignore */
      }
    };
    raf = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(raf);
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
      void window.cc.terminals.write(session.id, paths).catch(() => {});
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
            const r = await window.cc.fs.uploadToRemote(session.projectId, local, destDir);
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
