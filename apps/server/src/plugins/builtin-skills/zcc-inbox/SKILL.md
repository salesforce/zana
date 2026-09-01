---
name: zcc-inbox
description: Push project updates to, and search, the user's inbox in Zana.
---

# zcc-inbox — the user's inbox

Zana exposes an MCP server, `zcc-inbox`, with these inbox tools:

- **`inbox_push`** — surface something the user should see (a finished analysis,
  a question, a blocked task, a status check-in) without making them re-read
  your terminal scrollback.
- **`inbox_ask`** — ask the user one or more *structured multiple-choice*
  questions (an approach, a config value, a go/no-go) and wait for the answer.
  Renders a form with lettered options, an optional "Other…" row, and
  Skip/Continue; the user's pick is delivered back to you as if typed at your
  prompt. Pass several via `questions` to ask them all in one card.
- **`inbox_search`** — read back what's already in the inbox: list recent
  entries or substring-search them. Use it to answer "what's in my inbox?",
  find an earlier entry, or check whether you already reported something.
- **`remote_exec`** — run a shell command on a registered **remote (SSH)**
  project and get its output back. Use it to inspect or act on a remote
  workspace without opening a terminal there. First use asks the user for
  permission.

The `zcc-inbox` MCP server is wired up automatically by the launcher — you
don't need to touch `.mcp.json`. This skill is injected into in-app threads
with the other product builtins.

## The tool

**Tool:** `zcc-inbox.inbox_push`

**Schema:**

```ts
{
  subject?: string,                 // short one-line headline for the inbox row
  intent?: string,                  // one line of CONTEXT — what you were trying to achieve
  docs?: Array<{ path: string }>,  // paths relative to the project root
  comments?: string,                // markdown
  report?: boolean,                 // mark as a finished REPORT/deliverable (badge + Reports tab + filter)

  // Optional structured question (same shape as inbox_ask). When present,
  // `comments` becomes the question prompt and these render as a lettered form.
  options?: string[],               // single-question choices (1–20), lettered A/B/C…
  allowOther?: boolean,             // add a free-text "Other…" row
  multiSelect?: boolean,            // checkboxes instead of radio
  blocking?: boolean,               // default FALSE here — soft/optional follow-up
  questions?: Array<{               // OR several questions at once (instead of options)
    prompt: string,
    options: string[],
    allowOther?: boolean,
    multiSelect?: boolean,
    blocking?: boolean              // per-question; default FALSE on inbox_push
  }>
}
```

At least one of `docs` / `comments` must be present. The host assigns the option
letters (never you). A pick is delivered back to you on this session as if typed
— but ONLY when the push is on a live session; on the project-only route the
options still show, just without answer-injection.

**Blocking vs. soft.** A question on `inbox_push` defaults **non-blocking** — it's
a soft follow-up on a status report ("done — want me to open a PR?"). It stays
answerable but does NOT get pinned to the top "Needs your answer" band. That's
the right shape for a report that ends with an optional ask. If you are genuinely
BLOCKED and can't proceed without the answer, either set `blocking: true` here or
— better — use **`inbox_ask`** (which defaults blocking and is what the pinned
band is for).

## When to use it

Push an update to the user's inbox from this project. Use this when you have
something the user should see — a finished analysis (point to the report file
via `docs`), a question back to the user (write it as `comments`), a blocked
task that needs input, or a status check-in.

`docs` are paths relative to this project root. Each one is rendered live in
the inbox UI when the user opens the entry — no snapshot is taken, so later
edits to the file will be reflected on subsequent reads.

`comments` is markdown — your voice to the user about what you did or want to
ask. Keep it short and direct; if more detail is needed put it in a doc and
reference it.

`subject` is an optional one-line headline that becomes the inbox row title (a
few words — what this is about). Without it the row falls back to the session's
task title, then the first line of `comments`. Set it when the first line of
`comments` would make a poor heading (e.g. it opens mid-sentence, or the message
is long). The host trims it to a single line and caps its length.

