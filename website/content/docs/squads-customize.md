# Personas and custom Squads

This is the advanced page. You do not need it for your first run. The five
built-in Squads work as they are. Come here when you want to change a Persona,
build your own Squad, tune how a Squad launches, or write a plan by hand.

New to Squads? Start with [Start using Squads](/docs/squads-start/). To pick a
built-in Squad, see [Choose a Squad](/docs/squads-catalogue/). For the ways to
start one, see [Ways to start a Squad](/docs/squads-launch/). For the board,
Squad details, and the Inbox, see [Watching a Squad](/docs/squads-watch/).

---

## The Personas page

Open **Settings → Agents & Automation → Personas**.

A Persona is one reusable agent profile. A Squad slot points at a Persona.

The page has:

- A search box and a source filter: **All**, **Builtin**, **User**,
  **Project**, and **Extension**.
- **New persona** to create your own.
- **Reveal personas dir** to open the folder where your Personas are saved.
- A right-click menu on each row with **View** (or **Edit** for your own
  Personas), **Reveal folder**, **Duplicate** and, for your own Personas,
  **Delete**.

Your own Personas are saved in `~/.zcc/personas`.

### Edit override and Duplicate to user

Open a Persona to see its detail. The button at the bottom depends on where the
Persona comes from:

| Source | Button | What it does |
|---|---|---|
| Builtin | **Edit override** | Opens the editor titled "Override <name>". Saving writes your own copy with the same id. The built-in itself is never changed. |
| User | **Edit** | Edits your Persona in place. |
| Project or Extension | **Duplicate to user** | Makes a personal copy. The original is not changed. |

A built-in shows this note: "Built-in — editing saves a personal override you
can reset anytime." In the editor, **Reset** removes your override and brings
back the built-in. A Persona you created has **Delete** in the same place.

### Persona fields

| Field | Default | When to change it |
|---|---|---|
| **Name** | empty (required) | Always set one. |
| **Icon** | none | To tell Personas apart at a glance. |
| **Description** | empty | One line shown in the catalogue and pickers. |
| **Harness profile** | **Use launch harness (neutral)** | Leave it neutral so the Persona follows whichever harness you launch with. Pick a harness only if this Persona must always use it. |
| **Model level** | **Use harness default (unset)** | Shown while the harness profile is neutral. Choose **Low (speed/cost sensitive)**, **Medium (balanced normal)**, **High (frontier reasoning)**, or **Extra-high (deep reasoning)** to set the tier. |
| **Execution state** | **Use harness default (unset)** | Shown while the harness profile is neutral. Choose **Plan (planning only)**, **Interactive (human-in-loop)**, **Accept Edits (auto-approve edits)**, or **Autonomous (fully auto)**. |
| **System prompt (appended)** | empty | To give the Persona standing instructions. |
| **Opening prompt** | empty | Text written to the session after it starts. |

Persona settings apply after Global and Project defaults and before the choices
made for a single Agent: Global, then Project, then Persona, then Agent.

When you pick a harness profile, the page shows that harness's own fields instead
(such as **Model**, **Provider**, and **Execution state**). Blank values use the
Project and Global settings.

