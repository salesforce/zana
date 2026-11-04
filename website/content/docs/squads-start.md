# Start with Squads

A **Squad** is a small team of AI agents that works on one goal together. This
page explains the few words you need, then walks you through your first run with
the built-in **Research Squad**. Setup takes a few minutes. The run itself
takes as long as the goal needs.

You do not need to write code or use Git to run the Research Squad. It reads
your Project and reports back. You do need a Project open in Zana and an AI
agent tool signed in.

Prefer to watch first? Nine Squad guide videos are under **Squads** in Zana's
Help menu.

---

## The words you need

- **Project** — the folder (on this computer or a remote one) where the work
  happens. You pick one every time you launch.
- **Persona** — one reusable agent profile: a role, a model tier (Low, Medium,
  or High), and instructions. Low is the cheapest and fastest. High is for the
  hardest reasoning. Zana ships ready-made Personas, so you do not need to
  create any.
- **Squad** — a named roster of Personas. Zana ships five Squads. You pick one
  when you launch.
- **Orchestrator** — the coordinator of a Squad. It plans and coordinates the
  work. It does not write the implementation or run shell commands itself. The only file it may write is its own plan, and only when you use Infer plan from goal (see Personas and custom Squads).
- **Plan** — the list of steps the workers carry out. Each step says what it
  depends on and how to check it is done.
- **Run** — one execution of a Squad against one goal. Runs show up on the
  Agents board, and each has a **Squad details** view.
- **Inbox** — where Zana asks you questions and reports outcomes. Open it with
  **⌘I**.

How they fit together: a Persona fills a slot in a Squad. When you launch the
Squad, each slot becomes a worker in the run. The Orchestrator hands the plan's
steps to the workers.

### Squad or single agent?

Use a **Squad** when:

- the work splits into pieces that can run side by side,
- a second pass (a challenge or a review) adds value, or
- you want a durable, watchable record of steps and results.

Use a **single agent** for small, serial, or exploratory tasks where you want to
steer turn by turn.

A finished run does not prove the goal was met. A person reads the result.

---

## Before you start

You need two things:

1. **A Project.** Add one if you have not yet. See
   [Getting started](/docs/getting-started/).
2. **One signed-in harness.** A harness is the AI tool Zana runs for you, such
   as Claude Code. Claude is the recommended choice for your first run. Sign in
   to it the way you normally would before you launch.

Zana checks a Squad's requirements when you launch it. If a required Skill or
MCP server is missing, Zana shows "Squad requirements need attention" and "No
workers started." It lists what is missing.

---

## Your first run: the Research Squad

The Research Squad has two low-tier investigators. It is a good fit for comparing options or summarizing an area of a codebase. The plan
below asks the workers not to edit files.

### 1. Open the Squad composer

Click **New agent** to open the launcher (also reachable from **New Chat**). Under **Launch
mode**, choose **Squad**.

