# Squad plans

A plan is the list of steps a Squad runs. This page shows how to write one, what each field does, how Zana picks a worker for each step, and what to do when Zana rejects a plan.

New to Squads? Start with [Start using Squads](/docs/squads-start/). For the ways to launch a plan, see [Ways to start a Squad](/docs/squads-launch/). For Squads you build yourself, see [Personas and custom Squads](/docs/squads-customize/).

## What a plan is, and when you do not need one

A plan is Markdown. Each step has an id, a title, the work to do, and how to verify it. Zana reads the plan before the run starts, checks it against the Squad, and hands each step to a worker.

You do not need to write one by hand in most cases:

- **Infer plan from goal.** The Orchestrator writes the plan from your goal. Use this when the goal is short and you do not mind the Orchestrator choosing the steps.
- **Plan provided in goal.** You supply the plan. Use this when you want fixed steps, a fixed order, or specific roles on specific steps.
- A one-step job needs no plan at all. Give the Squad a clear goal.

## The 60-second path

Let an agent write the plan for you with the brainstorm skill.

1. In any agent conversation, describe what you want built. Say which Squad should run it, or leave that out.
2. Ask: "Write a plan for this and prepare a Squad launch." The agent asks at most three questions (goal, scope, Squad), reads the Squad with `list_teams`, and checks the plan with `squad_plan_check`.
3. Open the **Squad launch ready** card in the Inbox. Read the plan. Anything marked **Must fix** blocks the launch. If your plan has a Must fix, the agent asks you first which fix to use (change the role, remove the requirement, or prepare it as it is) before it prepares the card. **Check** is advice. **Fixed for you** is a formatting repair Zana already made.
4. Press **Launch**.

Nothing starts until you press Launch. If you want the run to start at once, say "run it now with <Squad>".

## A worked example

This plan runs on the Delivery Squad. Two engineers work in parallel. A reviewer checks both results, and must not be the worker that did either piece of work.

```markdown
# Add the export button

## Launch

- Squad: builtin:delivery-squad

## Execution Plan

### export-api: Add the export endpoint <!-- executable-step -->

- **Depends on:** None
- **Execution class:** Standard
- **Required role:** engineer
- **Mode:** Mutating
- **Write scope:** `src/api/export.ts`, `src/api/export.test.ts`
- **Work:** Add GET /export that streams the current Project report as CSV. Add tests for an empty report and a large report.
- **Verification:** The new tests pass and the endpoint returns a CSV header row.

### export-ui: Add the button <!-- executable-step -->

- **Depends on:** None
- **Execution class:** Standard
- **Required role:** engineer
- **Mode:** Mutating
- **Write scope:** `src/ui/ExportButton.tsx`, `src/ui/ExportButton.test.tsx`
- **Work:** Add an Export button to the report toolbar that downloads the file from GET /export.
- **Verification:** The component test passes.

### review: Review both changes <!-- executable-step -->

- **Depends on:** `export-api`, `export-ui`
- **Execution class:** Expert
- **Required role:** reviewer
- **Prefer role:** reviewer
- **Not same worker as:** `export-api`, `export-ui`
- **Mode:** Read-only
- **Write scope:** None
- **Work:** Review both diffs for correctness, missing tests and security. Return findings with file and line.
- **Verification:** Every finding cites a file and line.
```

What Zana does with it: `export-api` and `export-ui` start together on the two Engineer workers. `review` waits for both, then runs on the Reviewer. `Required role: reviewer` means no other worker can run it. `Not same worker as` makes sure it is not the worker that wrote either change.

## Field reference

Each step is a level-3 heading that ends with `<!-- executable-step -->`. The heading text is `id: Title`. The id is a short lowercase name such as `export-api`. Under it, each field is a bullet with a bold label.

| Field | Required | What it does |
| --- | --- | --- |
| **Depends on** | Yes | Ids of the steps that must finish first, separated by commas, or `None`. Every id must exist. No circles. |
| **Execution class** | No | The lowest worker level that may run the step: `Routine` (low), `Standard` (medium) or `Expert` (high). A higher-level worker may still run it. Anything else is refused. |
| **Required role** | No | Hard requirement. Only a worker that answers to every name listed may run the step. Separate names with commas; all must match. |
| **Prefer role** | No | Soft preference. Among workers that qualify, the one matching the most names goes first. Never blocks a step. |
| **Not same worker as** | No | Hard rule. The step must not run on any worker that ran one of the listed steps. List only steps this step depends on, directly or through other steps. |
| **Mode** | No | `Read-only` or mutating. A mutating step needs a **Write scope**. |
| **Read scope**, **Write scope**, **Excludes** | Write scope for mutating steps | Paths inside the Project, separated by commas. Absolute paths and `..` are refused. |
| **Work** | Yes | What the worker does. May span lines and hold closed code blocks. Up to 16,384 characters. |
| **Verification** | Yes | Instruction to the worker for proving the work is done. Zana does not run it. |
| **Completion criteria** | No | Only comma-separated `check:<name>` references to a named check. |
| **Requires** | No | `Skills: a, b; MCP servers: c`, or `None`. Zana checks that they exist and that a worker may use them. |
| **On failure** | No | `fail run` (the default) or `retry <step> up to N with feedback`. |
| **Outputs / handoff**, **Loop** | No | Structured output a later step receives, and review loops. See [Personas and custom Squads](/docs/squads-customize/). |

