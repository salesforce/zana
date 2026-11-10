# Watching a Squad

Once a Squad is running, you can watch it, answer its questions, and read the
result. This page shows where each of those lives. To start a Squad, see
[Ways to start a Squad](/docs/squads-launch/). For a first run, see
[Start using Squads](/docs/squads-start/).

The most important idea on this page:

- A **question** needs your answer. The run is waiting for you.
- A **stopped or failed run** is a different thing. Zana offers a recovery
  action in Squad details. Recovery keeps the old run's record, but the new
  attempt runs steps again.

---

## The Agents board

Every Squad run appears on the **Agents board** as a card. Squad runs and
single agents share the same board.

The board has three views. Use the view buttons to switch:

- **Board**: cards grouped by status.
- **List**: the same runs as a list.
- **Flow**: a canvas of the Squad's agents. Use the row of chips at the top to
  switch between **All squads** and a single run.

Open a card to see its **Squad details**. Right-click a card for its menu. While
a run is active, the menu has **Stop Squad run**.

---

## Squad details

Squad details is the full record of one run. It refreshes on its own while the
run is active.

At the top you see:

- **Run ID**, **Kind**, **Status** (with the attempt number), **Goal**,
  **Summary**, and **Squad**.
- **Started from**, when the run was started from a conversation. It shows the
  title, or "A Modern conversation" or "A CLI Agent session".
- **Orchestrator**, with its current status.

Below that:

| Section | What it shows |
|---|---|
| **Sources** | Files and attachments passed to the run, or "No execution sources." |
| **Work units** | How many steps are complete, and the progress percentage. |
| **Assignments** | Each step and the worker it is assigned to, with its state. |
| **Progress** | A list of events. Open one for detail. |
| **Artifacts** | Items a worker stored with the run. |
| **Usage** | Tokens per role, and the **provider-reported cost**. |
| **Assembled result** | The outcome, and the result of each step. |
| **Final summary** | The closing summary, or "Not completed." |

### Where to read the result

Read the result in **Assembled result**. Open a step to see the text that
worker returned. You do not need to look for a file in your Project.

A completed run is not proof that the goal was met. A person should review the
result.

### Cost

The **Usage** section lists input, output, cache read, and cache write tokens
for each role. It also shows **provider-reported cost**. This is the cost the
model provider reported. An unknown value shows as "unknown".

### Copy details

**Copy details** copies a plain-text version of the page. Use it if you need
to share a run with someone.

---

## Questions: your answer is needed

Sometimes a worker needs a decision or a missing detail. The run pauses and
asks you.

You can answer in two places:

- In the **Inbox**. Questions show under **Needs your answer** at the top.
- In Squad details. A **Current blocker** section shows the question, any
  options, and a **Response** box. Select **Respond** to send your answer.

The section is marked "Needs your response" while the run is open. A short
status line tells you if the answer is queued, delivered, or failed. If
delivery fails, a **Retry** button appears.

A question is not an error. Nothing has gone wrong. The run is waiting.

If a run is already closed, its last question stays visible as history. It can
no longer take a reply.

---

## Inbox items by launch path

What you see in the Inbox depends on how the Squad was started.

### Started from the composer

