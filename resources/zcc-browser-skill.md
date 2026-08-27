---
name: zcc-browser
description: Drive the visible in-app browser tab in Zana Command Center's thread side panel. Use when the user wants you to open, inspect, click, type, or evaluate a page they can watch. Prefer this over WebFetch when the task is interactive QA or the user should see the page.
---

# zcc-browser — visible in-app browser

Use the **in-app browser** in this thread's right-hand panel when the user should
watch you navigate a page. These MCP tools drive a live desktop
`WebContentsView` — not a headless fetch.

`WebFetch` / `WebSearch` stay the tools for **headless** page fetches and search.
Do not use this skill for those.

## Tools

| Tool | Use |
| --- | --- |
| `browser_open` | Open (or focus) a visible tab. `url` is http(s) only; empty opens a blank tab. Returns `{ targetId, tabId }`. |
| `browser_list` | List automation targets the user can see. |
| `browser_snapshot` | URL, title, and a JPEG screenshot of a target. |
| `browser_click` | Click by CSS `selector` (preferred) or `x`/`y` coordinates. |
| `browser_type` | Type `text`. Optionally focus `selector` first. |
| `browser_eval` | Short JavaScript in that tab only. Keep it small and say why. |
| `browser_close` | Close that automation target. |

`targetId` is owned by this thread. You cannot drive arbitrary user tabs — only
targets returned by `browser_open`.

## Workflow

1. `browser_open` with the URL (or empty, then wait for the user).
2. `browser_snapshot` after navigation settles.
3. Click / type / eval against that `targetId`.
4. Snapshot again if you need to confirm the result.
5. `browser_close` when done, unless the user still wants the tab.

The user sees an **Agent is controlling this page** bar with **Stop**. If they
stop you, do not keep sending click/type/eval to that target.

## Caps and limits

- http(s) URLs only. No `file:`, `javascript:`, or OS popups.
- URL, selector, typed text, and eval script are length-capped.
- Screenshots are bounded JPEGs.
- There is **no** `--remote-debugging-port` on the app session.

## When not to use this

- Fetching a URL for content you will quote → `WebFetch`.
- Searching the web → `WebSearch`.
- The desktop app is not running (these tools error with a clear message).
