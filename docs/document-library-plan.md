# Document Library — store, browse, and agent-access generated docs

**Status:** Draft plan (not yet implemented; designed 2026-06-12)
**One-line:** A first-class place to keep generated artifacts (md, pdf, images,
code snippets), browse them with a tree + multi-format preview, and let agents
search / fetch / store them via a skill.

---

## 1. What the user asked for

> We might generate a lot of documentation and in some cases store it, so we
> need a mechanism to store them (pdf, md files, etc), to visualise the
> folder/files (explorer + file preview), and make them accessible to agents
> via skills to search/fetch.

### Resolved design decisions (2026-06-12)
- **Storage scope:** *Both, project-default.* `<repo>/.zcc/library/` for
  project docs (git-trackable, travels with the repo) **+** `~/.zcc/library/`
  for cross-project / personal docs. Precedence-merged with source badges,
  exactly like `template-store.ts` does for templates.
- **Agent access:** *Skill + normal file tools.* A `library` skill documents the
  dirs and the manifest schema; agents read/write with Read/Write/Grep/jq. No
  new MCP surface in v1 — mirrors the existing `saved-reports` skill, which is
  explicit that "this is NOT an API and NOT an MCP tool."
- **MCP tools:** deferred. Layer `library_search/fetch/store` onto the local MCP
  server *only* when a remote / programmatic / server-validated need appears.

---

## 2. Key finding — ~85% of this already exists

This is mostly assembly, not new infrastructure. The rails:

| Need | Already built | File |
|---|---|---|
| Per-record file store (atomic write, tolerant read, `onChanged`) | `saved-store.ts` is the cleanest template; `template-store.ts` has the dual-scope precedence merge | `src/main/saved-store.ts`, `src/main/template-store.ts` |
| List / walk / read / full-text search files (capped, deny-listed, binary-detecting) | `fs.ts` — `listDir`, `walkFiles`, `readFile`, `searchFiles` | `src/main/fs.ts` |
| Tree + Monaco editor + markdown/mermaid preview | `ExplorerView` (1015 lines) | `src/renderer/components/ExplorerView.tsx` |
| Hosting a `<webview>` (for PDF/HTML preview) | `PreviewPane` | `src/renderer/components/PreviewPane.tsx` |
| Workspace mode switching (`terminals \| explorer \| preview`) | `WorkspaceMode` union + persistence | `src/renderer/store.ts:50`, `:429-492` |
| Agent-reads-a-store-via-skill pattern (the blessed precedent) | `saved-reports` skill | `~/.claude/skills/saved-reports/SKILL.md`, `resources/saved-reports-skill.md` |
| HTML → PDF (for "export this doc") | offscreen `printToPDF` | `src/main/inbox-pdf.ts` |
| Skill install / enable from the app | `skill-installer.ts`, `skill-bundles-store.ts` | `src/main/skill-installer.ts` |

The genuine gaps: (a) a **dedicated library store** (dir + manifest), (b) a
**preview that handles PDF + images** (ExplorerView only does text/md today),
(c) a **`library` skill** that points agents at it.

---

## 3. Storage — directory + manifest, NOT a JSON-blob store

PDFs and large markdown don't inline into JSON well, and agents read *files*
best (proven by `saved-reports`). So: **real files on disk**, metadata in a
rolled-up `index.json` manifest per library dir.

```
<repo>/.zcc/library/        ← project docs (git-trackable)
~/.zcc/library/             ← global / cross-project
   index.json                     ← manifest
   2026-06-12-rca-checkout.md
   design/architecture.pdf
   diagrams/flow.png
```

### `index.json` schema (one per library dir)

```jsonc
{
  "version": 1,
  "docs": [
    {
      "id": "uuid",                       // stable; also the manifest key
      "relPath": "design/architecture.pdf", // posix, relative to this library dir
      "title": "Checkout architecture",
      "summary": "One-paragraph abstract for search/preview.",  // optional
      "tags": ["architecture", "checkout"],
      "kind": "pdf",                      // md | pdf | image | code | other (derived from ext)
      "createdAt": 1749648000000,         // epoch ms
      "updatedAt": 1749648000000,
      "source": {                         // provenance — who deposited it
        "kind": "agent" | "user" | "schedule" | "inbox",
        "sessionId": "…",                 // optional
        "scheduleId": "…",                // optional
        "projectId": "proj-abc"           // optional (FK into projects.json)
      },
      "bytes": 81234                       // optional, for the UI
    }
  ]
}
```

