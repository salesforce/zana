---
name: saved-reports
description: Find, read, and reuse reports the user saved from the Zana Command Center inbox. Use when the user asks to recall, search, reuse, or reference a previously saved report, message, or analysis — e.g. "pull up the RCA I saved", "what saved reports do we have for project X", "reuse last week's saved summary".
---

# saved-reports — find & reuse saved inbox reports

Zana Command Center (the desktop app this session likely runs inside)
lets the user **save** an inbox message for later. A saved report is a frozen
snapshot: the agent's comments plus a **copy of each referenced doc's content
captured at save time**, so it stays usable even after the project's files
change, move, or the project is deleted.

You are **reading JSON files** with the normal file tools. This is NOT an API
and NOT an MCP tool. **Treat these files as read-only** — the app owns writes;
do not create, edit, or delete them unless the user explicitly asks.

## Where

All saved reports live in one global directory:

```
~/.zcc/saved/
```

One file per report, named `<id>.json`. Enumerate them with:

```bash
ls ~/.zcc/saved/
```

There is no project-local saved directory — everything is global, and each
record carries a `projectId` so you can filter by project.

## Schema

Each `~/.zcc/saved/<id>.json` is a single JSON object:

```jsonc
{
  "id": "uuid",                  // matches the filename
  "savedAt": 1749648000000,      // epoch milliseconds
  "sourceEntryId": "uuid",       // originating inbox entry id, if known (optional)
  "projectId": "proj-abc",       // FK into ~/.zcc/projects.json
  "projectLabel": "my-project",  // human-readable name snapshot (optional)
  "title": "Build finished — 3 flaky tests",  // short, derived from the report
  "comments": "markdown body…",  // the agent's message (optional)
  "docs": [                      // frozen doc snapshots (optional)
    {
      "path": "docs/rca.md",     // original path, relative to the project root
      "content": "# RCA…",       // file content AT SAVE TIME (a frozen copy)
      "truncated": false,        // true ⇒ content was cut at the read cap
      "binary": false,           // true ⇒ binary file, no content captured
      "error": "…"               // set ⇒ the snapshot read failed (no content)
    }
  ],
  "tags": ["rca", "release"]     // optional, user/agent labels
}
```

Notes:
- `docs[].content` is a **point-in-time snapshot**, not the live file. If you
  need the current file, resolve `projectId` → project `path` (see below) and
  read `path` fresh. Otherwise trust the snapshot.
- A doc with `truncated: true` is partial; `binary: true` or `error` means there
  is no usable `content`.
- Fields marked optional may be absent — handle missing keys gracefully.

## Resolve a project name → id

`projectId` is a foreign key into `~/.zcc/projects.json` (an array of
`{ id, name, path, … }`). To go from a project the user names to its reports:

```bash
# Find the projectId for a name, then its saved reports:
jq -r '.[] | select(.name=="my-project") | .id' ~/.zcc/projects.json
grep -l '"projectId": "<that-id>"' ~/.zcc/saved/*.json
```

`projectLabel` on the record is the human-readable name as it was at save time —
handy when the project was since renamed or deleted.

## Filter & search

Filter by project:

```bash
grep -l '"projectId": "proj-abc"' ~/.zcc/saved/*.json
```

Find by tag, list titles:

```bash
jq -r 'select(.tags[]? == "rca") | "\(.savedAt)\t\(.title)"' ~/.zcc/saved/*.json | sort -rn
```

Full-text search across comments, titles, and snapshotted doc content:

```bash
grep -il "checkout regression" ~/.zcc/saved/*.json
```

Or read + parse a specific record and work with its fields directly. To present
results to the user, prefer newest-first by `savedAt`.