The plan can also carry a launch section:

```markdown
## Launch

- Squad: builtin:delivery-squad
```

`Squad: <id>` says which Squad the plan was written for. It is advice, and takes the Squad id from the cheat sheet or its name. If you launch the plan on a different Squad, Zana warns you and still uses the Squad you picked.

### What a name matches

`Required role` and `Prefer role` names are matched without regard to case against three things on each worker: its **label** (for example `Reviewer`), its **role tags** (for example `reviewer`), and its **Persona id**. The cheat sheet below lists the names each built-in worker answers to. There is no fuzzy matching: `Review` does not match `Reviewer`.

A plan is limited to 100 steps, and the goal field to 2,048 characters. Put a long plan in an attached source instead of the goal.

## How workers are chosen

This section describes the built-in Squads. A Squad you made or changed has its own workers and role tags: read it with `list_teams` or in the Squad editor. The editor does not have a role field this release. Add roles in the Squad definition, or ask an agent to use `register_teams`.

For every step Zana does this, in order:

1. **Keep only workers that qualify.** A worker qualifies if it has the level the step's **Execution class** asks for, answers to every **Required role** name, allows the Skills and MCP servers the step **Requires**, and is not excluded by **Not same worker as**.
2. **Rank the rest.** The worker that matches the most **Prefer role** names goes first. Next, the lowest price. Next, a worker that has already started goes before one that has not. Next, not the worker that just finished. Last, the order of the Squad's roster.
3. **Give the step to the first worker.** If no worker qualifies, the step is not handed to some other worker. A hard rule (**Required role**, **Not same worker as**, a Skill or MCP server) is never relaxed, in every Squad.

Zana shows the chosen worker and the reason in Squad details.

Steps with no routing fields are the common case. The Squad's workers and the **Execution class** already choose a worker, so leave the routing fields out unless a step truly needs a particular role.

## Cheat sheet for the built-in Squads

This table covers the built-in Squads only. It never lists Squads you or a Project added. For those, call `list_teams` or open the Squad in the editor. It is generated by `pnpm squad-cheat-sheet`; do not edit it by hand.

<!-- squad-cheat-sheet:start (generated by scripts/generate-squad-cheat-sheet.ts; do not edit by hand) -->

### Debug Squad

Squad id: `builtin:debug-squad`. Coordinator (medium), a low-capacity evidence collector, and a high-capacity root-cause investigator.

| Worker | Level | Runs steps up to Execution class | Names `Required role` accepts |
| --- | --- | --- | --- |
| Evidence collector | low | Routine | `Evidence collector`, `evidence-collector`, `builtin:squad-worker-low` |
| Root-cause investigator | high | Expert | `Root-cause investigator`, `root-cause-investigator`, `builtin:squad-worker-high` |

### Delivery Squad

Squad id: `builtin:delivery-squad`. Coordinator (medium), two medium-capacity engineers, and a high-capacity reviewer for bounded delivery.

| Worker | Level | Runs steps up to Execution class | Names `Required role` accepts |
| --- | --- | --- | --- |
| Engineer | medium | Standard | `Engineer`, `engineer`, `builtin:squad-worker-medium` |
| Reviewer | high | Expert | `Reviewer`, `reviewer`, `builtin:squad-worker-high` |

### Design Squad

Squad id: `builtin:design-squad`. Coordinator (medium), a high-capacity designer, and a high-capacity challenger for technical design.

| Worker | Level | Runs steps up to Execution class | Names `Required role` accepts |
| --- | --- | --- | --- |
| Designer | high | Expert | `Designer`, `designer`, `builtin:squad-worker-high` |
| Challenger | high | Expert | `Challenger`, `challenger`, `builtin:squad-worker-high` |

### Research Squad

Squad id: `builtin:research-squad`. Coordinator (medium) and two low-capacity investigators for code, requirements, and prior-art research.

| Worker | Level | Runs steps up to Execution class | Names `Required role` accepts |
| --- | --- | --- | --- |
| Investigator | low | Routine | `Investigator`, `researcher`, `builtin:squad-worker-low` |

### Review Squad

Squad id: `builtin:review-squad`. On-demand review support: delegate a focused code review when an implementation needs an independent pass.

| Worker | Level | Runs steps up to Execution class | Names `Required role` accepts |
| --- | --- | --- | --- |
| builtin:software-engineer | medium | Standard | `engineer`, `builtin:software-engineer` |
| builtin:reviewer | high | Expert | `reviewer`, `builtin:reviewer` |

<!-- squad-cheat-sheet:end -->

## Common mistakes

Zana shows each problem in the **Squad launch ready** card, the composer's **Review plan** section and the **Plan correction required** card. Each problem carries one of three labels: **Must fix** (launch is blocked), **Check** (launch is still allowed) or **Fixed for you** (Zana already corrected it). The messages below are what you see. Step ids and names in your plan replace the examples. A step that is named in a message starts with "Step" and its id.