A Persona that cannot write files cannot write a plan. This matters for the
Orchestrator. See [Infer plan from goal](#infer-plan-from-goal-a-second-step).

---

## The Squads page

Open **Settings → Agents & Automation → Squads**.

The page has:

- **New squad**, **Import bundle**, and **Reveal**.
- A search box and the same source filter as Personas.
- A row for each Squad, with an **Export** button and a **Launch** button.
  **Launch** here opens the Squad's agents as tabs. It does not start a
  planned run with a Job. To start a run, use the composer. See
  [Ways to start a Squad](/docs/squads-launch/).
- A right-click menu on each row: **View** (or **Edit** for your own Squads),
  **Reveal folder**, **Duplicate**, **Set as default** (or **Clear default**),
  and **Delete** for your own Squads.

Your own Squads are saved in `~/.zcc/teams`.

### Edit override and Duplicate to user

Open a Squad to see its detail. It lists the slots, the opening prompt, and the
Squad's transport. The bottom button depends on the source:

| Source | Button | What it does |
|---|---|---|
| Builtin | **Edit override** | Opens the editor titled "Override <name>". Saving writes your own Squad with the same id. Use **Reset** to go back to the built-in. |
| User | **Edit** | Edits your Squad in place. **Delete** removes it. |
| Project | **Duplicate to user** | Makes a new personal Squad from it. The Project file is not changed. |
| Extension | **Duplicate to user** | Same. Extension Squads are defined by the extension, so you edit a copy. |

A built-in Squad's detail also shows its **Squad routing** value.

To keep the original and also make your own, use **Duplicate** in the row menu,
or **New squad** to start from scratch. **Edit override** instead writes your
own Squad with the same id as the built-in. Use **Duplicate** for a first custom
Squad. A Squad needs a **Name** and at least
one slot before **Save** is enabled.

---

## Every option in the Squad editor

The editor fields appear in this order. "Default" is what a new Squad starts
with.

### Name, Icon, Description

**Name** is required. **Icon** and **Description** (one line shown in the
catalogue) are optional.

### Transport

- Choices: **CLI Agent** or **Modern**.
- **CLI Agent** runs each agent as a command-line agent session. **Modern** uses the same session type as the **Modern** launch mode in New Chat and New agent.
- Default: **CLI Agent**. If you are unsure, keep it.
- Help text: "One transport applies to every worker and orchestrator."

The transport belongs to the Squad. You do not choose it at launch. Every Squad
picker shows it as a small chip. Change it when you want the Squad's agents to
run on the other kind of session. It also decides how an Orchestrator hands
over an inferred plan. See
[Infer plan from goal](#infer-plan-from-goal-a-second-step).

### Slots

A slot is one Persona in the Squad.

- **Add slot** adds a row. Each row has a Persona picker, an optional label
  (**Label (optional)**), and a tab count (1 to 16). The tab count is how many
  workers that slot starts.
- Use the arrows to reorder rows and the **x** to remove one.
- The header shows the total, for example "Slots · 4 tabs".

**Crown (Mark as orchestrator).** The crown button on a row marks that Persona
as the Orchestrator. The tooltip says: "Orchestrator — launched first, carries
the opening prompt." A Squad run needs an Orchestrator, so crown one slot. The
Orchestrator is launched first and always gets its own tab. Removing the
crowned row clears the Orchestrator.

A Squad can hold up to 64 slot rows, but one run starts at most 32 tabs,
including the Orchestrator. If the rows add up to more, Zana starts the
Orchestrator and the first 31 workers in row order, and drops the rest without
a warning.

### Opening prompt

- Default: empty.
- Placeholder text: "Handed to the orchestrator's tab after it starts"

Use it for standing instructions that apply to every run of this Squad, such as
how to report results. Put the goal itself in the composer, not here.

### Default project

- Choices: **None — choose at launch**, or any of your Projects.
- Default: **None — choose at launch**.

When you pick this Squad in the composer and have not chosen a Project, the
composer uses the Squad's default project. Set it when a Squad always works on
the same Project.

### Worktree isolation

- Choices: **Use default**, **On**, **Off**.
- Default: **Use default**.
- Help text: "Creates one shared branch and checkout for durable squad runs. Use
  default follows the effective project-or-global setting; On forces a shared
  squad worktree; Off disables it."

Zana decides in this order: the launch itself, then the Squad, then the
Project, then the global setting. The Project setting is **Settings → Project →
Worktree isolation** (**Use global default**, **Always use worktrees**, **Never
use worktrees**). The global setting is **Prefer a new git worktree by default**
under **Git worktrees** in Settings, and it is off unless you turn it on.

Change this on a Squad when its runs should always (or never) get their own
checkout, whatever the Project says. See
[Worktrees and cleanup](#worktrees-and-cleanup).

### When a run finishes

- Choices: **Keep worktree (default)**, **Merge everything into base branch,
  then remove**, **Delete worktree and branch**.
- Default: **Keep worktree (default)**.
- Applies only when the run used a shared Squad worktree. See
  [Worktrees and cleanup](#worktrees-and-cleanup).

A failed or stopped run always keeps its worktree, whatever you choose. A
Squad pointed at a worktree you made yourself never merges or deletes it. If a
launch sets its own choice, that choice wins over the Squad's. Zana reads the
Squad's setting when the run ends, so editing the Squad while a run is going
changes what that run does.

### Squad routing

- Choices: **Use default**, **On**, **Off**.
- Default: **Use default**.
- Help text: "Use default follows the global setting; On tier-routes work when
  supported; Off falls back. Manual assignments are not checked."

Routing matches each step to a worker of a suitable model tier. Leave it on
**Use default** unless you have a reason. The built-in Debug Squad and Delivery
Squad set it to On. If routing is on and no worker can take a step, that step
fails with `NO_QUALIFIED_ROUTE`. Routing is only enforced when Zana knows the
model level of every worker. See
[Choose a Squad](/docs/squads-catalogue/).

### Keep orchestrator running after completion

- A checkbox. Default: off.
- Help text: "Keeps the orchestrator open after a successful run. Workers still
  close; stopping or failing the run closes all agents."

Turn it on if you want to talk to the Orchestrator after the run finishes.

### Default planning

- Choices: **Use the global default**, **Infer plan from goal**, **Plan
  provided in goal**.
- Default: **Use the global default**.
- Help text: "Sets the planning mode when this Squad is picked in the composer
  or proposed by an agent."

The global default is **Default plan mode** in **Settings → Agents &
Automation → Agents**. It starts as **Infer plan from goal**. Setting a value on the
Squad makes the composer start with that mode when you pick the Squad. You can
still change **Squad planning** in the composer. Pick **Plan provided in goal**
here for a Squad that you always launch with a written plan.

### Launch approval

- Choices: **Use the Project setting**, **Agents can launch directly if the
  Project allows**, **Review before launch**.
- Default: **Use the Project setting**.
- Help text: "Review before launch stops an agent from starting this Squad on
  its own. It proposes the run and you press Launch from the Inbox. A Project
  set to Review before launch applies to this Squad whatever is chosen here.
  Launching from the composer, schedules and triggers is not affected."

The Project setting is **Settings → Project → Squad launch approval**, with
**Agents can launch directly** (the default) and **Review before launch**.
Review wins: if either the Squad or the Project says review, an agent has to
propose and you press Launch. Choose **Review before launch** on a Squad you
want to see before it starts.

### Default Squad

The editor has no Default Squad field. Use the row menu on the Squads page:
**Set as default**, or **Clear default** to remove it.

- The row then shows a **Default** pill. Its tooltip reads "Preselected in New
  Agent".
- The composer preselects the default Squad. With no default, it preselects the
  first Squad alphabetically.
- Setting another Squad as default clears the previous one.
- On a built-in or Project Squad, **Set as default** saves a user copy and
  marks that copy, and the toast says so.

---

## Writing a plan

With **Plan provided in goal**, you give the Squad the steps. Zana reads them
before the run starts, so the plan is checked up front and the workers start
right away.

Put the plan in the goal, or attach it as a source if it is long. The goal is
limited to 2,048 characters. If it is too long, Zana says: "The goal is too
long for a Squad (N of 2,048 characters). Move details into an attached plan or
source."

### The format

Each step is a level-3 heading (`###`) that ends with the marker
`<!-- executable-step -->`. The heading text is `id: Title`, where the id is a
short lowercase name such as `investigate-a`. Under each heading, write the
fields as a bulleted list with bold labels.

```markdown
### investigate-a: Investigate topic A <!-- executable-step -->

- **Depends on:** None
- **Execution class:** Routine
- **Mode:** Read-only
- **Write scope:** None
- **Work:** Research topic A. Record findings with sources.
- **Verification:** Every finding cites a source.
```

The labels Zana understands are: **Depends on**, **Execution class**,
**Required role**, **Mode**, **Read scope**, **Write scope**, **Excludes**,
**Work**, **Verification**, **Completion criteria**, **Stop conditions**,
**Outputs / handoff**, and **Requires**.

### The rules

- Every step needs an id and a title in the heading, separated by a colon.
- Every step needs a **Work** field.
- Every step needs a **Verification** field.
- A step that changes files needs a **Write scope**: a list of paths inside
  the Project, separated by commas. Absolute paths are refused. A step whose
  **Mode** says read-only does not need one.
- **Depends on** lists the ids of other steps, separated by commas, or
  `None`. Every id it names must exist. Steps cannot depend on each other in a
  circle.
- Step ids must be unique.
- A plan has between 1 and 100 steps.
- **Execution class** is `Routine`, `Standard`, or `Expert`. They ask for the
  Low, Medium, and High tier. Anything else is refused.
- **Requires** looks like `Skills: a, b; MCP servers: c`, or `None`.
- A **Work** field can run over several lines and can hold code blocks. A
  code block must be closed.
- The Work text of one step can be up to 16,384 characters.

### What Zana fixes for you

Some small mistakes have one clear fix, so Zana repairs them and tells you:

- An id that is not lowercase with hyphens (for example `U1` or `Home Step`)
  becomes `u1` or `home-step`. The same repair applies in **Depends on**.
- A label with a near-miss spelling (for example `Depend on`) is read as the
  label it was close to.
- A trailing full stop on a value, such as `Routine.`, is ignored.

If Zana cannot fix a plan without guessing what you meant, the run waits
before any work starts. The Inbox shows **Plan correction required** with
"Problem with the supplied plan: <reason>" and a proposed corrected plan. You
can **Approve** (when a corrected plan exists), **Request changes**, or
**Cancel**. Cancel ends that run, and Squad details then shows a disabled
**Resume existing Squad** with the note "Cancelled at plan correction. Start a
new Squad to try again." Start a new Squad to try again.

### A complete example

This plan is the one used in [Start using Squads](/docs/squads-start/). It has
two investigations that can run side by side and one report that waits for both.

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

Read the result in **Assembled result** in Squad details. A person still reviews
it.

---

## Infer plan from goal: a second step

**Infer plan from goal** lets the Orchestrator write the plan from your goal.
Try it after you have finished a run with **Plan provided in goal**. The
Orchestrator needs to be able to hand its plan to Zana, and how it does that
depends on the Squad's **Transport**.

- **CLI Agent.** The Orchestrator writes the plan as a file in a `.zana` folder.
  Zana reads that file when the Orchestrator goes idle, checks it with the same
  rules as above, and starts the run. The file is named
  `execution-plan-<run id>.md`.
- **Modern.** The Orchestrator registers the plan with one
  `execution.plan.register` call. No file is written.

For this to work the Orchestrator must be allowed to do that. On CLI Agent, its
Persona must be able to write files. A Persona is treated as unable to if it
denies `Write` or `Edit`, or if its permission mode or **Execution state** is
plan, or its Codex sandbox is read-only. On Modern, it must not deny the
plan-register tool.

If it cannot, Zana refuses the launch with `ORCHESTRATOR_CANNOT_PLAN`:
"<name> can't author and register a plan on this Squad's transport, so Infer
plan from goal can't finish. Provide the plan in the goal instead." An agent
proposing a Squad gets `ORCHESTRATOR_CANNOT_PLAN` too, and it defaults to **Plan provided in
goal** when its Orchestrator cannot plan. The fix is to use **Plan provided in
goal**, or to give the Orchestrator a Persona that can write.

### If the plan does not arrive

On CLI Agent, if the plan file is missing or invalid, Zana sends the
Orchestrator a short reminder. It names the full (absolute) path to write to,
for example "no plan file found at `<path>`". The path is absolute because the
Orchestrator can be working in a different folder from the one Zana reads. The
first instruction at the start of the run also names this absolute path.
Reminders are limited in number. If the plan still does not arrive, the run
fails instead of waiting forever.

The plan file is kept across retries. If a run has no registered plan and can
still be relaunched or resumed, Zana leaves the plan the Orchestrator wrote in
place when the Orchestrator exits. The next attempt reads the same file. If a
resumed Orchestrator remembers writing a plan but none was registered, it is
told that no plan was registered and to follow the kickoff again.

Recovery buttons are in Squad details. See [Watching a Squad](/docs/squads-watch/).

---

## Project Squads

A Squad can live inside a Project, so it travels with the Project's files.

Put a JSON file in the Project at `.zcc/teams/<id>.json`. Name the file after the Squad's
`id`. Zana reads every `.json` file in the folder and uses the `id` inside it.
It watches the folder, so new files appear on the Squads page with the
**Project** source.

```json
{
  "id": "feature-squad",
  "name": "Feature Squad",
  "orchestratorPersonaId": "builtin:orchestrator",
  "slots": [
    { "personaId": "builtin:software-engineer", "quantity": 2, "label": "Engineer" },
    { "personaId": "builtin:reviewer", "quantity": 1, "label": "Reviewer" }
  ],
  "defaultProjectId": "real-project-id",
  "initialPrompt": "Break goal into tasks and integrate results."
}
```

- `id`, `name`, and a list of `slots` are required. Each slot needs a
  `personaId`. `quantity` is clamped to 1 to 16.
- The other editor options are saved as `transport` (`CLI` or `MODERN`),
  `worktreeIsolation` and `routingEnforced` (`true` or `false`), `worktreeOnComplete` (`"leave"`, `"merge"` or `"delete"`), `retainOrchestrator`,
  `defaultPlanning` (`infer` or `provided`), `launchApproval` (`direct` or
  `review`), and `isDefault`.
- A file that is not valid JSON, or is missing a required field, is skipped
  without a message.
- Whether a Persona exists is checked when you launch, not when the file is
  saved.
- When ids match, a Project file wins over a user Squad, and a user Squad wins
  over a built-in. A Project file with the same `id` as a built-in (such as
  `builtin:research-squad`) replaces it.
- A Project file cannot lift a **Review before launch** set on a user Squad of
  the same id. Review always wins.

You cannot edit a Project Squad in the app. Open it and use **Duplicate to
user** for a personal copy, or edit the file.

---

## Worktrees and cleanup

A worktree is a separate checkout of your Project on its own branch. A Squad
run that uses one works there instead of in your working folder. Turn it on
with **Worktree isolation** (see above). Squad worktrees are created inside
the Project, under `.worktrees/`, each on its own branch whose name starts with
`zcc/`. Squad details shows the path and branch under **Retained worktree**
when a run keeps one.

Worktrees need a local Git Project. If the Project is remote, a quick-agent
Project, or not a Git repository, the run works in the Project folder
instead. The Inbox shows **Squad ran in the project folder**: "Worktrees need a
local Git project, so this squad worked in the project folder. Its changes are
in your working copy." If Zana tries to create the worktree and fails, the Inbox
shows **Squad worktree unavailable** and the run uses the Project folder.

What happens to the worktree when a run completes is set per Squad under **When
a run finishes** (see above):

- **Keep worktree** leaves everything in place: commits, uncommitted changes and
  untracked files. This is the default.
- **Merge everything into base branch, then remove** works only on a completed
  run. Zana commits any uncommitted and untracked changes in the worktree, merges
  the branch into the base branch, removes the worktree, and deletes the merged
  branch. Your base checkout must be clean and on the recorded base branch.
  New files Zana itself writes under `.zcc/` (its own activity records) do not count as changes. `.zana/` holds Zana plan handoff files and is never committed. If the
  checkout is not clean, or the merge conflicts or fails, Zana keeps the
  worktree and deletes nothing. The automatic commit may stay on the Squad's branch.
  If the merge succeeds but Zana then cannot remove the worktree or delete the
  branch, your changes are already in the base branch and the leftover
  worktree or branch stays in place. Zana's
  own `.zana/` plan files are never committed. Everything else in the worktree
  is committed, including local notes, so choose **Keep worktree** if it may
  hold files you do not want in your Project's history. If a commit hook rejects the automatic commit, Zana keeps the worktree.
- **Delete worktree and branch** is destructive and works only on a completed
  run. Zana removes the
  worktree and deletes its branch even if they hold uncommitted changes,
  untracked files or commits that were never merged. This cannot be undone. Use
  it only for Squads whose results you read from Squad details and do not need
  as files.

Failed and stopped runs keep their worktree whatever you choose. Zana does not
delete the base branch or your Project's current branch.

When Zana keeps a worktree, the Inbox shows **Squad
worktree retained**: "Execution <state>. The shared worktree remains at
`<path>`. Open Squad details to inspect recovery options and manage the
retained worktree."

In Squad details, a **Retained worktree** section shows the path and branch. It
has four buttons:

- **Instruct an agent** starts a follow-up agent in the worktree. Write the
  instruction in the box first. You can pick a **Follow-up persona** from the
  Squad's roster. The default is "Squad coordinator (default)".
- **Leave worktree** keeps the checkout and ends the pending choice. The section
  then says "Worktree left by user. No further lifecycle action is pending."
- **Delete worktree** removes it, after a confirmation that says it cannot be
  undone. Zana refuses to delete a worktree with uncommitted changes. If it has
  commits that are not merged, you are told to use the next button.
- **Force delete unmerged work** removes the worktree even if it has unmerged
  commits or uncommitted changes. Both are lost, and this cannot be undone. The
  confirmation dialog says so. Do not choose this unless you are sure nothing
  in the worktree is needed.

Zana does not delete a worktree you created yourself and pointed the run at.

Nothing is removed unless a completed run's **When a run finishes** setting is
Merge or Delete, or you click a delete button. If you are not sure, keep
**Keep worktree** (the default) and choose **Leave worktree**.
