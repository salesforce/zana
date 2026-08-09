# Keyboard-Navigation Accessibility Audit — Zana Command Center

WCAG 2.1 AA · Target: full keyboard-only operability · Date: 2026-06-15

> Method: 6 accessibility experts audited the renderer in parallel (one per UI region), every critical/high finding was adversarially verified against source (26/26 confirmed, 0 refuted), then synthesized. 49 raw findings → 26 confirmed P0/P1 + 23 P2.

## Executive Summary

**No. A keyboard-only user cannot operate this app today.** Core workflows across every major region are mouse-only, and where elements are reachable, focus is frequently invisible. The pattern is systemic, not a scatter of one-off bugs: the same root causes (clickable `<div>`s, missing `:focus-visible`, no modal focus lifecycle) recur in 8+ files.

The 5 biggest blockers, in order:

1. **Webview keyboard trap (P0, critical)** — `PreviewPane.tsx:561` embeds a `<webview>` with no Tab-escape handling. Once focus enters the embedded page, the user cannot get back to app controls without a mouse. This is the only hard WCAG 2.1.2 *trap* and the single most severe issue.
2. **Global shortcuts steal keystrokes while typing** — `shortcuts.ts:21-284` runs a window-level keydown handler with no editable-target guard, so Cmd+B/L/P/E fire while the user types in any input or textarea (WCAG 2.1.4). This actively corrupts text entry app-wide.
3. **Primary lists are mouse-only** — project rows, session rows, terminal rows, file-tree rows, and overview cards are clickable `<div>`/`<article>` elements with no `tabIndex`/keyboard handler (`ListPane.tsx`, `ExplorerView.tsx:939`, `OverviewPanel.tsx:53-57`). Keyboard users cannot select sessions or projects — the app's central job.
4. **Custom menus aren't keyboard-operable** — tab context menu (`TabBar.tsx:344-472`), focus-mode launch menu (`ListPane.tsx:258-296`), and file-tree context menu (`ExplorerView.tsx:337`) can't be opened or navigated by keyboard.
5. **Focus is invisible almost everywhere** — a large set of inputs and buttons set `outline: none` with no `:focus-visible` fallback (`global.css` find input, palette input/items, icon buttons, agent cards, swatches). Even reachable controls give no visual feedback (WCAG 2.4.7).

## Themes (systemic — fix once, fix everywhere)

These five themes account for nearly every confirmed finding. Fixing a theme with a shared helper resolves many rows in the table below at once.

### T1 — The clickable-`div` pattern (WCAG 2.1.1 Keyboard)
Interactive rows/cards are built as `<div>`/`<article>` with `onClick` only — no `tabIndex`, no `role`, no `onKeyDown`. Keyboard users cannot focus or activate them.
- `ListPane.tsx:329-421` (session rows, focus mode), `:998-1062` (project terminal rows), `:825-873` (draggable project items, no keyboard reorder)
- `ExplorerView.tsx:939` (file-tree rows)
- `OverviewPanel.tsx:53-57` (project overview cards)

**Reusable fix:** a `<ClickableRow>` primitive (renders the right `role`, `tabIndex` roving, Enter/Space → activate, optional Shift+Arrow reorder hook).

### T2 — Custom menus with no keyboard model (WCAG 2.1.1, 4.1.2)
Menus open on right-click / mouse only, lack `role="menu"`/`role="menuitem"` arrow-key navigation, and several close on *any* keydown.
- `TabBar.tsx:344-472` (no roles, closes on any keydown line 119, opens only via right-click)
- `ListPane.tsx:258-296` (roles present but no Arrow handlers / focus management)
- `ExplorerView.tsx:337` (right-click only, no Shift+F10 / Menu key)

**Reusable fix:** a `useMenuKeyboard()` hook (focus first item on open, Up/Down/Home/End, Enter activate, Esc close + restore focus to trigger) plus a Shift+F10/Menu-key opener on the row.