### The role does not exist in this Squad (Must fix)

A **Required role** that no worker answers to is a **Must fix** in every Squad. The launch will not start.

- Message: `Step review asks for a role this Squad does not have. This Squad offers Engineer and Reviewer. Use "Reviewer" as the required role. Ask the agent to revise the plan, or edit the plan and launch again.`
- The "Use ... as the required role" line appears only when exactly one worker is close. Otherwise it reads `Change the required role to one this Squad offers: Engineer, engineer, Reviewer, reviewer.` Pick a name from the cheat sheet. If the Squad has no worker for the job, pick another Squad.
- Next: ask the agent that wrote the plan to revise it, or edit the plan and launch again.

### A role you only prefer is missing (Check)

- Message: `Step review prefers a role no member of this Squad has, so it will run on whichever member fits best. This Squad offers Engineer and Reviewer. Launch is still allowed.`
- Next: launch as is, or change **Prefer role** to a name the Squad offers.

### A misspelled label

A near-miss of a label that affects safety is a **Must fix**, not a guess. A near-miss of a harmless label is corrected and shown as **Fixed for you**.

- Must fix message: `Step review: has unrecognised label "Requierd role" (did you mean "Required role"?). Ask the agent to revise the plan, or edit it and launch again.`
- Fixed for you message: `Step review: <what changed>. Zana fixed this for you.`
- Next: for a Must fix, correct the spelling and launch again.

### Not same worker as names the wrong step (Must fix)

- Message: `Step review: Not same worker as "export-ui" is not a step it depends on (directly or through other steps); list only earlier steps in its Depends on chain. Ask the agent to revise the plan, or edit it and launch again.`
- If the step does not exist, the message says `names a step that does not exist` instead.
- Next: add the step to **Depends on**, or remove it from **Not same worker as**.

### Not same worker as cannot be met (Must fix)

- Message: `Step review must run on a different member than the steps it names, but this Squad has no other member that fits. Members that fit: Reviewer. Add another member that can run this step, or drop the "not the same worker as export-api" line. Add a member to the Squad, or ask the agent to revise the plan.`
- Next: add a member to the Squad, or remove the **Not same worker as** line. A Squad with one worker can never satisfy it.

### Execution class is not a tier

- Message: `Step review: could not pin minimumLevel for execution class "Senior" (expected Routine, Standard, or Expert). Ask the agent to revise the plan, or edit it and launch again.`
- Next: use `Routine`, `Standard` or `Expert`. A bare tier such as `high` is read as `Expert` and shown as **Fixed for you**.

### No worker is high enough (Check)

- Message: `Step review: needs at least high but the highest worker slot is medium. Launch is still allowed. You can launch as is, or ask the agent to revise the plan.`
- Next: lower the **Execution class**, or pick a Squad that has a high-level worker, such as the Design Squad or the Delivery Squad.

### A Skill or MCP server no worker may use (Must fix)

- Message for a skill: `Step lint needs a skill that no member of this Squad is allowed to use. Needed: lint-fix. Change the member's skills, or ask the agent to revise the plan.`
- Message for an MCP server: `Step lint needs a tool server that no member of this Squad is allowed to use. Needed: browser. Change the member's tools, or ask the agent to revise the plan.`
- Next: remove it from **Requires**, or allow it for a worker in the Squad. A Persona that uses **Restrict MCP servers** can hide a server; see [Personas and custom Squads](/docs/squads-customize/#restrict-mcp-servers).

### The plan was written for another Squad (Check)

- Message: `This plan was written for builtin:delivery-squad, but you are launching it on Research Squad. Role checks use the Squad you are launching.`
- Next: launch it on the Squad named in `## Launch`, or change the `Squad:` line. This is a **Check**, not a **Must fix**.

### A step is missing a field (Must fix)

- `Step export-api: missing Work.`
- `The plan: no executable steps found.`
- `Step export-api: has unrecognised label ...`
- Each message ends with `Ask the agent to revise the plan, or edit it and launch again.`
- Next: every step needs the `id: Title` heading, a **Work** field and a **Verification** field. A mutating step also needs a **Write scope**.

### The plan is too long for the goal

- Message: `The goal is too long for a Squad (N of 2,048 characters). Move details into an attached plan or source.`
- Fix: attach the plan as a source.

## When Zana cannot fix a plan

Some small mistakes have one obvious fix, so Zana repairs them and lists them as **Fixed for you**: a step id that is not lowercase with hyphens (`U1` becomes `u1`), a near-miss spelling of a harmless label, a trailing full stop on a value, and a plan whose steps lack the `<!-- executable-step -->` marker but sit under `## Execution Plan`.

If Zana cannot fix a plan without guessing what you meant, the run waits before any work starts. The Inbox shows **Plan correction required** with "Problem with the supplied plan: <reason>" and a proposed corrected plan. You can choose **Use the corrected plan** (when a corrected plan exists), **Ask the agent to revise**, or **Cancel the run**. Cancel the run ends that run. Start a new Squad to try again.
