---
name: zcc-browser
description: Drive the visible in-app browser tab in Zana's thread side panel. Use when the user wants you to open, inspect, click, type, or evaluate a page they can watch. Prefer this over WebFetch when the task is interactive QA or the user should see the page.
---

# zcc-browser — visible in-app browser

Use the **in-app browser** in this thread's right-hand panel when the user should
watch you navigate a page. These MCP tools drive a live desktop
`WebContentsView` — not a headless fetch. `browser_list`, snapshot, click, type,
eval, and close are scoped to this thread's automation targets.

`browser_open` defaults to a **visible** side-panel tab. Pass `visible: false`
for off-screen automation (no chrome, no "watch the agent" tab). Snapshot,
click, type, and eval still work against the returned `targetId`.

Automation tabs use a **separate cookie jar** from personal in-app tabs. Agent
logins do not leak into a tab the user opened themselves, and vice versa.

`WebFetch` / `WebSearch` stay the tools for **headless** page fetches and search.
Do not use this skill for those. Headless browsing on enrolled remote machines
is a later additive layer — not a replacement for this visible tab.

## Tools

| Tool | Use |
| --- | --- |
| `browser_open` | Open a tab. `url` is http(s) only; empty opens a blank tab. Defaults to visible in the side panel. `visible: false` is off-screen. Returns `{ targetId, tabId }`. |
| `browser_list` | List automation targets this thread owns. |
| `browser_snapshot` | URL, title, and a JPEG screenshot of a target. |
| `browser_click` | Click by CSS `selector` (preferred) or `x`/`y` coordinates. |
| `browser_type` | Type `text`. Optionally focus `selector` first. |
| `browser_eval` | Short JavaScript in that tab only. Keep it small and say why. |
| `browser_close` | Close that automation target. |

`targetId` is owned by this thread. You cannot drive arbitrary user tabs — only
targets returned by `browser_open`.

## Workflow

1. `browser_open` with the URL (or empty, then wait for the user). Use
   `visible: false` only when the user should not see the tab.
2. `browser_snapshot` after navigation settles.
3. Click / type / eval against that `targetId`.
4. Snapshot again if you need to confirm the result.
5. `browser_close` when done, unless the user still wants the tab.

On a visible open, the user sees an **Agent is controlling this page** bar with
**Stop**. If they stop you, do not keep sending click/type/eval to that target.

## Caps and limits

- http(s) URLs only. No `file:`, `javascript:`, or OS popups.
- URL, selector, typed text, and eval script are length-capped.
- Screenshots are bounded JPEGs.
- There is **no** `--remote-debugging-port` on the app session.
- Automation cookies are not the personal in-app tab jar.

## When not to use this

- Fetching a URL for content you will quote → `WebFetch`.
- Searching the web → `WebSearch`.
- The desktop app is not running (these tools error with a clear message).