Rationale for a single manifest (vs. per-file `.meta.json` sidecars): one
atomic write per mutation, one read to populate the panel, no orphaned
sidecars when a file is hand-deleted. Reconciliation on load: list the dir,
drop manifest entries whose `relPath` is gone, surface on-disk files missing
from the manifest as "untracked" (still browsable, just no metadata) — same
forgiving posture as `saved-store.list()` skipping unparseable files.

### `library-store.ts` (new, fork `template-store.ts`)
- `DEFAULT_GLOBAL_LIBRARY_DIR = ~/.zcc/library`
- project dir resolved from the project root, like templates do
- `list(projectId)` → merged docs from both scopes, each stamped `scope:
  'project' | 'global'` for a source badge; newest-first
- `add(scope, { file, meta })`, `update(id, patch)`, `remove(id)` — atomic
  manifest write (`tmp + rename`), then `emitChanged`
- `onChanged` full-list emit (small, low-churn list — renderer replaces wholesale)
- in-memory variant for tests, like `createMemorySavedStore`

`saved-store` stays as-is (frozen *inbox* snapshots, global-only). Add a
one-click **"Save to library"** bridge from a saved report / inbox entry that
copies its doc(s) into the library and appends a manifest entry. This is the
natural join between the ephemeral inbox feed and the durable library.

---

## 4. Browse — a new `'library'` workspace mode

Extend `WorkspaceMode` to `'terminals' | 'explorer' | 'preview' | 'library'`
(store.ts:50; persist it like `explorer`, store.ts:233-237).

`LibraryView.tsx` = ExplorerView's tree + a **format-switched preview**:

| Ext | Renderer | Already wired? |
|---|---|---|
| `.md`, `.markdown` | react-markdown + remark-gfm + mermaid | ✅ ExplorerView + `MermaidDiagram.tsx` |
| `.pdf` | `<webview src="file://…">` — Chromium's built-in PDF viewer | ✅ PreviewPane hosts webviews |
| `.png/.jpg/.svg/.gif/.webp` | `<img>` (file:// or data:) | new, trivial |
| code / text | Monaco | ✅ ExplorerView |
| other | "open externally" via `openers` / `shell.openPath` | ✅ `openers.ts` |

Realistically: parameterize ExplorerView by **root dir(s)** instead of the
hardcoded project root, add the two preview branches, and a small header
(tags, source badge, "open externally", "reveal in Finder"). Reuse
`fs.searchFiles` for full-text across the library. A tag filter chip row on top
covers "find me the RCAs" without new search infra.

### Reactivity trap (must-read for the implementer)
The library list is read in the renderer like `terminals` / `gitStatus`. Select
the **raw slice** and `useMemo` any derived array — inline selectors returning a
fresh `?? []` or `.filter(...)` array infinite-loop React here. See the
`zustand-selector-stable-ref` and `ui-state-localstorage-pattern` memories, and
the `EMPTY_TABS` stable-ref comment in `PreviewPane.tsx:53`.

---

## 5. Agent access — a `library` skill (mirror `saved-reports`)

Ship a bundled skill (resource file + installer, like `saved-reports-skill.md`
→ `~/.claude/skills/`). It documents:

- **Where:** the two dirs (project-local first, then global), and that
  project-local docs travel with the repo.
- **Manifest schema** (§3) and how to read it with `jq`.
- **Search:** `rg`/`grep` across files for full-text; `jq` over `index.json` for
  tag / title / provenance queries; resolve `projectId` → name via
  `~/.zcc/projects.json` (same recipe `saved-reports` already documents).
- **Fetch:** read the file directly with Read (md/code) — note PDFs/images are
  binary; prefer the `summary` field or a sibling `.md` for text.
- **Store:** Write the file under the right dir, then **append a manifest
  entry** (id, relPath, title, tags, `source.kind: "agent"`, sessionId). The
  skill spells out the minimal valid entry so agents don't corrupt `index.json`.

Provenance stamping (`source.sessionId` / `scheduleId`) makes agent searches
precise and lets a scheduled run deposit its artifact, then reference it. Note
the **scheduled-runs-no-background-agents** memory: a scheduled agent must do
the store-and-manifest write inline before turn-end, never via a background
sub-agent.

**MCP deferred.** If remote/programmatic access or server-side validation is
later needed, add `library_search` / `library_fetch` / `library_store` to
`mcp-server.ts`. The current MCP surface is push-only (inbox) and per-session
scoped; library tools would be a read/write surface and should validate
`relPath` stays inside the library dir (path-traversal guard) — a reason to do
it server-side eventually, but not a v1 blocker.

---

## 6. Work breakdown (suggested tickets)

**Phase 1 — store, no UI (hand-write JSON to test)**
- `LibraryDoc` / `LibraryManifest` types in `shared/types.ts`.
- `library-store.ts` (fork `template-store.ts` for dual-scope merge +
  `saved-store.ts` for atomic write / tolerant read). Manifest reconciliation
  on load. In-memory test variant + tests.
- IPC: `library.list / add / update / remove`, `onChanged` push (preload +
  `ipc.ts`).

**Phase 2 — browse UI**
- `WorkspaceMode += 'library'`; persist; mode toggle in the workspace header.
- `LibraryView.tsx` — tree (reuse ExplorerView internals) + format-switched
  preview (md/pdf/image/code) + tag filter + source badge.
- Wire `fs.searchFiles` for full-text; "reveal in Finder" / "open externally".

**Phase 3 — deposit paths**
- "Save to library" from inbox entry / saved report (copy doc + manifest entry).
- `inbox_push docs:` can optionally promote a doc into the library.
- Scheduled-run artifact → library (inline, per the no-background-agents memory).

**Phase 4 — agent skill**
- `library` skill resource file + installer entry (clone `saved-reports`).
- Document where/manifest/search/fetch/store; include the minimal-valid-entry
  recipe and the path-traversal caution.

**Phase 5 (optional, deferred)**
- `library_search/fetch/store` MCP tools with path-traversal guard, for
  remote/programmatic access.

---

## 7. Open questions to revisit (non-blocking)
- **Manifest vs. sidecars** if hand-editing becomes common — sidecars survive
  manual file moves better; manifest is faster to render. Starting with manifest.
- **Binary in git:** project-local PDFs/images bloat the repo. Document a
  `.gitignore`-the-library opt-out, or recommend global scope for large binaries.
- **Dedup / versioning:** if an agent regenerates "the RCA" daily, do we version
  (date-stamped names, as in the example) or overwrite? v1: date-stamped, no
  version graph.
- **Size cap:** `fs.readFile` caps at 2 MB; large PDFs preview via webview
  (no read needed) but won't full-text search. Acceptable for v1.

---

## 8. Entry points when resuming
- Store to fork: `src/main/template-store.ts` (dual-scope) + `src/main/saved-store.ts` (atomic/tolerant).
- File ops: `src/main/fs.ts` (`walkFiles`, `searchFiles`, `readFile`).
- Browse/preview UI: `src/renderer/components/{ExplorerView,PreviewPane,MermaidDiagram}.tsx`.
- Workspace mode: `src/renderer/store.ts:50` (`WorkspaceMode`), `:429-492` (set/toggle/persist).
- Skill precedent: `resources/saved-reports-skill.md`, `src/main/skill-installer.ts`.
- IPC wiring: `src/shared/ipc.ts`, `src/preload/index.ts`.
- Types: `src/shared/types.ts` (`SavedRecord`, `FsEntry`, `ProjectSettings`).

### Related memory
- `scheduled-runs-no-background-agents` — store-and-manifest write must be inline.
- `zustand-selector-stable-ref` / `ui-state-localstorage-pattern` — render-loop trap.
- `session-restore-design` — renderer-only snapshot pattern, similar posture.
