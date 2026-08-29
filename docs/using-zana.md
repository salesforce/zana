# Using Zana Command Center

Once you've [installed the app and spawned your first
agent](/docs/getting-started/), this guide covers the day-to-day surfaces — the
ones you'll live in as you scale from one session to a fleet.

ZCC uses a **three-column layout**: the **sidebar** (projects and global
surfaces) → a **list pane** (what's inside the selected surface) → the
**workspace** (tabbed terminals and panels). Everything below is reachable from
the sidebar.

---

## Agents

The **Agents board** is the home base for orchestration: every running session
across every project, grouped by status — *needs you*, *working*, *idle*,
*done*. It's the answer to "which of my agents is stuck?" without tabbing
through terminals.

From the board you can:

- **Jump to** any session's terminal in one click.
- **Star** an agent to pin it — starred agents are never reclaimed by
  auto-close-idle.
- **Close** a session when its work is done.

Each tab is a real harness PTY, so the native Claude Code, OpenCode, Codex, or
Pi workflow remains available inside Zana.

### Keeping the fleet tidy

Two optional automations (both **off by default**, toggled under the Agents
rail and in Settings) help a large fleet manage itself:

- **Auto-close-idle** — closes a non-background agent after it has sat idle for
  a configurable number of minutes. Starred agents and the foreground session
  are always spared. A parked question is preserved as a follow-up before the
  close, so nothing is lost.
- **Overseer** — a lightweight supervisor mode. Start with *dry-run* to see
  what it would do before letting it act.

---

## Inbox

The **Inbox** is the single place agents talk to *you*. Rather than scrolling
each terminal, agents push here when they:

- finish an analysis or a multi-step task (often linking a report doc),
- hit a decision only you can make,
- get blocked on an error, or
- want to summarize an outcome.

**Reply inline.** When an entry is a question, your answer routes straight back
to the waiting agent as if typed at its prompt — you never have to find the
right terminal.

**Signal vs. noise.** The feed keeps high-value items (reports, ideas,
questions, goals) inline as solo rows, and folds high-volume routine events
(scheduled runs, auto-closed agents, heartbeats) into collapsible per-project
sections so they can't bury what matters.

**AI Summary.** A card at the top digests recent activity into a few lines, so
even a busy inbox is readable at a glance. It refreshes on its own as the inbox
changes.

---

## Teams

A **team** is a saved composition of agents — each with its own persona — that
you can launch together against a project. Instead of spawning and briefing
several agents by hand, you launch the team and each member starts in its role.

Use teams for recurring shapes of work: a *review* team (implementer +
reviewer + security), a *research* team fanning out across sources, or a
*council* that deliberates and returns a verdict. Teams and their member
**personas** are edited from the sidebar, and extensions can contribute their
own.

### Team Jobs

You can launch a Team as a durable **Job**. Jobs track long-running or autonomous
work with persistent status, artifact collection, and completion history visible on
the Agents board. 

- **Launch**: Open **New agent** from the Agents board, select **Job Team**, choose a Team and project, enter the required goal, and optionally add a title and summary.
- **Settings**: Autonomous Team runs and Team Jobs share timeout and nudge settings (configured in Settings → Agents). Defaults are 45-minute inactivity timeout and 30 maximum nudges; setting either to 0 disables that safeguard.
- **History & Retention**: Completed Jobs appear on the Agents board. You can scroll or click "Load older history" to retrieve past jobs. Job records and their visible history are retained for at least 30 days.

---

## Goals & Follow-ups

These two surfaces capture work that outlives a single session:

- **Goals** — autonomous objectives. You state an outcome; the app pursues it
  across multiple agent turns, surfacing progress and decisions to the Inbox.
- **Follow-ups** — durable parked questions. When an agent genuinely needs a
  human and the session might end first, the question is parked here and
  **survives restarts**. You answer when you're ready; it doesn't get lost in
  scrollback.

---

## Tickets

Each project has a built-in **kanban** with sprints and docs. Tickets give a
fleet of agents a shared, persistent work list: you (or an agent) create
tickets, agents claim and complete them, and progress is visible on the board.
It's the coordination layer for work too big for one session.

---

## Chat

**Chat** talks to the app itself. It's a super-agent that can spawn teams, run
agents, and drive the orchestration surfaces on your behalf — a conversational
front door to everything above when you'd rather describe an outcome than click
through it.

---

## Scheduler

The **Scheduler** runs recurring tasks — a nightly review, a periodic
dependency audit, a morning digest. Scheduled runs report into the Inbox
(folded as routine so they don't crowd the feed) and can notify you when they
find something worth surfacing.

---

## Settings worth knowing

- **Theme** — light and dark are both first-class; the toggle lives in the nav.
- **Automations** — the auto-close-idle and Overseer switches, plus their
  thresholds.
- **Feed-noise classifier** *(optional)* — a small background helper that
  demotes ambiguous routine reports into the folded "Routine" section. Off by
  default.
- **Extensions** — install from the marketplace or manage what's installed. See
  the [Extensions overview](/docs/extensions/).

---

## Where to go next

- **[Getting started](/docs/getting-started/)** — if you skipped the five-minute
  setup.
- **[The `zcc` CLI](/docs/cli/)** — drive ZCC from the command line.
- **[Build your first extension](/docs/extensions-quickstart/)** — extend the
  cockpit in TypeScript.
