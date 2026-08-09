# XTerm.js Wheel Event Handler Analysis

## SECTION 1: `attachCustomWheelEventHandler` Implementation

**Location:** Line 195 (after splitting on semicolons)

```javascript
attachCustomKeyEventHandler(e) {
    this._customKeyEventHandler = e
}
attachCustomWheelEventHandler(e) {
    this._customWheelEventHandler = e
}
```

**Key Finding:** The method simply stores the handler in `this._customWheelEventHandler`. No wrapper or transformation.

---

## SECTION 2: Mouse Event Handler with Wheel Event Logic

**Location:** Lines ~180-195 (function `i` inside `bindMouse`)

```javascript
function i(t) {
    const i = e._mouseService.getMouseReportCoords(t, e.screenElement)
    if (!i) return !1
    let s, r
    switch (t.overrideType || t.type) {
        case "mousemove":
            r = 32
            void 0 === t.buttons ? (s = 3, void 0 !== t.button && (s = t.button < 3 ? t.button : 3)) : s = 1 & t.buttons ? 0 : 4 & t.buttons ? 1 : 2 & t.buttons ? 2 : 3
            break
        case "mouseup":
            r = 0
            s = t.button < 3 ? t.button : 3
            break
        case "mousedown":
            r = 1
            s = t.button < 3 ? t.button : 3
            break
        case "wheel":
            if (e._customWheelEventHandler && !1 === e._customWheelEventHandler(t)) 
                return !1  // *** SHORT-CIRCUIT ON FALSE ***
            if (0 === e.viewport.getLinesScrolled(t)) 
                return !1
            r = t.deltaY < 0 ? 0 : 1
            s = 4
            break
        default:
            return !1
    }
    return !(void 0 === r || void 0 === s || s > 4) && e.coreMouseService.triggerMouseEvent({
        col: i.col,
        row: i.row,
        x: i.x,
        y: i.y,
        button: s,
        action: r,
        ctrl: t.ctrlKey,
        alt: t.altKey,
        shift: t.shiftKey
    })
}
```

**Key Finding:** When `_customWheelEventHandler(t)` returns `false`, the function immediately returns `false` and does NOT call `triggerMouseEvent`. This prevents the mouse protocol wheel event from being sent.

---

## SECTION 3: Built-in Wheel Event Handler (Non-Mouse-Tracking Path)

**Location:** Lines ~185-195

```javascript
this.register((0, r.addDisposableDomListener)(t, "wheel", (e => {
    if (!s.wheel) {
        // Check custom handler first
        if (this._customWheelEventHandler && !1 === this._customWheelEventHandler(e)) 
            return !1

        // If buffer has no scrollback (alternate buffer)
        if (!this.buffer.hasScrollback) {
            const t = this.viewport.getLinesScrolled(e)
            if (0 === t) return

            // Generate arrow key sequences
            const i = D.C0.ESC + (this.coreService.decPrivateModes.applicationCursorKeys ? "O" : "[") + (e.deltaY < 0 ? "A" : "B")
            let s = ""
            for (let e = 0; e < Math.abs(t); e++)
                s += i

            // Send arrow keys to terminal
            return this.coreService.triggerDataEvent(s, !0), this.cancel(e, !0)
        }

        // Normal buffer: scroll viewport
        return this.viewport.handleWheel(e) ? this.cancel(e) : void 0
    }
}), {passive: !1}))
```

**Key Findings:**

1. **Custom handler is checked FIRST** before any built-in logic
2. **`hasScrollback` check determines behavior:**
   - `false` (alternate buffer) → Generate and send arrow key sequences (`\x1b[A` or `\x1b[B` in normal mode, `\x1bOA` or `\x1bOB` in application cursor mode)
   - `true` (normal buffer) → Call `viewport.handleWheel(e)` to scroll the viewport

3. **The `s.wheel` check** at the start indicates this is the NON-mouse-tracking path. When mouse tracking is active, a different handler (`n.wheel`) is bound instead.

---

## SECTION 4: Mouse Protocol Binding Logic

**Location:** Lines ~185-190

```javascript
this.register(this.coreMouseService.onProtocolChange((e => {
    // ... other protocol flags ...
    16 & e ? 
        s.wheel || (t.addEventListener("wheel", n.wheel, {passive: !1}), s.wheel = n.wheel) : 
        (t.removeEventListener("wheel", s.wheel), s.wheel = null)
    // ... other protocol flags ...
})))
```

**Key Finding:** When mouse tracking protocol flag `16` (wheel events) is set:
- The `n.wheel` handler is bound (which calls function `i` above that triggers mouse events)
- This REPLACES the built-in wheel handler
- When cleared, the built-in handler is restored

---

## Summary of Control Flow

### When Mouse Tracking is ACTIVE (flag 16 set):

1. Wheel event → `n.wheel` → function `i`
2. Check `_customWheelEventHandler` → if `false`, **short-circuit** (no mouse event sent)
3. Otherwise → `coreMouseService.triggerMouseEvent()` sends mouse protocol event

### When Mouse Tracking is INACTIVE:

1. Wheel event → built-in handler
2. Check `_customWheelEventHandler` → if `false`, **short-circuit** (no further processing)
3. Check `buffer.hasScrollback`:
   - **Alternate buffer** (`false`): Generate arrow keys (`\x1b[A` / `\x1b[B` or `\x1bOA` / `\x1bOB`)
   - **Normal buffer** (`true`): Call `viewport.handleWheel()` to scroll

### Critical Finding:

**Returning `false` from the custom wheel handler short-circuits BOTH paths:**
- Mouse tracking path: prevents `triggerMouseEvent`
- Built-in path: prevents arrow key generation AND viewport scrolling

This is exactly what we want to leverage for our workaround.

