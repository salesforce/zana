# Renderer (apps/app) Coupling Notes

## Shared CSS classes for disk extensions

**Invariant:** `gus-*` / `zana-*` CSS classes in `apps/app/src/styles/global.css` cascade into disk extensions.

**Why:** Tickets kanban/modal styles (`gus-modal`, `gus-card-type`, `gus-chatter-*`, `gus-spin`, `gus-facts`; Tickets overrides `zana-modal`, `zana-blocker-chip`, `zana-timeline-spinner`, `zana-ver-*`) are consumed by `gus` and `zana` disk extensions (`extensions/zana/src/renderer/*`). Extensions mount into `.module-panel-slot`, so core `global.css` cascades into them.

**Guard:** No automated guard.

**When changing:**
- Restyle affects both extensions' panels silently — scope changes under `zana-*` modifiers, or split shared base first.
- Do NOT delete as "unused" — source search of `apps/app/src` shows no consumers after Tickets extraction, but extensions depend at runtime.

## Extension-panel placement (.module-panel-slot)

**Invariant:** Host owns extension-panel placement via `.module-panel-slot` wrapper.

**Why:** `ModulePanelHost` (`apps/app/src/modules/ModulePanelHost.tsx`) mounts each extension panel in a `.module-panel-slot` (defined in `apps/app/src/styles/global.css`). Slot spans shell grid's content columns (`grid-column: 2 / -1`), full height, own scroll, stretches child (`flex: 1 1 auto; min-height/min-width: 0`). Exists because `ListPane` returns `null` for module nav — bare panel would auto-place into narrow list track (col 2), leaving col 3 empty.

**Guard:** No automated guard.

**When changing:**
- Built-in panels self-setting `grid-column: 2 / -1` (`.gus-panel`, `.cu-panel`) still work as harmless no-op — do NOT rely on it for new panels; fill the slot.
- Slot contract change means updating teaching artifacts: `packages/plugin-templates/src/files.ts` (panel root `height: '100%'`), generated starter instructions, `extension-creator` / `zcc-plugin-authoring` skills (full-slot root `height:'100%'` / `flex:1` + own `overflow`, `max-width` only on inner reading-width wrapper).

## Sidebar automation toggles config round-trip

**Invariant:** `AutomationToggles` (`apps/app/src/components/Sidebar.tsx`) write `AppConfig` directly.

**Why:** Switches (auto-close-idle + Overseer) call `useData.setAutoCloseIdleEnabled` / `setOverseerMode` — UNLIKE pure-local Settings mirrors (`setCloseIdleEnabled` et al., driven after panel's own `config.set`). Optimistic flip → persist → roll back on failure. Both mirrors hydrate in `useData.init`.

**Guard:** No automated guard.

**When changing:**
- Overseer rail toggle only flips `off`↔`on`; full `off/dryRun/on` range stays in Settings — keep store field tri-state, not boolean.

## Rule 6 renderer guard

**Invariant:** `'zana'` module-id literal BANNED in `apps/app/src/**` code.

**Why:** Rule 6 — core never names a specific extension in logic. `'zana'` literal in renderer violates seam.

**Guard:** `apps/app/src/__tests__/rule6-zana-literal.guard.test.ts` — scans comment-stripped renderer code, fails on ANY bare `'zana'`/`"zana"` token.

**When changing:**
- Guard tests must pass before PR. No `'zana'` string literal in apps/app/src/** source (registration site guarded by `apps/server/src/services/extensions/__tests__/core-extension-separation.guard.test.ts`).