### T3 — Modal focus lifecycle (WCAG 2.4.3, 2.1.2)
Dialogs don't trap Tab, don't move focus to the first control on open, and don't restore focus to the trigger on close; several miss `aria-modal`/`aria-labelledby`.
- `AddGitProjectDialog.tsx:117-201` (no trap, no restore, no `inert` background)
- `ScheduleGroupsModal.tsx:18-131` (focus lands on `tabIndex={-1}` container, no `aria-modal`)
- Unverified but same root cause: `QuickOpen.tsx:109`, `QuickAgentLauncher.tsx:143-179` (no focus restore); `ShortcutsHelp.tsx:85-123`, `ExtensionConsent.tsx:92-127`, `SchedulerPanel.tsx:1081/1407/1483`, `SkillsPanel.tsx:533` (missing `aria-modal`/`aria-labelledby`)

**Reusable fix:** a `useModalA11y(ref, { onClose })` hook — auto-focus first focusable, Tab trap, Esc to close, focus restoration to the opener, and a standard `role="dialog" aria-modal="true" aria-labelledby=…` contract.

### T4 — Missing `:focus-visible` (WCAG 2.4.7 Focus Visible)
The single most common defect. Global button/input resets strip outlines (`global.css:59`, `:628`, `:1668`) and most interactive classes never add a focus ring. Keyboard navigation is invisible.
- Inputs: `.find-input` (`global.css:3032-3040`, `:3035`), `.palette-input` (`:2844-2856`), plus `.tab-rename`, `.inbox-filter-input`, `.inbox-scheduled-head` (catalogued at `:628`)
- Buttons/rows: `.icon-btn` (`:575-602`), `.palette-item`/`.palette-item.active` (`:2905-2912`), `.remote-host-row` (`:1336-1342`), `.scheduler-color-swatch`/`.scheduler-icon-swatch` (`ScheduleGroupsModal.tsx:196-229`), `.scheduler-icon-btn` (`:6209`), `.settings-chip-remove` (`:2085`), `.skills-bundle-name` (`SkillsPanel.tsx:416`), `.scheduler-run-row` (`SchedulerPanel.tsx:821`), `.agent-card` (`:4408-4436`)
- Unverified, same cause: `.nav-item` (`:480-500`), `.tab` (`:2182-2241`), `.search-toggle` (`:3694-3716`), `.agents-row` (`:4672-4698`), `.agent-tray-row` (`:370-385`), `.launch-segmented button` (`:10648-10670`), `.quick-prompt-chip` (`:10835-10852`), `.launch-persona` (`:10700-10740`), `.launch-bg-row` (`:10792-10810`), collapsed `.sidebar-toggle` (`:238-255`)

**Reusable fix:** define one token `--focus-ring: 2px solid var(--accent-blue)` and a single shared rule `:where(button, [role="button"], input, [tabindex]):focus-visible { outline: var(--focus-ring); outline-offset: 2px; }`, then delete per-element `outline: none`. This one PR closes ~20 findings.

### T5 — Missing name/role/state for AT (WCAG 4.1.2)
Live regions, accessible names, and toggle/selection state are missing or under-specified.
- `Toaster.tsx:10-22` (container lacks `aria-live`/`aria-atomic`; dismissible toasts have no keyboard affordance)
- `skills-bundle-name` lacks `aria-label` (`SkillsPanel.tsx:416`); `scheduler-run-row` lacks `aria-label` under `role="button"` (`SchedulerPanel.tsx:821`)
- Unverified, same cause: `FindBar.tsx:62-68` (no `aria-pressed`), `:69-77` (title instead of `aria-label`); `LibraryView.tsx:329` (no `aria-selected`), `:307`; `InboxSidebar.tsx:236`; `MarkdownContent.tsx:56`

## Prioritized findings (P0 critical · P1 high · P2 medium/low)

De-duplicated by root cause. Where a row spans files, all are listed.

