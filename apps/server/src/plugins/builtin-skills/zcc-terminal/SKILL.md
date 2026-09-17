---
name: zcc-terminal
description: Open a visible ZCC shell instead of Terminal.app, iTerm, or Cursor’s terminal. Use when the user should watch a command in this app. Keep short Bash/Shell calls for commands you only need the output of.
---

# zcc-terminal — visible in-app shell

Use **`run_in_terminal`** when you would otherwise open a standalone terminal
so the user can watch a command — Terminal.app, iTerm, WezTerm, Alacritty,
`open -a`, osascript, or Cursor/VS Code’s terminal.

That opens a **ZCC shell** in this thread’s side panel (or a project Terminals
tab for a CLI Agent). Stay in this app.

Short commands you only need the output of (`ls`, `grep`, one-shot tests) stay
on the native Bash/Shell tool.

## Tool

| Tool | Use |
| --- | --- |
| `run_in_terminal` | Open (or focus) a visible ZCC shell. Optional `command` runs in that shell (`$SHELL -lc`). Optional `title` names the tab. Empty command ⇒ an idle login shell the user can type into. |

The tool is scoped to **this** thread or CLI Agent session. You cannot open a
shell in another session.

## Workflow

1. Decide the user should **watch** the command (dev server, long tests, interactive CLI).
2. Call `run_in_terminal` with that command (and a short title).
3. Keep talking in the thread — the shell is a side panel / project tab, not a reply.

## When not to use this

- You only need stdout yourself → native Bash/Shell.
- You want to show a **file** → `preview_file` (zcc-preview).
- You want the user to watch a **web page** → Browser Automation / `zcc browser`.
- Do **not** call `zcc terminal create` from inside a ZCC agent (`FORBIDDEN_AGENT`).
- Do **not** `open -a Terminal` / iTerm / WezTerm / Alacritty, osascript, or editor terminal CLIs.
