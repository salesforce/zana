# BB Markdown editor attribution

The shared rich Markdown editor adapts the continuous-document editing and
source-preservation algorithm from BB Docs:

- Upstream: https://github.com/get-bb/bb
- Revision: `35a03bbbb3f4d8dc814c1a152db5a463102b4250`
- Source: `plugins/docs/markdown-blocks.ts` and the `TiptapEditor` integration in `plugins/docs/app.tsx`
- Copyright (c) 2026 Michael Yong
- License: [MIT](BB-LICENSE), included in production main/preload/renderer bundle banners

`apps/app/src/components/markdown/markdown-preservation.ts` retains original source
for unchanged ProseMirror nodes and serializes edited groups. It adapts BB's
algorithm to Zana's Tiptap 3 / official Markdown extension and Remark offsets,
preserving front matter, BOM, CRLF and reference definitions. Opening front matter
is validated as a YAML mapping, following BB, so ordinary thematic breaks stay
visible. Reconciliation
compares parsed nodes as well as source so changed reference definitions refresh
the displayed destination.

`LibraryMarkdownEditor` now owns one document-wide editor. It stays mounted
across Read/Edit/Source switches to retain selection and native undo history.
Images use Zana's scoped document readers. Unsupported syntax uses literal,
editable source nodes; raw HTML is never executed.

Zana's existing Save, revision checks, conflict recovery, read-only boundaries and
file identity remain host-owned. This ports the rich editor and preservation
layer; BB's vault storage, attachment-upload service, autosave sessions and agent
proposal service are separate integrations.