| Pri | Region | Issue (root cause) | WCAG | File(s) | Fix |
|-----|--------|--------------------|------|---------|-----|
| P0 | content-views | Webview keyboard trap — no Tab-escape from embedded page | 2.1.2 | `PreviewPane.tsx:561` | Add edge `onKeyDown` to detect Tab/Shift+Tab and refocus app controls; document Esc to exit |
| P1 | app-shell-nav | Global shortcuts fire while typing in inputs | 2.1.4 | `shortcuts.ts:21-284` | Early-return if `e.target` is input/textarea/`[contenteditable]` (mirror `InboxDetail.tsx:80`) |
| P1 | app-shell-nav, content-views, agents | **T1** Clickable-div rows/cards not keyboard-operable | 2.1.1 | `ListPane.tsx:329-421`, `:998-1062`, `:825-873`; `ExplorerView.tsx:939`; `OverviewPanel.tsx:53-57` | `<ClickableRow>` primitive: `role`, roving `tabIndex`, Enter/Space, Shift+Arrow reorder |
| P1 | app-shell-nav, content-views | **T2** Custom menus not keyboard-operable | 2.1.1, 4.1.2 | `TabBar.tsx:344-472`; `ListPane.tsx:258-296`; `ExplorerView.tsx:337` | `useMenuKeyboard()` hook + Shift+F10/Menu-key opener; add `role="menu"`/`menuitem` |
| P1 | overlays-modals | **T3** Modals don't trap/restore focus | 2.4.3, 2.1.2 | `AddGitProjectDialog.tsx:117-201`; `ScheduleGroupsModal.tsx:18-131` | `useModalA11y()` hook (trap, auto-focus, restore, `aria-modal`/`labelledby`) |
| P1 | terminal, overlays-modals, config-panels, agents | **T4** Missing `:focus-visible` on inputs/buttons/rows | 2.4.7 | `global.css` `:628`,`:575-602`,`:2844-2856`,`:2905-2912`,`:3032-3040`,`:1336-1342`,`:6209`,`:2085`,`:4408-4436`; `SkillsPanel.tsx:416`; `SchedulerPanel.tsx:821`; `ScheduleGroupsModal.tsx:196-229` | Global `:focus-visible` rule + `--focus-ring` token; remove blanket `outline:none` |
| P1 | terminal, config-panels | **T5** Missing name/role/state for AT | 4.1.2 | `Toaster.tsx:10-22`; `SkillsPanel.tsx:416`; `SchedulerPanel.tsx:821` | `aria-live`/`aria-atomic` on toaster + keyboardable toasts; add `aria-label`s |
| P2 | app-shell-nav | List-pane resizer not keyboard-operable; missing `aria-valuenow` | 2.1.1 | `ListPaneResizer.tsx:50-62` | Add `tabIndex={0}`, Arrow-key width adjust, `aria-valuenow` (already has `role/min/max`) |
| P2 | app-shell-nav, agents | **T4** extra focus rings (nav, tabs, agent rows/tray, launch chips/personas) | 2.4.7 | `global.css:480-500`,`:2182-2241`,`:4672-4698`,`:370-385`,`:10648-10670`,`:10835-10852`,`:10700-10740`,`:10792-10810`,`:238-255` | Covered by the T4 global rule |
| P2 | overlays-modals, config-panels | **T3** modals missing `aria-modal`/`aria-labelledby`; QuickOpen/QuickAgentLauncher no focus restore | 4.1.2, 2.4.3 | `ShortcutsHelp.tsx:85-123`; `ExtensionConsent.tsx:92-127`; `SchedulerPanel.tsx:1081/1407/1483`; `SkillsPanel.tsx:533`; `QuickOpen.tsx:109`; `QuickAgentLauncher.tsx:143-179` | Covered by `useModalA11y()` |
| P2 | terminal, content-views | **T5** names/state: FindBar `aria-pressed`/`aria-label`, Library `aria-selected`, Inbox/tag labels, markdown new-tab | 4.1.2 | `FindBar.tsx:62-68`,`:69-77`; `LibraryView.tsx:329`,`:307`; `InboxSidebar.tsx:236`; `MarkdownContent.tsx:56` | Add `aria-pressed`/`aria-label`/`aria-selected` per element |
| P2 | content-views | Preview URL selector no arrow-key nav | 2.1.1 | `PreviewPane.tsx:599` | Arrow keys between origins, Enter activate |

