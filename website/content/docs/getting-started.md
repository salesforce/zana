# Getting started

Zana Command Center (ZCC) turns supported coding harnesses into a
**multi-project cockpit**: run many agent sessions at once, see which ones
need you versus which are still working, reply to them, and drive multi-agent
workflows — all from one window.

This guide takes you from a fresh install to your first orchestrated agent in
about five minutes. ZCC launches the native CLI for Claude Code, OpenCode,
Codex, or Pi rather than wrapping the harness in a generic chat UI.

```mermaid
flowchart LR
    A["Install the app"] --> B["Add a project"]
    B --> C["Spawn an agent"]
    C --> D["Work in the terminal"]
    D --> E["Reply from the Inbox"]
    E --> C
```

---

## 1. Install

Download the app from the [**Download**](/download/) page and open it. macOS is
available today; Windows and Linux are on the way.

**Prerequisites:** [Node](https://nodejs.org) 20 or newer, `git`, and at least
one supported harness CLI on your `PATH`: Claude Code, OpenCode, Codex, or Pi.
If the harness works in your terminal, ZCC can launch its native session.

On first launch the app opens to an empty cockpit — no projects yet. That's the
next step.

---

## 2. Add your projects

A **project** is a folder (local) or an SSH host (remote) that ZCC watches.
Each one becomes a lane with its own terminals, agents, and file explorer.

- Click **Add project** in the sidebar.
- Point it at a local folder, or add a remote SSH box.
- Repeat for every codebase you work in — they all live in the same window.

You can group projects by category in the sidebar so a large fleet stays
navigable.

---

## 3. Spawn your first agent

Open a project and start a session. Every tab is a **real PTY running the
selected harness** with its native behavior, tools, and permissions.

- Hit **New agent** (or the `+` in the workspace) to open a session in the
  current project.
- The session starts in the project's directory, so the selected harness sees
  the right files immediately.
- Type your task and let it work — exactly as you would in a standalone
  terminal.

The difference is that you're not limited to one. Spawn several across
different projects and they run in parallel.

---

## 4. Watch the Agents board

The **Agents board** shows every running session at a glance, grouped by
status:

| Status | Meaning |
| --- | --- |
| **Needs you** | The agent asked a question or is blocked on a decision. |
| **Working** | Actively running — no action needed. |
| **Idle** | Finished a turn and waiting for your next instruction. |
| **Done** | The session has ended. |

Instead of tabbing between terminals to see who's stuck, you glance at the
board and go straight to the one that needs you.

---

## 5. Close the loop from the Inbox

The **Inbox** is where agents surface things you should see — finished
analyses, questions, and reports. When an agent asks a question, it appears as
an inbox entry.

- Open the entry, read the context, and **reply right there**.
- Your answer routes straight back to the waiting agent, as if you'd typed it
  at that session's prompt.
- An **AI Summary** card digests recent activity so a busy inbox stays
  readable.

This is the core loop: **make the wishes, the work gets done.** You stay the
executive — spawning work, answering the few things that need a human, and
letting the agents carry the rest.

---

## Where to go next

- **[Using Zana Command Center](/docs/using-zana/)** — a fuller tour of the
  Inbox, Agents, Teams, and the day-to-day workflows.
- **[The `zcc` CLI](/docs/cli/)** — a command-line companion that reads the
  same stores and can drive the running app.
- **[Extensions overview](/docs/extensions/)** — add panels, tabs, commands,
  personas, and teams without editing core.
