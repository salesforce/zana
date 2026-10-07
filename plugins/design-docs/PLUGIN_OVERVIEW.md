Write design documents with your agents: specs, RFCs, ADRs, product briefs and API designs. Each doc is a small project of files rendered as formatted pages. Agents in your projects know your docs, read them for context, edit them, and review them. Every change lands live and is versioned.

## What you get

- A Design Docs workbench. It has a doc list with search and status filters, a file tree for each doc, and a reading view with preview, edit and side-by-side modes.
- Multi-file docs. Markdown with tables, task lists, math and Mermaid. Standalone `.mmd` diagrams. Self-contained HTML mockups, with desktop, tablet and phone widths. SVG, images and highlighted code.
- Templates for technical designs, product specs, ADRs and API designs, or a blank doc.
- Review comments. Select any passage to comment on it or ask an agent about it. Comments are anchored to the quoted text and highlighted in the page.
- History with diffs. Every save, by you or an agent, is a revision. Compare it with the previous one and restore it in one click.
- A Design tab in each project, showing that project's docs and the global ones.
- Doc cards in chat. A card opens the doc beside the conversation, so you can watch an agent's edits arrive.
- Save as design doc. Use it on any chat message, or on a selected part of one.

## For agents

Every thread is told about the current project's active docs. Agents get `design_doc_*` tools to list, read, create, edit, update and comment on docs, and the same operations as `zcc design-docs` on the command line. Edits are exact-match replacements with revision checks, so a concurrent edit by you is reported as a conflict instead of being overwritten. Type `@` in the composer to attach a doc to a prompt.

## Ask agent

Each doc has an Ask agent menu. It can review the doc, fill gaps, add diagrams, check the design against the code, address open comments, or run your own prompt. It starts a thread in the doc's project and opens the doc beside it.

## Data

Docs are stored in the plugin's local database on this machine. A doc belongs to one project or is global. Deleting a file keeps it in history. Deleting a doc removes it permanently.
