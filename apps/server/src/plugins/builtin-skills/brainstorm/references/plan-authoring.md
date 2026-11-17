# Authoring a Squad plan

Use this when the user wants a Squad to build something and there is no plan yet,
or the plan was written somewhere other than a file on disk. Goal: a portable plan
that `squad_plan_check` accepts, then a review-mode launch. The user presses Launch.

## Questions (at most three)

Ask only what you cannot read from the conversation:

1. Goal: what must be true when the work is done?
2. Scope: which Project paths may change, and what is off limits?
3. Squad: which one runs it? Skip when the user already named one.

Do not ask about formatting, step ids or roles. Decide those yourself.

## Flow A: the plan is in a Design Docs doc

Applies only when the Design Docs tools exist in this session. Never assume they do.
If `design_doc_read` is unavailable, use flow B.

1. Read the doc with `design_doc_read` (research, issue or proposal; the plan is its
   `plan.md`). A Design Docs doc has no path on disk.
2. Pass the plan text as an attachment: `attachments: [{ name: 'plan.md', text }]`.
   Do not pass a guessed path, and do not copy the doc to disk. A `doc://` or other
   `scheme://` source is refused, so never pass one.
3. If the plan has no executable steps, write them in the format below, keeping the
   doc's requirements, and say you did so.

## Flow B: the plan is drafted in conversation

1. Draft the plan in the format below from the goal and scope.
2. Pass it to `squad_launch` as an attachment: `attachments: [{ name: 'plan.md', text }]`.
   Nothing is saved. Offer to save it (library-curator, or a Design Docs doc when
   available) only if the user wants to keep it.

## Check, then launch

1. `list_teams`: read each Squad's `slots` (`label`, `personaId`, `level`, `roles`) and
   `canInferPlan`. This is the only source of role names. Do not invent roles.
2. `squad_plan_check` with the plan (`{ text }` or `{ path }`), without `teamId`. Fix
   every error until it passes.
3. `squad_plan_check` again with `teamId`. Findings name steps no slot can take
   (a `Required role` the Squad lacks, a class above every slot). Fix the plan or
   pick another Squad; tell the user about advisory warnings.
4. `squad_launch` with `mode: 'review'`, `teamId`, a short `goal`, `planning: 'provided'`,
   and the plan as `sources` (a path) or `attachments` (text).
5. Tell the user to open the "Squad launch ready" Inbox card in their Project. Use
   `mode: 'now'` only when they explicitly asked to start immediately.

## Plan format

Put the plan in a fenced block tagged `squad-plan` when it sits inside a larger
document; the parser then takes the block verbatim. Otherwise the whole text is the plan.

```squad-plan
## Execution Plan

### find-callers: Find callers <!-- executable-step -->

- **Depends on:** None
- **Execution class:** Routine
- **Mode:** Read-only
- **Read scope:** `src/**`
- **Write scope:** None
- **Excludes:** None
- **Work:**
  **Purpose / why:** Know what the change touches before editing.

  List every caller of `parseFoo` and record file and line.
- **Verification:** The list matches a repo-wide search.
- **On failure:** fail run
- **Outputs / handoff:** The caller list.

### change-parser: Change the parser <!-- executable-step -->

- **Depends on:** find-callers
- **Execution class:** Standard
- **Prefer role:** Engineer
- **Mode:** Mutating
- **Read scope:** `src/**`
- **Write scope:** `src/parser/**`
- **Excludes:** None
- **Work:**
  **Purpose / why:** Implement the requested behavior.

  Change `parseFoo` and update the callers.
- **Verification:** `pnpm test src/parser` passes.
- **On failure:** fail run
- **Outputs / handoff:** The diff.

### review-parser: Review the change <!-- executable-step -->

- **Depends on:** change-parser
- **Execution class:** Standard
- **Required role:** Reviewer
- **Not same worker as:** change-parser
- **Mode:** Read-only
- **Read scope:** `src/**`
- **Write scope:** None
- **Excludes:** None
- **Work:**
  **Purpose / why:** A different worker checks the change.

  Review the diff against the goal.
- **Verification:** No unresolved finding.
- **On failure:** fail run
- **Outputs / handoff:** Review findings.

## Launch

- Squad: delivery
```

### Rules the parser enforces

- Each step is an H3 `id: Title <!-- executable-step -->`; `id` is lowercase kebab-case.
- Labels, in this order: Depends on, Execution class, then optional routing labels
  (Required role, Prefer role, Not same worker as), Mode, Read scope, Write scope,
  Excludes, Work, Verification, On failure, Outputs / handoff. Optional Requires and
  Loop may follow Outputs / handoff. Each required label occurs once; `None` marks an
  empty list.
- Execution class is `Routine`, `Standard` or `Expert`. It is a floor for the worker,
  not a role.
- Read-only steps have `Write scope: None`. Work starts with `**Purpose / why:**`.
- `Required role: a, b` is hard: the worker must hold every listed role. Name only roles
  the chosen Squad defines (from `list_teams`). A role no slot holds can never run, so
  `squad_plan_check` with `teamId` reports it.
- `Prefer role: a, b` is soft: matching workers are tried first, others still qualify.
- `Not same worker as: step-id` is hard and may name only steps this step depends on,
  directly or indirectly.
- `Requires: Skills: a, b; MCP servers: c` lists what the worker must have, or `None`.
- `Loop: step-id until PASS, max N` repeats a step until it passes.
- `## Launch` with `- Squad: <id>` only when the user named a Squad; omit the section
  otherwise. `squad_plan_check` uses it when no `teamId` is given. An explicit
  `teamId` on `squad_launch` wins.
- Steps may declare no routing at all. Prefer that unless a step truly needs a role:
  the Squad's slots and Execution class already choose a worker.
- Formatting slips (a bare tier name as class, a non-kebab id, a missing marker) are
  repaired with a warning. Unsafe or ambiguous routing (a misspelled `Required role`
  label, an unknown step in `Not same worker as`) is rejected: fix it, do not retry
  the same text.

Call the folder a Project when talking to the user.
