# Terminal Scroll-Up Bug: Stale-Follow Race in TerminalView

**TL;DR:** User scrolls up in the terminal during active output, but the view snaps back to bottom instantly. Root cause: a race between `stickToBottomRef` updates (async, from xterm's onScroll) and PTY data writes (synchronous, reading the stale ref). Fix: add a synchronous wheel listener that disarms follow on scroll-up (`deltaY < 0`) before any pending write callback reads the ref. One passive event listener, zero latency, no regressions.

---

## Symptom

User report (verbatim):
> "i have an issue with the shell that this app is using while it is running i can't scroll up. each time i scroll it just goes to the buttom"

Reproducible with sustained output (e.g., `seq 1 100000` or `yes`) — any scroll-up gesture immediately snaps the viewport back to the latest line, making it impossible to read prior output during an active session.

---

## Root Cause

**The stale-follow race in `src/renderer/components/TerminalView.tsx`, lines 133–144:**

```typescript
const offData = window.cc.terminals.onData((id, data) => {
  if (id !== session.id) return;
  // Decide BEFORE writing whether we were tailing; new rows push baseY
  // down, and xterm's built-in auto-scroll can miss the last row when the
  // viewport height is stale (hidden tab, mid-resize), leaving the wheel
  // unable to reach bottom until an arrow key forces a sync. Re-pinning in
  // the write callback (after the buffer settles) closes that gap.
  const follow = stickToBottomRef.current;
  term.write(data, () => {
    if (follow && !disposedRef.current) term.scrollToBottom();
  });
});
```

The `onData` handler snapshots `stickToBottomRef.current` **synchronously** at call time (line 140), then calls `term.scrollToBottom()` in the write callback (line 142) if that snapshot was `true`.

The ref is updated **asynchronously** by xterm's `onScroll` event (lines 129–131):

```typescript
const offScroll = term.onScroll(() => {
  stickToBottomRef.current = atBottom();
});
```

**The race:** User scrolls up → browser fires wheel event → xterm updates its internal viewport → xterm fires `onScroll` → our handler sets `stickToBottomRef.current = false`. But between the wheel gesture and the `onScroll` callback, PTY data may arrive → `onData` fires → reads `stickToBottomRef.current` (still `true`) → writes data → callback snaps to bottom. The user sees their scroll gesture immediately undone.

---

## Why It Manifests During Active Output

**Amplifier: 8ms PTY output coalescing in `src/main/pty.ts`, lines 14–23, 230–251.**

```typescript
/**
 * Coalesce window (ms) for PTY output before it crosses IPC. A chatty command
 * (`npm install`, `git log`) makes node-pty fire `onData` dozens of times a
 * second in tiny chunks; forwarding each as its own IPC message floods the
 * main→renderer pipe. We buffer per-session and flush on this timer, so a burst
 * collapses into one message per window while idle output still arrives within
 * ~one frame. Small enough to feel instant, large enough to absorb a burst.
 */
const PTY_DATA_FLUSH_MS = 8;
```

Every 8ms during sustained output, a flushed chunk fires `onData` in the renderer. If the user scrolls between flush ticks, there's a high probability the next flush will fire **before** xterm's `onScroll` callback updates the ref, so the stale `follow = true` persists and the snap occurs. The faster the output, the tighter the window, the more certain the race.

With slower output or no output, the `onScroll` callback completes before the next data chunk arrives, so the ref updates cleanly and no snap occurs — this is why the bug only manifests during active command runs.

---

## What Is NOT the Cause

The following were investigated and ruled out:

- **Main-side PTY handling (`src/main/pty.ts`)**: The PTY layer is a correct dumb pipe. It spawns `node-pty` processes with standard `TERM=xterm-256color` (line 551), no alt-screen injection, no scroll-control codes. The 8ms coalescing is an **amplifier**, not the bug itself.
- **Resize handling (`TerminalView.tsx`, lines 159–166)**: The `ResizeObserver` calls `fit.fit()` and `pty.resize()` in response to DOM size changes. It never touches scroll position or the `stickToBottomRef`.
- **CSS `overflow` or custom `onWheel` hijack**: No CSS prevents scrolling, and no existing wheel handler was found in the component.
- **Alt-screen buffer**: The PTY uses standard screen mode; xterm's scrollback is enabled (50k lines, line 76).

The bug is purely a renderer-side timing race in the `TerminalView` component's scroll-follow logic.

---

## The Fix (Option A: Synchronous Wheel Intercept)

**Add a passive wheel listener** to the terminal container that disarms `stickToBottomRef.current` **synchronously** on scroll-up (`deltaY < 0`), before any queued `onData` write callback reads the ref.

### Code Change

**File:** `src/renderer/components/TerminalView.tsx`

**Location:** In the main `useLayoutEffect` (starting at line 58), after the `onScroll` handler (~line 131) and before the `onData` handler (~line 133):

```typescript
// NEW: Synchronous wheel intercept to disarm follow before any pending write callback reads the ref
const onWheel = (event: WheelEvent) => {
  if (event.deltaY < 0) {
    stickToBottomRef.current = false;
  }
};
ref.current.addEventListener('wheel', onWheel, { passive: true });
```

**Cleanup:** Add removal in the effect cleanup (before `ro.disconnect()`, ~line 171):

```typescript
return () => {
  disposedRef.current = true;
  ro.disconnect();
  onInput.dispose();
  offsRef.current.forEach((off) => off());
  offFinder();
  offHandle();
  ref.current?.removeEventListener('wheel', onWheel); // NEW
  term.dispose();
  termRef.current = null;
  fitRef.current = null;
};
```

**Keep unchanged:**
- The `onScroll` handler (lines 129–131) — it re-arms `stickToBottomRef` when the user scrolls back to the bottom.
- The refit snaps at line 216 (visibility) and line 250 (modal) — these are required for hidden-tab tailing (see "Why No Regression" below).

---

## Why This Fix and Not the Alternatives

| Option | Latency | Risk | Regression | Notes |
|--------|---------|------|------------|-------|
| **A: Synchronous wheel intercept** (RECOMMENDED) | **Zero** | **Low** | **None** | Wheel listener fires before xterm's handler (registration order), runs in the same tick as the gesture. No `preventDefault()` needed (passive). Only disarms when tab is visible + user interacts, so hidden-tab tailing is unaffected. |
| B: Debounced lock on scroll events | 200ms | Medium | User-visible lag | After any scroll, lock `stickToBottomRef` for 200ms. Magic-number tuning, and the delay is perceptible — the terminal won't resume tailing for 200ms even if the user scrolls back to bottom immediately. |
| C: Derive `atBottom()` at write callback time | Zero | High | **Breaks hidden-tab** | Replace `const follow = stickToBottomRef.current` with `const follow = atBottom()` inside the write callback. When a tab is hidden (`display: none`), xterm's `buffer.viewportY` and `buffer.baseY` both become zero (xterm can't measure the viewport), so `atBottom()` always returns `true` — the refit snaps at lines 216/250 become no-ops, and hidden-tab tailing regresses. |
| D: Remove refit snaps (lines 216, 250) | Zero | N/A | **Breaks hidden-tab** | The refit snaps were added deliberately to fix "I switch to a hidden tab and see stale output" — removing them regresses that fix. |
| E: `scrollOnUserInput: false` | Zero | High | **Breaks typing** | Disables xterm's built-in scroll-to-bottom on user input (typing). Users expect the terminal to snap to the prompt when they start typing; this breaks that. |

