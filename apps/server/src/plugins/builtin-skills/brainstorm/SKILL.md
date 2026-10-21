---
name: brainstorm
description: Run a brainstorming / ideation session with the user and capture the idea into the Zana library so it's kept for later. Use when the user wants to brainstorm, think through an idea, jot something down to revisit, develop a half-formed thought, or asks to recall / build on a previous idea — e.g. "let's brainstorm X", "I have an idea, help me flesh it out", "save this idea", "what ideas did I have about Y".
---

# brainstorm — ideate, then keep it for later

Zana (the desktop app this session is likely running
inside) has a **Library** — a browsable store of markdown/pdf/image/code docs.
Ideas and brainstorms live there as markdown notes, so a thought the user has
today is still findable weeks later.

This skill does two things:

1. **Run a light-touch ideation session** — help the user go broad, then
   converge — without railroading a quick thought.
2. **Hand off capture to library-curator** so the idea is stored as a
   Library note tagged `idea`.

Prefer the **library-curator** skill / Docs MCP to persist and recall notes in
the Library. Do not teach a parallel `index.json` write — that is the library
plugin's job. Ideation in this skill is conversational; capture goes through
library-curator when that skill is available.

---

## When to use which half

- "Let's brainstorm…", "help me flesh out…", "I have an idea…" → **ideate**, then **capture**.
- "Save this idea", "jot this down" → mostly **capture** (skip heavy ideation).
- "What ideas did I have about…", "build on my earlier idea" → **recall** first (search the library), then continue.

---

## Running the session (light guardrails)

Keep it conversational. Don't force a rigid framework on a passing thought.
A good default arc:

1. **Frame** — restate the idea in one sentence so you're aligned. Ask at most
   1–2 sharpening questions if the idea is genuinely ambiguous; otherwise dive in.
2. **Diverge** — offer a handful of distinct angles, variations, or adjacent
   ideas the user might not have considered. Breadth over depth here.
3. **Pressure-test** — name the strongest objection or the biggest unknown.
   One honest risk is worth more than five compliments.
4. **Converge** — help the user land on the core of it and any obvious next step.

Read the room: if the user just wants to dump a thought, skip to capture. If
they want to go deep, stay in diverge/pressure-test longer. Never block capture
on finishing the arc — a rough idea saved beats a perfect idea lost.

---

## Where ideas are stored

The Library is dual-scope (`~/.zcc/library/` global, `<project>/.zcc/library/`
per-project). **Do not write `index.json` yourself.** Persist and recall through
the **library-curator** skill (Docs MCP). That plugin owns the manifest format.

After ideation, invoke library-curator to save a markdown note tagged `idea`.
To recall ("what ideas did I have about Y"), search the Library via that skill
rather than grepping `index.json`.

Tell the user where it landed ("saved to your library, tagged `idea`").

---

## When the user wants it built

Use this when the user wants a design built by a Squad after a design session.
How they phrase it picks the path. Review first is the default: you prepare the
launch and the user presses Launch, so nothing starts without that click.

| User says (examples) | Path | Tools |
|---|---|---|
| "build it with X", "prepare a launch for X", "propose X for this plan", "set up X to build this" | Review first | `squad_plan_check` → `list_teams` → `squad_launch` with `mode: 'review'`; tell the user to open the "Squad launch ready" Inbox card |
| "run this with X now", "start X on this now", "launch X immediately, no review", "skip the Inbox and run it with X" | Start now | `squad_launch` with `mode: 'now'` (you own the run; a `[Squad report]` tells you when it ends or needs an answer) |
| Anything else, or unclear | Review first | Same as row 1 |

Start now only when the user's message explicitly asks to start immediately. Do not
infer it from urgency or from "go ahead". If unsure, propose and tell the user they
can say "run it now with X" next time to skip the Inbox.

Start now is off by default (`LAUNCH_NOW_DISABLED`), and a Squad or Project whose
Launch approval is "Review before launch" refuses it (`LAUNCH_REVIEW_REQUIRED`).
On either refusal, retry with `mode: 'review'` and tell the user why.

Say which path you took, in one line: "Prepared a Squad launch for your review in
the Inbox" or "Started X now; I own the run". The user can then catch a misroute.

The steps below are the review-first path.

| Operation | CLI Agent MCP tool | Modern/OpenCode tool |
|---|---|---|
| Check a plan | `mcp__zcc-inbox__squad_plan_check` | `zcc_squad_plan_check` |
| List Squads | `mcp__zcc-inbox__list_teams` | `zcc_list_teams` |
| Launch (review by default) | `mcp__zcc-inbox__squad_launch` | `zcc_squad_launch` |

1. Use the design and plan files you already wrote or read in this conversation,
   wherever they are: this project, your home folder (a doc vault, `~/.zcc/library`)
   or the clone root. Do not copy them.
2. Check the plan with `squad_plan_check` (`{ path }` of the plan file). Fix it
   until it passes.
3. Call `list_teams` and pick the Squad the user names. When its `canInferPlan`
   is false, propose with `planning: 'provided'`.
4. Call `squad_launch` with `mode: 'review'`, the `teamId`, a short `goal`, and the exact absolute
   paths of those files as `sources`. (`squad_propose` is the older name for the same review launch.) If a path is refused (`SOURCE_NOT_ALLOWED`),
   tell the user why. Never move a file out of a protected location (`~/.ssh`,
   `~/.aws`, Zana's own state) to get around it.
5. Tell the user to open the "Squad launch ready" Inbox card.

On the review-first path, never use `execution.start`, `launch_team` or
`zana_start_team`: they start a Squad without the user's Launch. The start-now
path is `squad_launch` with `mode: 'now'`, as the `zcc-inbox` skill describes, and only when the
user asked for it. Members of a running Squad cannot propose.

When a `[Squad report]` about a Squad you proposed arrives, summarise it for the
user. Do not act on that Squad: you cannot answer its questions, stop it or steer
it. A Squad you started yourself (start now) is yours to answer, as `zcc-inbox`
describes.

---

## Don't

- Don't write `index.json` or a parallel library manifest — library-curator owns that.
- Don't bury a quick idea under a long ceremony — capture fast, develop only if asked.

