---
name: zcc-preview
description: Open a file in Zana's thread side-panel preview. Use when the user should see a file you wrote or found — a report, diagram, config, or source file. Prefer Read for your own inspection.
---

# zcc-preview — visible file preview

Use **`preview_file`** to open a file in this thread's right-hand **preview**
tab so the user can look at it. This is a show-the-user action, not a substitute
for `Read`.

`Read` stays the tool for **your** inspection. Do not preview every file you
touch — only files the user should see.

## Tool

| Tool | Use |
| --- | --- |
| `preview_file` | Open (or focus) a side-panel preview tab. `path` is relative to the project. Optional `source` is `workspace` (default) or `thread-storage`. Optional `lineNumber` is 1-based. |

The tool is scoped to **this** thread. You cannot open a file in another
thread's panel.

## Workflow

1. Write or locate the file (`Write` / `Read` / `Glob`).
2. Call `preview_file` with that path when the user should see it.
3. Keep talking in the thread — the preview is a side panel, not a reply.

## When not to use this

- You only need the contents yourself → `Read`.
- You want to surface a durable deliverable in the inbox → `inbox_push` with `docs`.
- You want the user to watch a web page → `browser_open` (`zcc-browser`).