## Recommended remediation order

Ordered by impact-per-effort. Each chunk is one PR fixing a theme app-wide.

1. **PR1 — Global `:focus-visible` (T4).** Add `--focus-ring` token + one `:where(...)` `:focus-visible` rule in `global.css`; delete the blanket `outline:none` at `:628`/`:1668` and per-element overrides. *Highest ratio:* closes ~20 findings in one diff, no behavior change, low risk. Do this first.
2. **PR2 — Stop shortcut hijack (keystroke guard).** One guard at the top of `shortcuts.ts:21` handler. Tiny, unblocks all text entry. Pair with a quick regression check that Cmd+B etc. still work outside inputs.
3. **PR3 — `<ClickableRow>` primitive (T1).** Build the primitive, then convert the five row/card sites. Unblocks the central select-session/select-project workflows. Land the primitive + 1 site first to settle the API, then fan out.
4. **PR4 — `useModalA11y()` hook (T3).** Build trap/auto-focus/restore + standard dialog attributes; adopt in `AddGitProjectDialog` and `ScheduleGroupsModal` first, then the remaining P2 modals. Also removes a 2.1.2 trap risk at modal edges.
5. **PR5 — `useMenuKeyboard()` hook + keyboard openers (T2).** Apply to the three menus; add Shift+F10/Menu-key to rows (depends on PR3's focusable rows).
6. **PR6 — Webview trap (P0).** Isolated, fiddly (Electron `<webview>` focus semantics), so it gets its own PR despite being critical — don't let it block the cheap wins above. Add edge Tab interception + documented Esc.
7. **PR7 — Names/roles/state cleanup (T5)** and the resizer/preview-selector one-offs. Mechanical attribute additions; batch last.

Shared helpers worth building: `--focus-ring` CSS token, `<ClickableRow>`, `useMenuKeyboard()`, `useModalA11y()`. These four cover the overwhelming majority of the backlog.

## What was checked and is OK

- **Input-typing guard exists as a known-good pattern** in `InboxDetail.tsx:80` and `InboxSidebar.tsx:99` (`e.target instanceof HTMLInputElement || HTMLTextAreaElement` early-return) — reuse it for `shortcuts.ts`; the team clearly knows the idiom.
- **Native semantic buttons are used** for swatches (`ScheduleGroupsModal.tsx:196-229`), agent cards (`AgentBoard.tsx:115`), remote-host rows, and palette items — so Space/Enter activation already works; only the focus *ring* is missing, not the activation.
- **Some focus-ring exemplars already exist** (`.tab-close:focus-visible`, `.inbox-row`, `.zana-compact-row`, `.settings-field input:focus`, `.inbox-filter-input:focus`) — proof the visual language is defined; PR1 just generalizes it.
- **`ListPaneResizer` already has `role="separator"`, `aria-orientation`, `aria-valuemin/max`** (`:53-56`) — only `tabIndex`, key handling, and `aria-valuenow` remain.
- **Modals already set `role="dialog"` and (mostly) `aria-label`/`aria-modal`** and `ScheduleGroupsModal` does call `.focus()` on open — the bones are there; the lifecycle (trap + restore) is what's missing.
- **Scheduler run-rows already have Enter/Space handlers and `tabIndex={0}`** (`SchedulerPanel.tsx:821`) — only the `aria-label` and focus ring are outstanding.

> Note: No issues were refuted outright. Two confirmed findings had inaccurate *evidence* (the "closes on any keydown" claim for `ListPane.tsx:258-296`, and the "live-region" framing for `Toaster.tsx`) but the underlying defects are real — verify the exact line when fixing.
