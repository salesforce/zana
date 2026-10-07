---
name: design-docs
description: Read, write, review and enrich the user's design documents (specs, RFCs, ADRs, product and API docs) in the Design Docs plugin. Use when the user mentions a design doc, spec, RFC or ADR, asks you to draft, review, update or check a design against the code, or when a plan you produce is worth keeping as a document.
---

# design-docs - work on the user's design documents

The Design Docs plugin stores design documents the user and agents work on
together. Each doc is a small project of files, rendered as formatted pages
in the Design Docs panel. The user sees your edits appear live and can undo
any of them from History.

## Model

- **Doc**: id (`dd_…`), title, summary, status, tags, project (or global),
  an entry file (usually `README.md`), files, review comments and history.
- **Status** moves `draft → review → approved → implemented`, or `archived`.
  Change it only when the user asks or the doc clearly reached that stage.
- **Files** render by extension:
  - `.md`: GitHub-flavoured Markdown, with tables, task lists, ```` ```mermaid ````
    blocks and `$math$`.
  - `.mmd`: one Mermaid diagram.
  - `.html`: a self-contained mockup in a sandboxed frame. Inline the CSS and JS.
  - `.svg` and images: shown as pictures. Image content is base64.
  - Code and text files: highlighted source.
- **Comments** are review feedback. They can be anchored to a file and a
  quoted passage. Open comments are the work queue.
- **Revisions**: every write bumps that file's revision and is kept in
  history.

## Tools

| Tool | Use |
| --- | --- |
| `design_doc_list` | Find docs. Defaults to active docs of this project plus global docs. `query` searches titles, summaries, tags and contents. |
| `design_doc_read` | Without `path`: manifest, open comments and the entry file. With `path`: one file and its revision. `includeAll: true` returns every text file. |
| `design_doc_create` | New doc from `files` or a `template` (`technical`, `product`, `adr`, `api`, `blank`). |
| `design_doc_write` | Change one file: `edits` (preferred), `content` (whole file, creates it), `delete`, or `renameTo`. |
| `design_doc_update` | Title, summary, status, tags, entry file. |
| `design_doc_comment` | Add a comment, or `resolve` / `reopen` one by id. |

The same operations exist on the CLI for shells and scripts. Run
`zcc design-docs --help` to see them, for example `zcc design-docs show <doc>`,
`zcc design-docs edit <doc> <path> --old … --new …` or
`zcc design-docs comment <doc> "…" --path README.md --quote "…"`.

A doc reference is its id or its slug.

## Workflow

1. **Read first.** Call `design_doc_read` and note each file's `revision`.
   When the user `@`-mentions a doc, its manifest and entry file are already
   in your context.
2. **Edit surgically.** Use `edits` with exact `oldText` for changes. Rewrite a
   whole file only to create it or restructure it completely.
3. **Always pass `baseRevision`.** It is the revision you read. Use
   `baseRevision: 0` to assert that a file is new. A conflict means the user
   edited it meanwhile. Re-read, reapply your change on top, and never
   overwrite their work.
4. **Add a short `note`** to each write ("Add failure modes", "Address review").
   It shows in History.
5. **Address open comments.** Make the change, then resolve the comment with a
   `body` saying what you changed. If you disagree or need input, reply instead
   of resolving.
6. **Show the doc.** Put its card on its own line in your reply:
   `::design-doc{id="dd_…"}`. Add `path="api.md"` to point at one file.

## Writing good design docs

- Lead with the problem, the goals and the non-goals. Then the proposal,
  alternatives with their trade-offs, risks, and a rollout plan.
- Be concrete. Name the real modules, endpoints, tables and numbers from this
  project. Read the code instead of guessing.
- Mark assumptions and open questions explicitly so the user can answer them.
- Use diagrams when structure or flow matters: sequence, flowchart, ER or state.
  Keep big diagrams in their own `.mmd` file and link them from the Markdown,
  for example `[Sync flow](diagrams/sync.mmd)`.
- Add an HTML mockup (`mockups/*.html`) when a UI is part of the design.
- Split long docs into files (`api.md`, `data-model.md`, `rollout.md`) and link
  them from `README.md`, which stays the overview.

## Reviewing

When asked to review, read every file, then leave anchored comments with
`design_doc_comment`, passing `path` and the exact `quote`. Cover gaps,
contradictions, risky assumptions and mismatches with the code. Do not edit the
files unless asked. Summarise the main concerns in your reply.

## Boundaries

- Docs belong to a project or are global. Without `scope: "all"`, listing stays
  in the current project plus global docs.
- Limits: 150 files and 8 MB per doc, 256 KB per text file, 2 MB per image.
  History keeps the last 25 revisions of each text file. Paths are relative,
  use `/` and cannot contain `..`.
- Deleting a file keeps it in history. Deleting a whole doc is a user action
  in the panel. There is no tool for it.