**Why Option A wins:** Zero latency, no magic numbers, no regressions. The wheel listener only fires when the tab is **visible** and the user **interacts**, so it never disarms the ref during hidden-tab output (where the refit snaps compensate).

---

## Why This Doesn't Regress Hidden-Tab / Modal Tailing

**The problem the refit snaps solve (lines 216, 250):**

When a terminal tab is hidden (`display: none`), xterm can't measure its viewport — `buffer.viewportY` and `buffer.baseY` both become zero. Incoming PTY data during that time writes to the buffer, but xterm's auto-scroll doesn't fire (the viewport is unmeasurable), so `stickToBottomRef` stays `true` but the view doesn't track the output. When the tab becomes visible again, the user sees stale output from when they last looked — the latest lines are off-screen.

**The fix (lines 216, 250):** On refit (tab becomes visible, or modal reparent), if `stickToBottomRef.current` is `true`, explicitly call `term.scrollToBottom()` to snap to the latest output now that the viewport is measurable again.

**Why the wheel listener doesn't break this:**

The `onWheel` listener only fires when:
1. The terminal's DOM element is **attached** and **visible** (hidden elements don't receive wheel events).
2. The user **scrolls** (i.e., interacts with the terminal).

During hidden-tab output, the tab is **not visible**, so the wheel listener never fires → `stickToBottomRef.current` remains `true` → the refit snaps at lines 216/250 still execute when the tab becomes visible → the latest output is shown.

