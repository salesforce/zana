# Using Zana Command Center

Once you've [installed the app and spawned your first
agent](/docs/getting-started/), this guide covers the day-to-day surfaces — the
ones you'll live in as you scale from one session to a fleet.

ZCC uses a **three-column layout**: the **sidebar** (projects and global
surfaces) → a **list pane** (what's inside the selected surface) → the
**workspace** (threads, terminals, and panels). Everything below is reachable
from the sidebar.

---

## New Chat

**New Chat** is the home composer. Pick a launch mode, then describe the work:

- **Thread** *(default)* — a conversation with the selected harness in the
  project you pick. This is the usual path for day-to-day work.
- **CLI Agent** — a real PTY running the native CLI, with the same tools and
  permissions as a standalone terminal.
- **Autonomous Team** — launch a saved team of personas against the project when
  the work benefits from parallel roles.

The composer also picks the workspace (this checkout, a new worktree, or
personal scratch). See [Environments](#environments).

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

A **CLI Agent** tab is a real harness PTY, so the native Claude Code, Cursor,
OpenCode, Codex, or Pi workflow remains available inside Zana. **Threads** are
the default conversation surface from New Chat.

### Environments

A launch picks a **workspace** — the directory the agent actually writes in.
The composer picker on a local git project offers:

- **This checkout** — the registered project folder. Palette, Inbox, scheduler,
  shell, team, and remote launches always use this default.
- **New worktree** — a managed git worktree on `zcc/<name>-<id>`, created under
  `~/.zcc/worktrees/<environmentId>/<repoName>`. Optional **Base branch**
  defaults to the server's policy (usually `main`/`master`). The main checkout
  is left untouched.
- **Reuse** — attach another agent to an existing ready worktree.
- **Personal scratch** — a non-git folder under
  `~/.zcc/personal-workspaces/<environmentId>`.

Remote SSH projects can only use **This checkout**. This slice does not create
managed worktrees over SSH.

Leftover folders under `~/zcc-worktrees` (the previous desktop mint path) stay
on disk as unmanaged checkouts. New worktrees are not created there.

Two optional files in the source repo customize a new worktree:

- **`.worktreeinclude`** — gitignore syntax. Matching untracked files (for
  example `.env`) are copied into the new worktree. Symlinks are not followed
  and tracked files are never overwritten.
- **`.zcc-env-setup.sh`** — runs after the worktree is created. A non-zero exit
  rolls the worktree back and the thread does not start.

From the agent detail panel you can commit, squash into the local default
branch, and open a PR against `gh` on the host.

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
**personas** are edited from the sidebar, and plugins can contribute their
own.

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

## Plugins for tickets and more

Core does not ship a project ticket board. The Agents board is about *session
state*, not sprints. Install workflow plugins from the **Plugins** hub (for
example **tasks**, or a GUS/Tickets plugin) when you want a persistent work
list that agents can claim. Browse official and community catalogs from
**Plugins → Browse**. See the [Plugins overview](/docs/extensions/).

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
- **Machines** — pair another computer so projects and threads can run there.
  See [Using Zana on multiple machines](/docs/multiple-devices/). SSH remotes
  stay a separate path.
- **Plugins** — the top-level **Plugins** hub (not a Settings page) installs
  from the marketplace and manages what's installed. This is ZCC's catalogue,
  not Claude Code's `~/.claude/plugins`. See the
  [Plugins overview](/docs/extensions/).

---

## Where to go next

- **[Getting started](/docs/getting-started/)** — if you skipped the five-minute
  setup.
- **[Using Zana on multiple machines](/docs/multiple-devices/)** — enroll a
  host daemon on another computer.
- **[The `zcc` CLI](/docs/cli/)** — drive ZCC from the command line.
- **[Build your first plugin](/docs/extensions-quickstart/)** — extend the
  cockpit in TypeScript.