If you do not see **Squad**, turn on the **Squad** checkbox under **Launch
surfaces** in Settings > Composer (its help text reads "Show durable Squad
mode.").

### 2. Pick the Squad and the planning mode

1. In the **Squad** picker, choose **Research Squad**.
2. Open **Squad planning** and choose **Plan provided in goal**.

With **Plan provided in goal**, you write the plan in the goal. Zana checks it
and starts the workers. The plan is fixed up front, so this is the best way to
learn.

### 3. Paste the plan as the goal

Copy this plan into the goal box. Replace `topic A` and `topic B` (each appears
in a title and in a work line) with two things you want researched.

```markdown
# Research Plan

## Execution Plan

### investigate-a: Investigate topic A <!-- executable-step -->

- **Depends on:** None
- **Execution class:** Routine
- **Mode:** Read-only
- **Write scope:** None
- **Work:** Research topic A using read-only inspection. Do not edit files. Record findings with sources and open questions.
- **Verification:** Every finding cites a file or source.

### investigate-b: Investigate topic B <!-- executable-step -->

- **Depends on:** None
- **Execution class:** Routine
- **Mode:** Read-only
- **Write scope:** None
- **Work:** Research topic B using read-only inspection. Do not edit files. Record findings with sources and open questions.
- **Verification:** Every finding cites a file or source.

### report: Write the research report <!-- executable-step -->

- **Depends on:** `investigate-a`, `investigate-b`
- **Execution class:** Routine
- **Mode:** Read-only
- **Write scope:** None
- **Work:** Combine both investigators' findings into one Markdown report with sections Summary, Findings (with sources), and Open questions. Return the full report as your completion result. Do not edit project files.
- **Verification:** The completion result covers both topics and every finding cites a source.
```

**Mode: Read-only** is an instruction to the workers. Zana does not enforce it.

What the plan says: two investigators work at the same time, one per topic.
When both finish, the `report` step combines their findings into one report.

### 4. Choose the Project and launch

1. Check the Project shown in the composer. Change it if needed.
2. Optionally add a **Title**. If you leave it empty, Zana makes one from the
   goal.
3. Press the **Launch squad** button, or press **⌘/Ctrl+Enter**.

Zana shows the message "Squad launched. Open Agents board to monitor it."

### The 2,048-character limit

The goal and the summary are each limited to 2,048 characters. The plan above
is about 1,200 characters, so it leaves room for your topic names. When the goal gets
close to the limit, a character counter appears. If you go over, Launch is
disabled and you see:

> The goal is too long for a Squad (N of 2,048 characters). Move details into
> an attached plan or source.

The fix is to attach a plan or source instead of pasting everything. Use
**Attach sources** (the file icon in the composer) to attach files for the
Squad to work from. Keep the goal itself short.

---

## Watch the run

1. Open the **Agents board**. Your run appears as a card.
2. Open the card to see **Squad details**. It shows progress for each step.
3. If Zana needs a decision, a question appears in the Inbox under **Needs your
   answer**. Answer it and the run continues.

If the plan has a problem, Zana pauses before any work starts and sends a **Plan
correction required** card to the Inbox. You can **Approve** a corrected plan,
**Request changes**, or **Cancel**.

For more on the board, the Inbox, and what each message means, see
[Watch a Squad run](/docs/squads-watch/).

---

## Read the result

When the run finishes, the Inbox shows "Squad completed: your title".

1. Open the run's **Squad details**.
2. Find **Assembled result**.
3. Open the `report` step. Its text is your research report.

Copy the report from there. Zana does not write the report to a file in your
Project for you.

### Review it yourself

The Research Squad has no reviewer slot. Nothing checks the report before you
see it. Read it, and check the sources it cites, before you rely on it.

---

## If a run stops or fails

Open the run's **Squad details**. Recovery buttons appear there when they apply:

- **Relaunch Squad from retained plan** — starts a new attempt with a new set
  of agents from the plan Zana kept for that run. The old run's record stays,
  but the new attempt runs the steps again. If the Squad edits files, check your
  Project before you relaunch.
- **Resume existing Squad** — continues the agents from the stopped run. It is
  available only when those sessions can be restored on this device; otherwise
  the button is disabled and shows the reason.
- **Recover timed-out run** — starts again after a run timed out while waiting
  for you.
- **Recover orchestrator** — restarts the Orchestrator.

Do not delete the run, its Squad details, or any worktree it created. Use a
recovery button first. Deleting removes the record of what already happened.

If you cancel at **Plan correction required**, that run cannot be resumed. Start
a new Squad instead.

---

## Next steps

- [Choose a Squad](/docs/squads-catalogue/) — the five built-in Squads, what
  each is for, and what each costs.
- [Launch a Squad](/docs/squads-launch/) — every way to start a run.
- [Watch a Squad run](/docs/squads-watch/) — the board, Squad details, and the
  Inbox.
- [Personas and custom Squads](/docs/squads-customize/) — build your own
  Personas and Squads, and the other planning mode.