`intent` is an optional one line of **context** — *what you (or the user) were
trying to achieve* when this came up (the goal behind the message), NOT what the
message says. The inbox renders it as a "Context" line on the message and in the
pinned "Needs your answer" section, so the user can triage a full inbox at a
glance without opening each entry. It's most valuable on a **question**: say what
the answer unblocks (e.g. "Deciding the auth strategy before I wire the login
route"). When omitted the inbox falls back to the session's task title, so always
prefer a specific `intent` over the generic fallback. Trimmed to a single capped
line like `subject`; like it, an `intent`-only push (no docs/comments) is still
rejected — context is not content.

`report` marks the entry as a finished **deliverable** — a completed analysis, an
RCA, an audit, a design writeup, the kind of thing you point at with `docs`. Set
`report: true` and the inbox gives it a "Report" badge in the feed, counts it in a
dedicated **Reports** tab, and lets the user filter the feed down to just reports —
so a deliverable surfaces fast instead of scrolling past in the mixed stream.
Leave it **off** (the default) for routine status check-ins, progress pings, and
questions: over-flagging every push defeats the point of the badge. A report-only
push (no docs/comments/question) is still rejected — the flag is a label, not
content.

## Examples

**Just a comment** (a question or status):

```
inbox_push({
  comments: "Finished the migration audit. Two files use the legacy API and need a human eye — see `audit/report.md`. Want me to attempt the rewrite?"
})
```

> **Asking a genuine decision? Give it structure.** A bare-prose question like the
> one above lands in the inbox as a free-text reply box — the user has to type the
> answer out. When you're offering discrete choices (an approach, a go/no-go, a
> config value), prefer **`inbox_ask`** (or pass `options` / `questions` on
> `inbox_push`): the host renders a lettered picker with the exact choices YOU
> authored, and on a live session the user's pick is delivered straight back to
> you. Reserve free-text `comments` for open-ended questions and status updates.

**Comment plus a doc pointer, flagged as a report** (preferred for deliverables —
`report: true` gives it the badge + Reports tab so the user can find it fast):

```
inbox_push({
  subject: "Macro analysis — 2026-05-14",
  comments: "Macro analysis for 2026-05-14 done.",
  docs: [{ path: "research/macro-2026-05-14.md" }],
  report: true
})
```

**Just docs** (when the doc speaks for itself):

```
inbox_push({
  docs: [{ path: "design/proposed-api.md" }]
})
```

**A status-plus-question with concrete choices** (renders as a lettered form; the
pick comes back as if typed on a live session):

```
inbox_push({
  comments: "Migration audit done — how do you want to handle the legacy API?",
  options: ["Rewrite both files", "Leave them", "Show me the diff first"]
})
```

## Asking a structured question — `inbox_ask`

**Tool:** `zcc-inbox.inbox_ask`

**Schema:**

```ts
{
  subject?: string,          // optional one-line headline for the inbox row
  intent?: string,           // one line of context — what this answer unblocks

  // Single-question mode — pass question + options:
  question?: string,         // one clear line (markdown allowed)
  options?: string[],        // choosable answers, in display order (1–20)
  allowOther?: boolean,      // add a free-text "Other…" row
  multiSelect?: boolean,     // let the user pick more than one option
  blocking?: boolean,        // default TRUE here — pins to "Needs your answer"

  // OR multi-question mode — pass a questions array instead:
  questions?: Array<{
    prompt: string,          // this question, its own heading
    options: string[],       // its choosable answers (1–20)
    allowOther?: boolean,
    multiSelect?: boolean,
    blocking?: boolean       // per-question; default TRUE on inbox_ask
  }>,                        // 1–10 questions, stacked in one card
  preamble?: string          // optional intro line above all the questions
}
```

Prefer `inbox_ask` over a free-text `inbox_push` question whenever the answer is
a **choice between concrete options**. The host assigns the option letters (A,
B, C, …) — you supply only the text. When the user hits Continue, their chosen
option label(s) (or the Other text) arrive on THIS session as if typed at your
prompt. Skip delivers nothing (the user declined). Same rule as a pushed
question: **ask, then WAIT** — don't guess the answer and continue.

Use `question` + `options` for ONE question; use `questions` for several at once
— **don't mix the two**. With `questions`, all forms render in one card and
Continue unlocks only once the user has answered every one; the answers come
back together as a labelled `Q1: …\nA: …` block.

Set `intent` to one line of context — *what the answer unblocks* — so the
question shows a "Context" line in the pinned "Needs your answer" section and the
user can decide it without reopening the session. Falls back to the session task
title when omitted.

