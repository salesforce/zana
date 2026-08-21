---
name: library-curator
description: Discover, maintain, and curate durable project knowledge in the Zana Command Center library. Use before work that may duplicate existing findings, or when asked to capture, improve, consolidate, refresh, organize, or retrieve library documents, architecture notes, runbooks, decisions, or postmortems.
---

# library-curator - maintain durable project knowledge

Use the Zana Command Center Library for durable, reusable project knowledge.
Use the project inbox for notifications and historical reports. Use repository
`docs/` for source-controlled product documentation. Do not create duplicate
documents when an existing canonical document can be improved instead.

## When to load

Load this skill when you need to:

- Check whether the project already has relevant findings, decisions, or reports.
- Create or improve a durable architecture note, runbook, RCA, decision record,
  research finding, or project summary.
- Consolidate duplicate or stale library documents.
- Promote useful conclusions from an inbox report into maintained knowledge.
- Answer a request that refers to a prior library document.

## Tools and scope

The Library tools are project-scoped. They operate on the current project unless
the user explicitly asks for another project. They are not a substitute for the
repository's source-controlled documentation.

| Need | Tool or location |
|---|---|
| Discover library documents | `library_list` |
| Read an existing document | `library_read` |
| Create or update durable knowledge | `library_write` |
| Remove an agent-authored obsolete document | `library_remove` |
| Find prior inbox reports | `inbox_search` |
| Product docs that ship with the code | repository `docs/` |

## Default workflow

1. Before creating a library document, call `library_list` and inspect likely
   related documents with `library_read`.
2. Reuse and update the canonical document when it covers the same subject.
   Create a new document only for a distinct artifact, a dated record, or when
   keeping historical versions is useful.
3. Write clear, self-contained content with `library_write`. Set a concise
   title, one-line summary, and stable tags. Use a meaningful path such as
   `findings/`, `decisions/`, `runbooks/`, or `research/`.
4. Include concrete evidence where it helps future agents: affected file paths,
   commands run, verification results, assumptions, and dates.
5. If the update is a significant deliverable, create a concise inbox report
   pointing the user to it. Do not treat the inbox report as the canonical copy.

## Writing standards

- Prefer a single canonical document per topic; update it rather than creating
  near-duplicates.
- Preserve useful context and authorship. Do not delete or overwrite
  user-authored content without explicit permission.
- Distinguish facts, decisions, risks, and open questions.
- Keep summaries short enough to be useful in the Library list.
- Use tags consistently, for example `architecture`, `decision`, `finding`,
  `runbook`, `rca`, `research`, or `idea`.
- Link to source-controlled documentation rather than copying large repository
  documents into the Library unless the library document adds durable analysis.

## Inbox reports

Use `inbox_search` to retrieve historical reports. A report is an activity
record and may contain stale snapshots. When a report contains knowledge worth
reusing, validate it against current code and promote the durable conclusion to
the Library with `library_write`.

## Avoid

- Do not create a library entry for transient progress updates.
- Do not duplicate existing repository documentation without adding curated
  context, analysis, or an explicit reason.
- Do not delete documents merely because they are old; mark them superseded or
  update them when appropriate.
- Do not assume library content is current. Verify code paths and commands before
  relying on older findings.
