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
2. **Persist the result into the library** as a markdown note, in the exact
   format the app expects, so it shows up in the Library UI (tagged `idea`).

You are **writing plain files** with the normal file tools (Write, Read, Bash).
This is NOT an API and NOT an MCP tool.

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

The library is dual-scope. Ideas default to **global** (personal, cross-project,
survive project deletion):

```
~/.zcc/library/              ← global scope (default for ideas)
<project-root>/.zcc/library/ ← project scope (git-trackable, use when the idea is about this repo)
```

Each library dir contains:
- the actual files (e.g. `ideas/2026-06-12-1430.md`), and
- one **`index.json`** manifest — rolled-up metadata the Library UI reads.

The app **watches** these dirs, so a note you write + a manifest entry you append
appear in the Library UI without an app restart.

> The in-app "New idea" button writes here too. You're using the same store —
> just from the agent side.

---

## Capturing an idea (write file + append manifest)

Two steps. Both matter: the **file** holds the content; the **manifest entry**
makes the Library UI show it with a title and tags.

### 1. Write the markdown note

Pick a dated, collision-proof relative path under `ideas/`. The first heading
becomes the note's title (the app derives it on save, and you should set the
manifest `title` to match).

```bash
mkdir -p ~/.zcc/library/ideas
```

Then Write the file, e.g. `~/.zcc/library/ideas/2026-06-12-1430.md`:

```markdown
# Short, specific idea title

One-paragraph summary of the idea.

## Angles
- …

## Open questions / risks
- …

## Next step
- …
```

### 2. Append a manifest entry to `index.json`

`~/.zcc/library/index.json` is `{ "version": 1, "docs": [ … ] }`. Append
one entry to `docs`. **Read–modify–write the whole file** (don't blind-append) so
you preserve existing entries and valid JSON. If the file doesn't exist, create
it with `{ "version": 1, "docs": [] }` first.

A minimal valid entry — only these fields are required; the rest are optional:

```jsonc
{
  "id": "<uuid>",                 // REQUIRED, unique. `uuidgen` or any uuid.
  "relPath": "ideas/2026-06-12-1430.md", // REQUIRED, posix, relative to THIS library dir
  "title": "Short, specific idea title", // REQUIRED, match the note's first heading
  "kind": "md",                   // REQUIRED for an idea note
  "createdAt": 1749648000000,     // REQUIRED, epoch MILLISECONDS (date +%s%3N, or *1000)
  "updatedAt": 1749648000000,     // REQUIRED, epoch milliseconds
  "summary": "One line for the list view.", // optional but recommended
  "tags": ["idea"],               // optional — ALWAYS include "idea" so it filters with the rest
  "source": { "kind": "user" }    // optional — use "user" for a hand-developed idea
}
```

Safe append with `jq` (creates the file if missing, preserves existing docs):

```bash
DIR=~/.zcc/library
mkdir -p "$DIR"
[ -f "$DIR/index.json" ] || echo '{"version":1,"docs":[]}' > "$DIR/index.json"
NOW=$(($(date +%s) * 1000))
jq --arg id "$(uuidgen)" \
   --arg rel "ideas/2026-06-12-1430.md" \
   --arg title "Short, specific idea title" \
   --arg summary "One line for the list view." \
   --argjson now "$NOW" \
   '.docs += [{
      id:$id, relPath:$rel, title:$title, kind:"md",
      createdAt:$now, updatedAt:$now, summary:$summary,
      tags:["idea"], source:{kind:"user"}
   }]' "$DIR/index.json" > "$DIR/index.json.tmp" && mv "$DIR/index.json.tmp" "$DIR/index.json"
```

Notes & guardrails:
- **`relPath` must stay inside the library dir** — no leading `/`, no `..`. The
  app rejects path-traversal, and so should you.
- **Timestamps are epoch milliseconds**, not seconds. `date +%s` gives seconds —
  multiply by 1000.
- For a **project-scoped** idea, use `<project-root>/.zcc/library/` instead,
  resolving the project path from `~/.zcc/projects.json` (see Recall below).
- Tell the user where you saved it ("saved to your library, tagged `idea`").

---

## Recall — find earlier ideas

Ideas are just markdown files plus manifest entries, so search both.

List idea notes newest-first by title:

```bash
jq -r '.docs[] | select(.tags[]? == "idea") | "\(.updatedAt)\t\(.title)\t\(.relPath)"' \
  ~/.zcc/library/index.json | sort -rn
```

Full-text search across idea note bodies:

```bash
grep -il "the topic" ~/.zcc/library/ideas/*.md
```

Read a specific note with the normal Read tool, then continue the session to
build on it — and when done, **update** its manifest `updatedAt` (and `title`
if it changed) rather than creating a duplicate.

### Resolve a project name → its library

`~/.zcc/projects.json` is an array of `{ id, name, path, … }`:

```bash
jq -r '.[] | select(.name=="my-project") | .path' ~/.zcc/projects.json
# → then look in <that path>/.zcc/library/
```

---

## Don't

- Don't silently overwrite `index.json` — read-modify-write to keep other docs.
- Don't write timestamps in seconds (the UI expects milliseconds).
- Don't bury a quick idea under a long ceremony — capture fast, develop only if asked.