`inbox_ask` defaults **blocking** (`blocking: true`), so it earns a slot in the
pinned "Needs your answer" band — that's the whole point. Only pass
`blocking: false` if the ask is genuinely optional and you don't want it pinned
(in which case a soft `inbox_push` question is usually the cleaner choice).

`inbox_ask` is session-scoped: it only works from a live terminal session (there
has to be somewhere to deliver the answer). It won't appear on a headless
project-only connection.

**A go/no-go decision:**

```
inbox_ask({
  question: "Two files use the legacy API. Attempt the rewrite?",
  options: ["Yes, rewrite them", "No, leave them", "Show me the diff first"]
})
```

**Open-ended with an escape hatch:**

```
inbox_ask({
  question: "Which database should the new service use?",
  options: ["Postgres", "SQLite", "Reuse the existing Mongo cluster"],
  allowOther: true
})
```

**Several questions at once:**

```
inbox_ask({
  preamble: "A few choices before I scaffold the service:",
  questions: [
    { prompt: "Which database?", options: ["Postgres", "SQLite"], allowOther: true },
    { prompt: "Deploy target?", options: ["Docker", "Bare metal", "Serverless"] },
    { prompt: "Include auth boilerplate?", options: ["Yes", "No"] }
  ]
})
```

## Reading the inbox — `inbox_search`

**Tool:** `zcc-inbox.inbox_search` (read-only)

**Schema:**

```ts
{
  query?: string,        // case-insensitive substring over subject + intent + comments + doc paths
  allProjects?: boolean, // default false → this project only
  limit?: number,        // max matches to return (default 25)
  before?: string        // entry id to page before (older than it)
}
```

By default it reads **only this project's** inbox — the project identity comes
from the MCP URL, same as `inbox_push`, so you can't peek at another project's
inbox by accident. Pass `allProjects: true` only when the task is explicitly
about searching across every inbox.

Results are newest-first. Each entry comes back projected to
`{ id, ts, projectId, projectLabel?, subject?, intent?, comments?, docs?, occurrences?, report? }`
(`report: true` marks an entry you flagged as a deliverable).

**List the most recent entries** (no query):

```
inbox_search({ limit: 10 })
```

**Find an entry by keyword**:

```
inbox_search({ query: "migration audit" })
```

**Search every project's inbox** (only when asked to):

```
inbox_search({ query: "deploy failed", allProjects: true })
```

## Running a command on a remote project — `remote_exec`

**Tool:** `zcc-inbox.remote_exec`

**Schema:**

```ts
{
  projectId: string,   // a REGISTERED remote (SSH) project — resolve via list_projects
  command: string,     // shell command; runs in the project root by default
  cwd?: string,        // optional working dir, must be UNDER the project root
  timeoutMs?: number   // per-command timeout (default 120000, max 600000)
}
```

You pass the **id of a project the user already registered as remote** — never a
raw host or credentials. The app resolves the SSH target from that project and
runs your command over the same transport the file Explorer uses, starting in
the project's remote root. Shell operators (`|`, `&&`, redirection) work because
the command runs in the remote login shell.

Returns `{ projectId, exitCode, stdout, stderr, truncated }`. A **non-zero
`exitCode` is returned as data, not an error** — so you can branch on it.
Each stream is capped at 1 MB; `truncated` is `true` when output was clipped.

This is a **privileged** capability: the first call raises a permission prompt
the user blesses once (like `agent_send`). It is pre-approved only inside
autonomous team runs.

**Check a remote build:**

```
remote_exec({ projectId: "prj_abc", command: "npm run build" })
```

**Inspect git state in a subdirectory:**

```
remote_exec({ projectId: "prj_abc", command: "git status --porcelain", cwd: "services/api" })
```

To find remote project ids, call `list_projects` — remote projects carry a
`remote` field; local ones don't.

## Notes

- The project identity is supplied by the URL path of the MCP endpoint, not
  by you — you cannot push to (or, by default, read) a different project's
  inbox even if you tried. `inbox_search({ allProjects: true })` is the one
  explicit, opt-in way to read across projects.
- `remote_exec` only works against a project the user registered as remote; a
  local or unknown id returns an error. You never supply the host or credentials.
- `inbox_search` is read-only: it never creates, edits, or removes entries.
- `docs` are pointers, never snapshots. If you regenerate `report.md` later,
  the user sees the new content next time they open the entry.
- Don't push noise — every entry buys the user's attention. One good push at
  the end of a task beats five status pings.