Similarly, when the modal opens (line 250), the reparent happens without any user scroll gesture, so the wheel listener hasn't fired → `stickToBottomRef` is still `true` → the snap executes → the modal shows the latest output.

**Result:** Hidden-tab tailing and modal tailing continue to work exactly as before. The wheel listener only disarms follow during **visible, interactive scrolling** — the precise scenario where the user wants to break the tail lock.

---

## Test Plan

### Manual Scenarios

1. **Sustained output + scroll up** (the reported bug):
   ```bash
   seq 1 100000
   # or
   yes
   ```
   While output is streaming, scroll up with the mouse wheel or trackpad. **Expected:** Viewport stays at the scrolled position, no snap to bottom. The scroll gesture is respected.

2. **Re-arm on scroll to bottom**:
   Continue the test above. Scroll back to the bottom (or press End). **Expected:** `stickToBottomRef` re-arms (via `onScroll`), and the next arriving data snaps to the bottom (tailing resumes).

3. **Hidden tab with output, then switch back**:
   - Start a long-running command in a tab (e.g., `seq 1 100000`).
   - Switch to a different tab (the terminal becomes `display: none`).
   - Wait a few seconds (data accumulates).
   - Switch back to the original tab.
   **Expected:** The viewport snaps to the latest output (refit snap at line 216 fires).

4. **Modal open/close**:
   - Open the agent-inspector modal for a session with active output.
   **Expected:** The modal's terminal shows the latest output (refit snap at line 250 fires).

5. **Keyboard scroll**:
   Run `seq 1 100000`, then press PageUp or use arrow keys to scroll up.
   **Expected:** Viewport stays at the scrolled position. (Keyboard scroll fires xterm's `onScroll`, which sets `stickToBottomRef.current = false` via the existing handler.)

6. **Very fast output** (stress test):
   ```bash
   yes | head -100000
   ```
   Scroll up mid-stream. **Expected:** No snap; the fix holds even under maximum coalescing pressure.

### Verification Commands

```bash
# Sustained output (Linux/macOS):
seq 1 100000

# High-frequency output:
yes | head -100000

# Slow trickle (to test re-arm):
for i in {1..100}; do echo $i; sleep 0.5; done
```

---

## Risks / Open Questions

1. **Passive listener timing:** The fix assumes the passive `wheel` listener registered **before** xterm's internal handler will run **first** (standard event-listener FIFO order). Confirm in testing that our listener sets `stickToBottomRef.current = false` before xterm updates its viewport.

2. **Cross-platform wheel semantics:** Trackpad vs. mouse wheel on Windows/Linux may fire `deltaY` with different signs or units. Test on Windows (mouse wheel) and Linux (both trackpad and mouse) to confirm `deltaY < 0` reliably means scroll-up.

3. **Horizontal scroll:** The current fix only checks `deltaY`. If the terminal is wide enough to scroll horizontally, a horizontal scroll gesture might have `deltaY === 0`. This is fine (horizontal scroll shouldn't disarm follow), but verify the behavior feels natural.

4. **Touch/mobile:** If the app is ever opened on a touchscreen device, swipe-scroll gestures may not fire `wheel` events (they fire `touch*` events instead). If mobile support is in scope, the same logic would need to be added to a `touchstart` or `touchmove` handler.

5. **xterm version upgrade:** The fix relies on xterm's `onScroll` callback firing after viewport updates. Confirm this behavior remains stable across future xterm upgrades (currently using `@xterm/xterm` v5.5.0, per `package.json:27`).

---

## References

- **Terminal component:** `src/renderer/components/TerminalView.tsx`
  - Scroll-follow race: lines 133–144
  - onScroll handler: lines 129–131
  - Refit snaps: lines 216, 250
  - scrollback config: line 76
- **PTY output coalescing:** `src/main/pty.ts`
  - Coalescing constant: lines 14–23 (`PTY_DATA_FLUSH_MS = 8`)
  - Flush logic: lines 240–251
- **xterm.js library:** `@xterm/xterm` v5.5.0 (`package.json:27`)

---

**Status:** Design complete. Implementation is a ~5-line addition to `TerminalView.tsx`. Testing required on macOS (trackpad + mouse), Windows (mouse wheel), and Linux (both).
