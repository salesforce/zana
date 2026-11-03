Write design documents with your agents: specs, RFCs, ADRs, product briefs and API designs. Each doc is a small project of files rendered as formatted pages. Agents in your projects know your docs, read them for context, edit them, and review them. Every change lands live and is versioned.

**Reach:** Plugin tools work in Modern Claude and Codex threads only. Use `zcc design-docs` CLI where a shell is available. Cursor and OpenCode unsupported.

## What you get

- A Design Docs workbench. It has a doc list with search and status filters, a file tree for each doc, and a reading view with preview, edit and side-by-side modes. The list groups docs by project, keeps pinned docs and docs with open comments on top, and nests alternative proposals under the doc they compete with.
- Multi-file docs. Markdown with tables, task lists, math and Mermaid. Standalone `.mmd` diagrams. Self-contained HTML mockups, with desktop, tablet and phone widths. SVG, images and highlighted code.
- Personal templates for technical designs, product specs, ADRs, API designs, sites and blank docs. Manage them from **Templates**: create, edit, duplicate, export, import, delete, or restore built-ins. Template exports are JSON bundles, shared across projects on this machine, and never peer-synced.
- Review comments. Select any passage to comment on it or ask an agent about it. Comments are anchored to the quoted text and highlighted in the page.
- History with diffs. Every save, by you or an agent, is a revision. Compare it with the previous one and restore it in one click.
- A Design tab in each project, showing that project's docs and the global ones.
- Doc cards in chat. A card opens the doc beside the conversation, so you can watch an agent's edits arrive.
- Save as design doc. Use it on any chat message, or on a selected part of one.

## For agents

Every thread is told about the current project's active docs. Agents get `design_doc_*` tools to list, read, create, edit, update and comment on docs, and the same operations as `zcc design-docs` on the command line. New tools `design_doc_template_read` and `design_doc_add_from_template` let agents work with templates. Edits are exact-match replacements with revision checks, so a concurrent edit by you is reported as a conflict instead of being overwritten. Agent prompts tell agents to follow `<!-- AI Instructions -->` template comments. Type `@` in the composer to attach a doc to a prompt.

## Ask agent

Each doc has an Ask agent menu. It can review the doc, fill gaps, add diagrams, check the design against the code, address open comments, or run your own prompt. The agent runs in the doc's project and opens in the side panel next to the doc, so you watch its edits land without leaving the page. The doc's Agents tab lists its conversations, and Open as thread moves one to your Agents list.

## Publish

A doc with HTML pages can be published as a GitHub Pages site. Publish asks for the repository (this project's or another one), the branch and the folder, then starts an agent in the side panel that exports the site, commits it and pushes it with your git credentials. It reports the commit and the Pages URL. The target is remembered for the next publish.

## Project scoping

Docs now belong to a Project or are global. Create with `--project <id>`, `--global`, or neither (the current project); move with `design_doc_update projectId` or `--global`. Agent prompts tell agents to follow `<!-- AI Instructions -->` template comments for guidance.

## Peer docs

Received peer docs appear under 'Unassigned from peers' until you map them. The app suggests a matching local Project (same tag, then name) and nothing is mapped until you confirm. Deleted Projects show as '<name> (project removed)'.

## Data

Docs are stored in the plugin's local database on this machine. A doc belongs to one Project or is global. Deleting a file keeps it in history. Deleting a doc removes it permanently.

Templates use separate local rows, so they are not listed as docs and never sent to peers. Before downgrading to a build without template support, run `zcc design-docs templates purge`.