- A question for you. The subject is the job title (or "Job Execution
  Blocked"), and the text is the question.
- **Plan correction required**, when the plan you provided has a problem. See
  [Plan correction](#plan-correction).
- **Squad worktree retained**, when a worktree is kept after the run.
- When the run ends, one result item: **Squad completed: \<title\>**,
  **Squad failed: \<title\>**, or **Squad stopped: \<title\>**. If Zana kept a
  checkout it created, the result says **Squad ended, worktree kept** instead.

### Started from a conversation, with review

- The conversation that proposed the Squad receives a message that starts with
  **[Squad report]**. It says the run completed, failed, or stopped, and how
  long it took.
- An Inbox result item is posted as well.
- If the conversation is gone, a question appears in the Inbox as **Squad needs
  an answer: \<title\>**, and the result appears in the Inbox only.

### Started from a conversation, run now

- The conversation that owns the run gets the **[Squad report]**.
- An Inbox result is posted only if that conversation is gone.

### Started from Goals

The Inbox item is titled **Goal: \<title\>**. It says the goal was achieved,
hit its iteration limit, or stalled.

### Started from a Schedule

The Inbox subject is the schedule name, followed by success or error and how
long it took. How loud it is follows the schedule's **Inbox notifications**
setting (Silent, Quiet, or Notify). Errors are loud even on a Quiet schedule. Silent records nothing.

---

## Plan correction

If you start a Squad with **Plan provided in goal** and the plan has a problem,
the run pauses before any work starts. An Inbox card called **Plan correction
required** explains:

- "Problem with the supplied plan: \<reason\>"
- "Proposed corrected plan: N steps"
- A list of things Zana fixed automatically.

Choose one action:

- **Approve**: use the corrected plan. Only shown when a corrected plan exists.
- **Request changes**: ask for a different correction.
- **Cancel**: stop here.

Small problems are fixed for you. Examples are ids like `U1` that become `u1`,
and slightly misspelled labels.

If you choose **Cancel**, the run cannot be resumed. Squad details shows a
disabled **Resume existing Squad** button with the message "Cancelled at plan
correction. Start a new Squad to try again." Start a new Squad from the
composer.

---

## When a step fails or is blocked

While the run is active, if a worker's step fails or is blocked, Squad details
shows **Retry work** for that step. You can choose another slot first. A step that is claimed shows
**Release work**. A step that is ready shows **Reassign work**.

---

## When a run stops: recovery

A run can end as **COMPLETED**, **FAILED**, or **STOPPED**. If a run fails or
stops, recovery actions appear at the top of Squad details.

**You do not need to delete anything to recover.** Recovery actions start a new
attempt and keep the old run's record and results. You can still read the
earlier run in Squad details. The new attempt runs steps again, so it can change
your files again if the Squad edits them. A **worktree** is a separate copy of
your Project's files on its own Git branch, so a Squad can edit without touching
your main files. Worktree isolation is a Squad setting and is off by default,
so many runs edit your Project folder directly. Check your Project before you
relaunch a Squad that edits files. If you are unsure which button to use, try
**Relaunch Squad from retained plan** when it is shown.

| Button | When it appears | What it does |
|---|---|---|
| **Recover timed-out run** | The run stopped because it timed out while waiting on an unanswered question, and has no successor yet. | Starts a fresh run. Steps that already completed are not repeated, and their results are passed to the new run as context. Zana refuses if the plan has a step that is not **Mode:** Read-only. |
| **Relaunch Squad from retained plan** | The run is FAILED or STOPPED, has no successor, and was not cancelled at plan correction or stopped for an unanswered question. | Starts a new run from the plan Zana kept. |
| **Resume existing Squad** | Same conditions as above, and Zana can restore the earlier worker sessions on this device. | Reopens the earlier worker sessions for the same run. |
| **Recover orchestrator** | The Orchestrator was lost and recovery is available. | Starts a replacement Orchestrator. |

Other things you may see:

- **Resume existing Squad** shown but disabled. The message explains why. For
  example: "Existing Squad sessions cannot be restored on this device." Use
  **Relaunch Squad from retained plan** instead if it is shown.
- **Recovered successor: \<id\>**. A recovery has already started. The new run
  has its own card.
- "Orchestrator lost." with "Recovery available" or "Recovery deadline
  expired."

If a run is BLOCKED with no open question, **Retry Squad run** appears at the
bottom of Squad details.

### Recovery after an Infer-plan run

If you used **Infer plan from goal**, the Orchestrator writes the plan itself.
Zana keeps that plan across retries and recovery. For how it works, see
[Personas and custom Squads](/docs/squads-customize/).

---

## Stop a run

To stop a run that is still active:

- In Squad details, select **Stop Squad run**. It sits at the bottom.
- Or right-click the card on the Agents board and choose **Stop Squad run**.

A stopped run keeps its results. Recovery actions may then appear.

---

## Retained worktrees

A Squad can merge or delete its worktree and branch when a run completes. See
**When a run finishes** in [Personas and custom Squads](/docs/squads-customize/).
Failed and stopped runs always keep the worktree.

If a run kept a worktree, Squad details shows **Retained worktree** with its path
and branch. Your options:

- **Instruct an agent**: describe follow-up work. You can choose a **Follow-up
  persona**.
- **Leave worktree**: keep it as it is. This is the safe choice.
- **Delete worktree**: asks you to confirm first. It will not delete a worktree
  with uncommitted changes.
- **Force delete unmerged work**: removes the worktree even with unmerged
  commits or uncommitted changes. Both are lost. This cannot be undone. The
  confirmation says so before it deletes anything.

You do not need to delete anything to recover or to read results.

---

## Quick reference

| What you see | What it means | What to do |
|---|---|---|
| Inbox: **Needs your answer** | A worker is waiting for you. | Answer in the Inbox or in Squad details. |
| **Plan correction required** | Your provided plan had a problem. | **Approve**, **Request changes**, or **Cancel**. |
| Status FAILED or STOPPED | The run ended early. | Use a recovery button in Squad details. |
| **Squad completed: \<title\>** | The run finished. | Open Squad details and read **Assembled result**. Review it. |
