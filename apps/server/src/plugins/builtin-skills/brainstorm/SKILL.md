---
name: brainstorm
description: Run a brainstorming / ideation session with the user and capture the idea into the Zana Command Center library so it's kept for later. Use when the user wants to brainstorm, think through an idea, jot something down to revisit, develop a half-formed thought, or asks to recall / build on a previous idea — e.g. "let's brainstorm X", "I have an idea, help me flesh it out", "save this idea", "what ideas did I have about Y".
---

# brainstorm — ideate, then keep it for later

Zana Command Center (the desktop app this session is likely running
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

## Don't

- Don't write `index.json` or a parallel library manifest — library-curator owns that.
- Don't bury a quick idea under a long ceremony — capture fast, develop only if asked.

