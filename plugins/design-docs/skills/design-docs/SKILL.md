---
name: design-docs
description: Read, write, review and enrich the user's design documents (specs, RFCs, ADRs, product and API docs) in the Design Docs plugin. Use when the user mentions a design doc, spec, RFC or ADR, asks you to draft, review, update or check a design against the code, or when a plan you produce is worth keeping as a document.
---

# design-docs - work on the user's design documents

The Design Docs plugin stores design documents the user and agents work on
together. Each doc is a small project of files, rendered as formatted pages
in the Design Docs panel. The user sees your edits appear live and can undo
any of them from History.

Design docs are separate from the Library. Save notes, findings, runbooks and
postmortems to the Library with the `library_*` tools (see `library-curator`).
Keep design docs for specs, RFCs, ADRs and designs the user reviews.

## Model

- **Doc**: id (`dd_…`), title, summary, status, tags, project (or global),
  an entry file (`README.md` for a written doc, `index.html` for a site),
  files, review comments and history.
- **Status** moves `draft → review → approved → implemented`, or `archived`.
  Change it only when the user asks or the doc clearly reached that stage.
- **Files** render by extension:
  - `.md`: GitHub-flavoured Markdown, with tables, task lists, ```` ```mermaid ````
    blocks and `$math$`.
  - `.mmd`: one Mermaid diagram.
  - `.html`: a page, run in a sandboxed frame the way a static site shows
    it. See [HTML pages and sites](#html-pages-and-sites).
  - `.svg` and images: shown as pictures. Image content is base64.
  - Code and text files: highlighted source.
- **Comments** are review feedback. They can be anchored to a file and a
  quoted passage, and each has a thread of replies. Open comments are the
  work queue.
- **Revisions**: every write bumps that file's revision and is kept in
  history.

## Tools

| Tool | Use |
| --- | --- |
| `design_doc_list` | Find docs. Defaults to active docs of this project plus global docs. `query` searches titles, summaries, tags and contents. |
| `design_doc_read` | Without `path`: manifest, open comments and the entry file. With `path`: one file and its revision. `includeAll: true` returns every text file. For HTML pages it adds the page check and what the panel saw when it last ran the page. |
| `design_doc_create` | New doc from `files` or a `template`: `technical`, `product`, `adr`, `api` or `blank` for written docs, `report` or `html-design` for a site. `entryPath` picks the file it opens on. |
| `design_doc_write` | Change one file: `edits` (preferred), `content` (whole file, creates it), `delete`, or `renameTo`. Writing an HTML page returns its page check. |
| `design_doc_update` | Title, summary, status, tags, entry file. |
| `design_doc_comment` | Add a comment, reply in one's thread (`replyTo`), or `resolve` / `reopen` one by id (`body` becomes a reply). |

The same operations exist on the CLI for shells and scripts. Run
`zcc design-docs --help` to see them, for example `zcc design-docs show <doc>`,
`zcc design-docs edit <doc> <path> --old … --new …` or
`zcc design-docs comment <doc> "…" --path README.md --quote "…"` or
`zcc design-docs reply <doc> <comment-id> "…"`. `import` brings a folder of
files into a doc and `export --out` writes a doc out as a site (see
[Publishing](#publishing-to-github-pages)). `write --file`, `import` and
`export --out` work only inside your thread's project folder.

A doc reference is its id or its slug. A slug only names a doc of this project
or a global one; use the id to reach another project's doc.

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
   `body` saying what you changed. If you disagree or need input, answer with
   `replyTo` and leave it open. Never open a new comment to answer one.
6. **Show the doc.** Put its card on its own line in your reply:
   `::design-doc{id="dd_…"}`. Add `path="api.md"` to point at one file.

## HTML pages and sites

A doc can be a small static site: HTML pages that link to each other, with
their own CSS, scripts, data files, images and fonts. The panel runs each page
the way a browser would serve the doc's folder, so the same files work as a
GitHub Pages site. The user reads, edits and comments on the pages in the panel
while the site takes shape, then publishes it.

- **Start from a template.** `report` is a one-page interactive report (KPI
  tiles, charts from a CSV, a sortable and filterable table). `html-design` is a
  technical design as a web page with section navigation. Both open on
  `index.html`. Replace their sample content; keep the structure that fits.
- **Use the site kit.** Link `zcc-kit/site.css` and `zcc-kit/site.js` in each
  page's `<head>` for the layout, components, light and dark themes, sortable
  tables, filters, tabs and charts declared as JSON. Read
  [site-kit.md](site-kit.md) (next to this skill) before you build or change a
  page; it lists every class, attribute and chart option. Do not write your own
  chart library or copy the kit into the doc.

- Reference doc files by relative path: `<link rel="stylesheet" href="site.css">`,
  `<script src="app.js">`, `<img src="img/chart.png">`,
  `fetch('data/runs.json')`. Links between pages (`href="runs/index.html#top"`)
  open in the panel, and `localStorage` works.
- Nothing loads from the network: CDN scripts, stylesheets and fonts are
  blocked, so add those files to the doc. Forms, popups and `<iframe>` embeds
  do not work in previews, and audio and video do not play.
- Each script runs on its own, so do not split code into ES modules that
  `import` each other. Put shared code in one plain script.
- Writing a page returns a **page check**: files it uses that the doc lacks, and
  what previews block. Fix those before telling the user the page is done.
- Scripts only run when the page is open in the panel. After that, reading the
  page reports its script errors and any comment whose quote the page no longer
  shows. The manifest lists other pages that had problems.
- `zcc design-docs preview <doc>` prints a URL that serves the doc as its site
  to any browser on this machine.

### Publishing to GitHub Pages

```sh
zcc design-docs export <doc> --out docs
```

This writes the doc's files into `docs/` of the project, plus the kit files its
pages load and a `.nojekyll` marker. It overwrites files with the same path and
leaves other files in the folder alone, so remove pages the doc no longer has
yourself. GitHub Pages serves a branch's root or its `/docs` folder, and a site
opens on `index.html`.

Committing and pushing publish the site to everyone who can see the repository.
Do both only when the user asks. Then tell them to turn on Pages in the
repository settings, deploying from that branch and folder.

To bring an existing site into a doc, pass its files and the folder they sit in:

```sh
zcc design-docs import --title "Benchmark report" $(git ls-files site) --base site
```

Hidden files, `node_modules` and a `zcc-kit/` copy are skipped. To refresh an
existing doc, name it instead of `--title`. Files with the same path are
updated, and files the doc has but the folder lacks are kept.

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
`design_doc_comment`, passing `path` and the exact `quote` as written in the
file. For an HTML page, quote the text as the page shows it, not its markup.
The panel highlights the quote, and you are told when it cannot. Cover gaps,
contradictions, risky assumptions and mismatches with the code. Do not edit the
files unless asked. Summarise the main concerns in your reply.

## Boundaries

- Docs belong to a project or are global. Without `scope: "all"`, listing stays
  in the current project plus global docs.
- Limits: 500 files and 24 MB per doc, 2 MB per file. History keeps the last
  25 revisions of each text file, fewer for files over 256 KB. Paths are relative,
  use `/` and cannot contain `..`.
- Deleting a file keeps it in history. Deleting a whole doc is a user action
  in the panel. There is no tool for it.
