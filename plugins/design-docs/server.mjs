import { createRequire as __createRequire } from "node:module";
import { dirname as __pathDirname } from "node:path";
import { fileURLToPath as __fileURLToPath } from "node:url";
const require = __createRequire(import.meta.url);
var __filename = __fileURLToPath(import.meta.url);
var __dirname = __pathDirname(__filename);
var ue="changed",L=["draft","review","approved","implemented","archived"],P={draft:"Draft",review:"In review",approved:"Approved",implemented:"Implemented",archived:"Archived"};function b(i){return typeof i=="string"&&L.includes(i)}function X(i,n){let e=t=>t.replace(/["\\\n\r]/g,"");return n?`::design-doc{id="${e(i)}" path="${e(n)}"}`:`::design-doc{id="${e(i)}"}`}import{isAbsolute as St,join as xt}from"node:path";function I(i){return i>=1024*1024?`${Math.round(i/(1024*1024)*10)/10} MiB`:i>=1024?`${Math.round(i/1024)} KiB`:`${i} B`}function O(i,n=Date.now()){let e=Math.max(0,Math.round((n-i)/1e3));if(e<45)return"just now";let t=Math.round(e/60);if(t<60)return`${t}m ago`;let o=Math.round(t/60);if(o<24)return`${o}h ago`;let r=Math.round(o/24);return r<30?`${r}d ago`:new Date(i).toISOString().slice(0,10)}var tt=12e4;function j(i){return i.kind==="agent"?`agent "${i.label}"`:i.label}function nt(i,n=Date.now()){let e=[P[i.status],`${i.fileCount} file${i.fileCount===1?"":"s"}`,i.openComments?`${i.openComments} open comment${i.openComments===1?"":"s"}`:null,`updated ${O(i.updatedAt,n)}`].filter(Boolean),t=i.summary?` \u2014 ${U(i.summary,140)}`:"";return`- ${i.id} "${i.title}" (${e.join(" \xB7 ")})${t}`}function pe(i,n=Date.now()){return i.length===0?"No design docs match.":i.map(e=>nt(e,n)).join(`
`)}function it(i,n,e){let t=i.path===n?" [entry]":"";return`- ${i.path}${t} \u2014 ${i.kind}, ${I(i.size)}, rev ${i.revision}, ${j(i.updatedBy)} ${O(i.updatedAt,e)}`}function re(i,n=Date.now()){let e=i.path?` on ${i.path}`:"",t=i.quote?` \u203A "${U(i.quote,120)}"`:"",o=i.status==="resolved"?" [resolved]":"";return`- [${i.id}]${e}${t}${o} ${j(i.author)}, ${O(i.createdAt,n)}: ${i.body}`}function $(i,n=Date.now()){let e=[`# ${i.title}`,`id: ${i.id} \xB7 slug: ${i.slug} \xB7 status: ${i.status} \xB7 doc revision ${i.revision}`,`project: ${i.projectId??"global (all projects)"} \xB7 created by ${j(i.createdBy)} \xB7 updated ${O(i.updatedAt,n)} by ${j(i.updatedBy)}`];i.summary&&e.push(`summary: ${i.summary}`),i.tags.length&&e.push(`tags: ${i.tags.join(", ")}`),e.push("",`## Files (${i.files.length})`,...i.files.map(o=>it(o,i.entryPath,n)));let t=i.comments.filter(o=>o.status==="open");return t.length&&e.push("",`## Open comments (${t.length})`,...t.map(o=>re(o,n))),e.join(`
`)}function x(i){return i.encoding==="base64"?`<file path="${i.path}" revision="${i.revision}" kind="${i.kind}" encoding="base64" size="${I(i.size)}">(binary image, not shown as text)</file>`:`<file path="${i.path}" revision="${i.revision}" kind="${i.kind}">
${i.content}
</file>`}function B(i,n,e={}){let t=e.maxChars??tt,o=[...n.filter(c=>c.path===i.entryPath),...n.filter(c=>c.path!==i.entryPath)],r=[$(i,e.now)],s=r[0].length,a=[];for(let c of o){let l=x(c);if(s+l.length>t){a.push(c.path);continue}r.push(l),s+=l.length}return a.length&&r.push(`(${a.length} file(s) omitted to stay within size limits \u2014 read them by path: ${a.join(", ")})`),r.join(`

`)}function me(i,n=Date.now()){return i.length===0?"No history.":i.map(e=>{let t=e.renamedFrom?` (from ${e.renamedFrom})`:"",o=e.note?` \u2014 ${e.note}`:"";return`- #${e.id} ${e.op} ${e.path}${t} \u2192 rev ${e.revision}, ${I(e.size)}, ${j(e.actor)} ${O(e.createdAt,n)}${o}`}).join(`
`)}function W(i,n){return`To show it to the user, put this on its own line in your reply: ${X(i.id,n)}`}function U(i,n){let e=i.replace(/\s+/g," ").trim();return e.length<=n?e:`${e.slice(0,n-1)}\u2026`}var ot=/^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/,v=class extends Error{constructor(n){super(n),this.name="DesignDocPathError"}};function ge(i){if(typeof i!="string")throw new v("path must be a string");let n=i.trim().replace(/\\/g,"/");for(;n.startsWith("./");)n=n.slice(2);if(!n)throw new v("path is required");if(n.startsWith("/"))throw new v("path must be relative to the design doc");if(n.length>160)throw new v("path must be at most 160 characters");let e=n.split("/");if(e.length>6)throw new v("path must be at most 6 levels deep");for(let t of e){if(t===".."||t===".")throw new v('path must not contain "." or ".." segments');if(!ot.test(t)||t.endsWith(" ")||t.endsWith("."))throw new v(`invalid path segment ${JSON.stringify(t)}: use letters, digits, ".", "_", "-" or spaces, starting with a letter or digit`)}return e.join("/")}function he(i){let n=i.split("/").pop()??i,e=n.lastIndexOf(".");return e<=0?"":n.slice(e+1).toLowerCase()}var rt={md:"markdown",markdown:"markdown",mdx:"markdown",html:"html",htm:"html",mmd:"mermaid",mermaid:"mermaid",svg:"svg",png:"image",jpg:"image",jpeg:"image",gif:"image",webp:"image",txt:"text"},st={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp"},at={json:"json",yaml:"yaml",yml:"yaml",toml:"toml",ts:"typescript",tsx:"tsx",js:"javascript",jsx:"jsx",mjs:"javascript",py:"python",go:"go",rs:"rust",java:"java",kt:"kotlin",swift:"swift",rb:"ruby",sql:"sql",sh:"bash",css:"css",graphql:"graphql",gql:"graphql",proto:"protobuf",xml:"xml",cls:"apex",apex:"apex"};function N(i){let n=he(i),e=rt[n];return e||(at[n]?"code":"text")}function G(i){return i==="image"}function fe(i){return st[he(i)]??null}function z(i,n){let e=i.split("/"),t=n.split("/"),o=Math.min(e.length,t.length);for(let r=0;r<o;r+=1){let s=r===e.length-1,a=r===t.length-1;if(e[r]!==t[r])return s!==a?s?-1:1:e[r].localeCompare(t[r],void 0,{sensitivity:"base",numeric:!0})}return e.length-t.length}var dt=`# {{title}}

> {{summary}}

## Context

What problem are we solving, for whom, and why now? Link the evidence
(incidents, metrics, user feedback) that motivates the change.

## Goals

- \u2026

## Non-goals

- \u2026

## Proposal

A short overview of the solution. The diagram lives in
\`diagrams/architecture.mmd\`.

\`\`\`mermaid
flowchart LR
  Client --> API[Service API]
  API --> Store[(Storage)]
\`\`\`

## Detailed design

### Data model

### Interfaces & APIs

### Failure modes

## Alternatives considered

| Option | Pros | Cons |
| --- | --- | --- |
| \u2026 | \u2026 | \u2026 |

## Risks & mitigations

## Rollout & migration

## Testing strategy

## Open questions

- [ ] \u2026
`,ct=`flowchart LR
  user([User]) --> ui[Client]
  ui --> api[Service API]
  api --> db[(Database)]
  api --> queue[[Queue]]
  queue --> worker[Worker]
`,lt=`# {{title}}

> {{summary}}

## Problem

## Users & jobs to be done

## Goals & success metrics

| Metric | Today | Target |
| --- | --- | --- |
| \u2026 | \u2026 | \u2026 |

## Scope

**In scope**

- \u2026

**Out of scope**

- \u2026

## Experience

Key flows. A clickable mockup lives in \`mockups/overview.html\`.

## Requirements

| # | Requirement | Priority |
| --- | --- | --- |
| R1 | \u2026 | Must |

## Launch plan

## Open questions

- [ ] \u2026
`,ut=`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>{{title}} \u2014 mockup</title>
<style>
  :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; }
  body { margin: 0; padding: 32px; background: Canvas; color: CanvasText; }
  .card { max-width: 420px; padding: 20px 24px; border: 1px solid color-mix(in srgb, CanvasText 15%, transparent); border-radius: 12px; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { margin: 0 0 16px; opacity: 0.75; font-size: 13px; line-height: 1.5; }
  button { font: inherit; padding: 6px 14px; border-radius: 6px; border: 0; background: #2f81f7; color: white; cursor: pointer; }
</style>
</head>
<body>
  <div class="card">
    <h1>{{title}}</h1>
    <p>Replace this with the screen you are proposing.</p>
    <button type="button">Primary action</button>
  </div>
</body>
</html>
`,pt=`# {{title}}

- **Status:** Proposed
- **Deciders:** \u2026
- **Date:** \u2026

## Context

{{summary}}

## Decision

We will \u2026

## Options considered

1. **Option A** \u2014 \u2026
2. **Option B** \u2014 \u2026

## Consequences

**Positive**

- \u2026

**Negative / trade-offs**

- \u2026
`,mt=`# {{title}}

> {{summary}}

## Overview

## Resources

| Method | Path | Description |
| --- | --- | --- |
| GET | \`/v1/items\` | List items |
| POST | \`/v1/items\` | Create an item |

The full contract lives in \`api/openapi.yaml\`.

## Authentication & authorization

## Errors

## Versioning & compatibility

## Open questions

- [ ] \u2026
`,gt=`openapi: 3.1.0
info:
  title: {{title}}
  version: 0.1.0
paths:
  /v1/items:
    get:
      summary: List items
      responses:
        '200':
          description: OK
`,S=[{id:"technical",label:"Technical design",description:"RFC-style design: context, goals, proposal, alternatives, rollout.",files:[{path:"README.md",content:dt},{path:"diagrams/architecture.mmd",content:ct}]},{id:"product",label:"Product spec",description:"Problem, users, metrics, scope, requirements and an HTML mockup.",files:[{path:"README.md",content:lt},{path:"mockups/overview.html",content:ut}]},{id:"adr",label:"Decision record",description:"A single architectural decision with options and consequences.",files:[{path:"README.md",content:pt}]},{id:"api",label:"API design",description:"Resources, auth, errors and an OpenAPI contract.",files:[{path:"README.md",content:mt},{path:"api/openapi.yaml",content:gt}]},{id:"blank",label:"Blank",description:"A single README.md to start from scratch.",files:[{path:"README.md",content:`# {{title}}

{{summary}}
`}]}],ye="technical";function Ee(i){return S.find(n=>n.id===i)??null}function we(i,n){let e=n.summary.trim()||"One-paragraph summary of the proposal.";return i.files.map(t=>({path:t.path,content:t.content.replaceAll("{{title}}",n.title).replaceAll("{{summary}}",e)}))}import{randomBytes as bt}from"node:crypto";var Te=[`CREATE TABLE docs (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    project_id TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    entry_path TEXT NOT NULL DEFAULT 'README.md',
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL
  );
  CREATE INDEX docs_by_project ON docs (project_id, updated_at DESC);
  CREATE INDEX docs_by_updated ON docs (updated_at DESC);

  CREATE TABLE doc_files (
    doc_id TEXT NOT NULL,
    path TEXT NOT NULL,
    content TEXT NOT NULL,
    encoding TEXT NOT NULL DEFAULT 'utf8',
    size INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL,
    updated_by TEXT NOT NULL,
    PRIMARY KEY (doc_id, path)
  );

  CREATE TABLE doc_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id TEXT NOT NULL,
    path TEXT NOT NULL,
    revision INTEGER NOT NULL,
    op TEXT NOT NULL,
    content TEXT NOT NULL,
    encoding TEXT NOT NULL DEFAULT 'utf8',
    size INTEGER NOT NULL,
    note TEXT,
    renamed_from TEXT,
    actor TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX doc_revisions_by_file ON doc_revisions (doc_id, path, id DESC);

  CREATE TABLE doc_comments (
    id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL,
    path TEXT,
    quote TEXT,
    body TEXT NOT NULL,
    author TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  );
  CREATE INDEX doc_comments_by_doc ON doc_comments (doc_id, created_at);

  CREATE TABLE doc_threads (
    doc_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL,
    last_activity_at INTEGER NOT NULL,
    PRIMARY KEY (doc_id, thread_id)
  );
  CREATE INDEX doc_threads_by_thread ON doc_threads (thread_id);`];var d=class extends Error{constructor(e,t){super(t);this.code=e;this.name="DesignDocError"}code},ae={assistant:1,reviewer:2,editor:3,author:4},xe=`d.*,
  (SELECT COUNT(*) FROM doc_files f WHERE f.doc_id = d.id) AS file_count,
  (SELECT COUNT(*) FROM doc_comments c WHERE c.doc_id = d.id AND c.status = 'open') AS open_comments`,V=class{constructor(n,e={}){this.db=n;this.now=e.now??Date.now,this.randomId=e.randomId??(t=>`${t}${bt(6).toString("hex")}`),n.migrate(Te)}db;now;randomId;list(n={}){let e=[],t=[];n.projectId!==void 0&&(n.projectId===null?e.push("d.project_id IS NULL"):(e.push("(d.project_id = ? OR d.project_id IS NULL)"),t.push(n.projectId)));let o=n.status??"all";if(o==="active")e.push("d.status <> 'archived'");else if(o!=="all"){if(!b(o))throw new d("invalid",`unknown status ${JSON.stringify(o)}`);e.push("d.status = ?"),t.push(o)}let r=typeof n.query=="string"?n.query.trim():"";if(r){let l=`%${Me(r.toLowerCase())}%`;e.push(`(lower(d.title) LIKE ? ESCAPE '\\' OR lower(d.summary) LIKE ? ESCAPE '\\'
        OR d.slug LIKE ? ESCAPE '\\' OR lower(d.tags) LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM doc_files f WHERE f.doc_id = d.id AND f.encoding = 'utf8'
          AND lower(f.content) LIKE ? ESCAPE '\\'))`),t.push(l,l,l,l,l)}let s=ke(n.limit,50,200),a=`SELECT ${xe} FROM docs d
      ${e.length?`WHERE ${e.join(" AND ")}`:""}
      ORDER BY d.updated_at DESC, d.id LIMIT ?`;return this.db.prepare(a).all(...t,s).map(k)}find(n){let e=this.findRow(n);return e?k(e):null}summary(n){return k(this.requireRow(n))}get(n){let e=this.requireRow(n),t=this.db.prepare("SELECT doc_id, path, encoding, size, revision, updated_at, updated_by FROM doc_files WHERE doc_id = ?").all(e.id).map(M).sort((s,a)=>z(s.path,a.path)),o=this.db.prepare("SELECT * FROM doc_comments WHERE doc_id = ? ORDER BY created_at, id").all(e.id).map(Pe),r=this.db.prepare("SELECT thread_id, title, role, last_activity_at FROM doc_threads WHERE doc_id = ? ORDER BY last_activity_at DESC").all(e.id).map(Lt);return{...k(e),files:t,comments:o,threads:r}}create(n,e){let t=Ce(n.title),o=Oe(n.summary??""),r=$e(n.tags??[]),s=n.status??"draft";if(!b(s))throw new d("invalid",`unknown status ${JSON.stringify(s)}`);let a;if(n.files&&n.files.length>0)a=n.files;else{let h=Ee(n.template??ye);if(!h)throw new d("invalid",`unknown template ${JSON.stringify(n.template)}`);a=we(h,{title:t,summary:o})}if(a.length>150)throw new d("limit",`a design doc holds at most ${150} files`);let c=a.map(h=>Ne(h.path,h.content,h.encoding)),l=new Set;for(let h of c){let D=h.path.toLowerCase();if(l.has(D))throw new d("invalid",`duplicate file path ${h.path}`);l.add(D)}if(c.reduce((h,D)=>h+D.size,0)>8388608)throw new d("limit",`a design doc holds at most ${I(8388608)}`);let E=n.entryPath?A(n.entryPath):c.find(h=>h.path.toLowerCase()==="readme.md")?.path??c.find(h=>N(h.path)==="markdown")?.path??c[0].path;if(!c.some(h=>h.path===E))throw new d("invalid",`entryPath ${E} is not one of the doc's files`);let y=this.randomId("dd_"),g=this.now(),w=JSON.stringify(e);return this.db.transaction(()=>{let h=this.uniqueSlug(vt(t));this.db.prepare(`INSERT INTO docs (id, slug, title, summary, status, project_id, tags, entry_path, revision,
            created_at, updated_at, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`).run(y,h,t,o,s,n.projectId??null,JSON.stringify(r),E,g,g,w,w);for(let D of c)this.insertFile(y,D,1,g,w),this.recordRevision(y,D.path,1,"create",D,w,g,{note:"Created"});e.threadId&&this.linkThreadRow(y,e.threadId,e.label,"author",g)}),this.get(y)}update(n,e,t){let o=this.requireRow(n),r=[],s=[];if(e.title!==void 0&&(r.push("title = ?"),s.push(Ce(e.title))),e.summary!==void 0&&(r.push("summary = ?"),s.push(Oe(e.summary))),e.status!==void 0){if(!b(e.status))throw new d("invalid",`unknown status ${JSON.stringify(e.status)}`);r.push("status = ?"),s.push(e.status)}if(e.tags!==void 0&&(r.push("tags = ?"),s.push(JSON.stringify($e(e.tags)))),e.entryPath!==void 0){let a=A(e.entryPath);if(!this.fileRow(o.id,a))throw new d("invalid",`entryPath ${a} is not one of the doc's files`);r.push("entry_path = ?"),s.push(a)}return e.projectId!==void 0&&(r.push("project_id = ?"),s.push(e.projectId)),r.length===0?k(this.requireRow(o.id)):(this.db.transaction(()=>{this.db.prepare(`UPDATE docs SET ${r.join(", ")} WHERE id = ?`).run(...s,o.id),this.touch(o.id,t)}),k(this.requireRow(o.id)))}remove(n){let e=this.requireRow(n);this.db.transaction(()=>{for(let t of["doc_files","doc_revisions","doc_comments","doc_threads"])this.db.prepare(`DELETE FROM ${t} WHERE doc_id = ?`).run(e.id);this.db.prepare("DELETE FROM docs WHERE id = ?").run(e.id)})}readFile(n,e){let t=this.requireRow(n),o=A(e),r=this.fileRow(t.id,o);if(!r)throw this.missingFile(t.id,o);return{...M(r),content:r.content,encoding:r.encoding==="base64"?"base64":"utf8"}}readAllFiles(n){let e=this.requireRow(n);return this.db.prepare("SELECT * FROM doc_files WHERE doc_id = ?").all(e.id).map(t=>({...M(t),content:t.content,encoding:t.encoding==="base64"?"base64":"utf8"})).sort((t,o)=>z(t.path,o.path))}writeFile(n,e,t){let o=this.requireRow(n),r=Ne(e.path,e.content,e.encoding),s=se(e.note);return this.db.transaction(()=>{let a=this.fileRow(o.id,r.path);J(r.path,a,e.baseRevision),a||this.assertCanAdd(o.id,r.path),this.assertDocBudget(o.id,r.size-(a?.size??0));let c=this.now(),l=JSON.stringify(t),m;if(a){if(a.content===r.content&&a.encoding===r.encoding)return{...M(a),docId:o.id,created:!1};m=a.revision+1,this.db.prepare(`UPDATE doc_files SET content = ?, encoding = ?, size = ?, revision = ?, updated_at = ?, updated_by = ?
              WHERE doc_id = ? AND path = ?`).run(r.content,r.encoding,r.size,m,c,l,o.id,r.path)}else m=this.nextRevisionFor(o.id,r.path),this.insertFile(o.id,r,m,c,l);return this.recordRevision(o.id,r.path,m,a?"write":"create",r,l,c,{note:s}),this.touch(o.id,t,c),t.threadId&&this.linkThreadRow(o.id,t.threadId,t.label,"editor",c),{...M(this.fileRow(o.id,r.path)),docId:o.id,created:!a}})}editFile(n,e,t){let o=this.requireRow(n),r=A(e.path);if(!Array.isArray(e.edits)||e.edits.length===0)throw new d("invalid","edits must be a non-empty array");if(e.edits.length>50)throw new d("limit",`at most ${50} edits per call`);return this.db.transaction(()=>{let s=this.fileRow(o.id,r);if(!s)throw this.missingFile(o.id,r);if(s.encoding==="base64")throw new d("invalid",`${r} is a binary file; write it whole instead of editing`);J(r,s,e.baseRevision);let a=Rt(s.content,e.edits,r);return this.writeFile(o.id,{path:r,content:a,baseRevision:s.revision,note:e.note},t)})}deleteFile(n,e,t,o={}){let r=this.requireRow(n),s=A(e);this.db.transaction(()=>{let a=this.fileRow(r.id,s);if(!a)throw this.missingFile(r.id,s);if(J(s,a,o.baseRevision),this.fileCount(r.id)<=1)throw new d("invalid","a design doc must keep at least one file");let l=this.now(),m=JSON.stringify(t);if(this.db.prepare("DELETE FROM doc_files WHERE doc_id = ? AND path = ?").run(r.id,s),this.recordRevision(r.id,s,a.revision+1,"delete",a,m,l,{note:se(o.note)}),r.entry_path===s){let E=this.firstFilePath(r.id);this.db.prepare("UPDATE docs SET entry_path = ? WHERE id = ?").run(E,r.id)}this.touch(r.id,t,l),t.threadId&&this.linkThreadRow(r.id,t.threadId,t.label,"editor",l)})}renameFile(n,e,t,o,r={}){let s=this.requireRow(n),a=A(e),c=A(t);if(a===c)throw new d("invalid","renameTo must differ from path");return this.db.transaction(()=>{let l=this.fileRow(s.id,a);if(!l)throw this.missingFile(s.id,a);if(J(a,l,r.baseRevision),G(N(a))!==G(N(c)))throw new d("invalid",`cannot rename ${a} to ${c}: the file type would change encoding`);let m=this.caseInsensitiveClash(s.id,c,a);if(m)throw new d("conflict",`${m} already exists in this design doc`);let E=this.now(),y=JSON.stringify(o),g=se(r.note),w=l.revision+1;this.db.prepare("DELETE FROM doc_files WHERE doc_id = ? AND path = ?").run(s.id,a),this.recordRevision(s.id,a,w,"delete",l,y,E,{note:g??`Renamed to ${c}`});let h=this.nextRevisionFor(s.id,c),D={path:c,content:l.content,encoding:l.encoding,size:l.size};return this.insertFile(s.id,D,h,E,y),this.recordRevision(s.id,c,h,"rename",D,y,E,{note:g,renamedFrom:a}),s.entry_path===a&&this.db.prepare("UPDATE docs SET entry_path = ? WHERE id = ?").run(c,s.id),this.touch(s.id,o,E),o.threadId&&this.linkThreadRow(s.id,o.threadId,o.label,"editor",E),{...M(this.fileRow(s.id,c)),docId:s.id,created:!0}})}history(n,e={}){let t=this.requireRow(n),o=ke(e.limit,50,100),r="id, doc_id, path, revision, op, size, note, renamed_from, actor, created_at";return(e.path?this.db.prepare(`SELECT ${r} FROM doc_revisions WHERE doc_id = ? AND path = ? ORDER BY id DESC LIMIT ?`).all(t.id,A(e.path),o):this.db.prepare(`SELECT ${r} FROM doc_revisions WHERE doc_id = ? ORDER BY id DESC LIMIT ?`).all(t.id,o)).map(Fe)}revisionContent(n,e){let t=this.requireRow(n),o=this.revisionRow(t.id,e);return{...Fe(o),content:o.content,encoding:o.encoding==="base64"?"base64":"utf8"}}restoreRevision(n,e,t){let o=this.requireRow(n),r=this.revisionRow(o.id,e);return this.writeFile(o.id,{path:r.path,content:r.content,encoding:r.encoding==="base64"?"base64":"utf8",note:`Restored revision ${r.revision}`},t)}addComment(n,e,t){let o=this.requireRow(n),r=typeof e.body=="string"?e.body.trim():"";if(!r)throw new d("invalid","comment body is required");if(r.length>8e3)throw new d("limit",`comment body must be at most ${8e3} characters`);let s=e.path?A(e.path):null;if(s&&!this.fileRow(o.id,s))throw this.missingFile(o.id,s);let a=typeof e.quote=="string"&&e.quote.trim()?e.quote.trim().slice(0,500):null,c=this.randomId("c_"),l=this.now();return this.db.transaction(()=>{if(this.db.prepare("SELECT COUNT(*) AS n FROM doc_comments WHERE doc_id = ?").get(o.id).n>=500)throw new d("limit",`a design doc holds at most ${500} comments; delete resolved ones first`);this.db.prepare(`INSERT INTO doc_comments (id, doc_id, path, quote, body, author, status, created_at, resolved_at)
            VALUES (?, ?, ?, ?, ?, ?, 'open', ?, NULL)`).run(c,o.id,s,a,r,JSON.stringify(t),l),this.touch(o.id,t,l),t.threadId&&this.linkThreadRow(o.id,t.threadId,t.label,"reviewer",l)}),this.commentById(o.id,c)}setCommentStatus(n,e,t,o){let r=this.requireRow(n);if(t!=="open"&&t!=="resolved")throw new d("invalid",`unknown comment status ${JSON.stringify(t)}`);let s=String(e??""),a=this.now();return this.db.transaction(()=>{if(this.db.prepare("UPDATE doc_comments SET status = ?, resolved_at = ? WHERE doc_id = ? AND id = ?").run(t,t==="resolved"?a:null,r.id,s).changes===0)throw new d("not_found",`comment ${s} not found in ${r.slug}`);this.touch(r.id,o,a)}),this.commentById(r.id,s)}deleteComment(n,e,t){let o=this.requireRow(n),r=String(e??"");this.db.transaction(()=>{if(this.db.prepare("DELETE FROM doc_comments WHERE doc_id = ? AND id = ?").run(o.id,r).changes===0)throw new d("not_found",`comment ${r} not found in ${o.slug}`);this.touch(o.id,t)})}linkThread(n,e,t,o){let r=this.requireRow(n);this.db.transaction(()=>this.linkThreadRow(r.id,e,t,o,this.now()))}unlinkThread(n,e){let t=this.requireRow(n);this.db.prepare("DELETE FROM doc_threads WHERE doc_id = ? AND thread_id = ?").run(t.id,e)}touchThread(n,e){let t=this.docsForThread(n);if(t.length===0)return t;let o=this.now(),r=e?.trim().slice(0,140)??"";return this.db.prepare("UPDATE doc_threads SET last_activity_at = ?, title = CASE WHEN ? <> '' THEN ? ELSE title END WHERE thread_id = ?").run(o,r,r,n),t}forgetThread(n){let e=this.docsForThread(n);return e.length&&this.db.prepare("DELETE FROM doc_threads WHERE thread_id = ?").run(n),e}docsForThread(n){return this.db.prepare("SELECT doc_id FROM doc_threads WHERE thread_id = ?").all(n).map(e=>e.doc_id)}findRow(n){if(typeof n!="string"||!n.trim())return null;let e=n.trim();return this.db.prepare(`SELECT ${xe} FROM docs d WHERE d.id = ? OR d.slug = ? LIMIT 1`).get(e,e.toLowerCase())??null}requireRow(n){let e=this.findRow(n);if(!e)throw new d("not_found",`design doc ${JSON.stringify(n)} not found; list docs to get a valid id or slug`);return e}fileRow(n,e){return this.db.prepare("SELECT * FROM doc_files WHERE doc_id = ? AND path = ?").get(n,e)??null}fileCount(n){return this.db.prepare("SELECT COUNT(*) AS n FROM doc_files WHERE doc_id = ?").get(n).n}firstFilePath(n){let e=this.db.prepare("SELECT path FROM doc_files WHERE doc_id = ?").all(n).map(t=>t.path).sort(z);return e.find(t=>t.toLowerCase()==="readme.md")??e.find(t=>N(t)==="markdown")??e[0]}missingFile(n,e){let t=this.db.prepare("SELECT path FROM doc_files WHERE doc_id = ? ORDER BY path LIMIT 40").all(n).map(o=>o.path);return new d("not_found",`${e} not found; files: ${t.join(", ")||"(none)"}`)}caseInsensitiveClash(n,e,t){return this.db.prepare("SELECT path FROM doc_files WHERE doc_id = ? AND lower(path) = lower(?) AND path <> ? LIMIT 1").get(n,e,t??"")?.path??null}assertCanAdd(n,e){let t=this.caseInsensitiveClash(n,e);if(t)throw new d("conflict",`${t} already exists with different letter case`);if(this.fileCount(n)>=150)throw new d("limit",`a design doc holds at most ${150} files`)}assertDocBudget(n,e){if(e<=0)return;if(this.db.prepare("SELECT COALESCE(SUM(size), 0) AS n FROM doc_files WHERE doc_id = ?").get(n).n+e>8388608)throw new d("limit",`a design doc holds at most ${I(8388608)} of files`)}nextRevisionFor(n,e){return(this.db.prepare("SELECT MAX(revision) AS n FROM doc_revisions WHERE doc_id = ? AND path = ?").get(n,e).n??0)+1}insertFile(n,e,t,o,r){this.db.prepare(`INSERT INTO doc_files (doc_id, path, content, encoding, size, revision, updated_at, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(n,e.path,e.content,e.encoding,e.size,t,o,r)}recordRevision(n,e,t,o,r,s,a,c={}){this.db.prepare(`INSERT INTO doc_revisions (doc_id, path, revision, op, content, encoding, size, note, renamed_from, actor, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(n,e,t,o,r.content,r.encoding,r.size,c.note??null,c.renamedFrom??null,s,a);let l=r.encoding==="base64"?3:25;this.db.prepare(`DELETE FROM doc_revisions WHERE doc_id = ? AND path = ? AND id NOT IN (
          SELECT id FROM doc_revisions WHERE doc_id = ? AND path = ? ORDER BY id DESC LIMIT ?)`).run(n,e,n,e,l),this.pruneHistoryBytes(n)}pruneHistoryBytes(n){let e=this.db.prepare("SELECT COALESCE(SUM(size), 0) AS n FROM doc_revisions WHERE doc_id = ?").get(n).n;if(e<=25165824)return;let t=this.db.prepare("SELECT id, size FROM doc_revisions WHERE doc_id = ? ORDER BY id ASC").all(n),o=e-25165824,r=this.db.prepare("DELETE FROM doc_revisions WHERE id = ?");for(let s of t.slice(0,-1)){if(o<=0)break;r.run(s.id),o-=s.size}}touch(n,e,t=this.now()){this.db.prepare("UPDATE docs SET revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ?").run(t,JSON.stringify(e),n)}linkThreadRow(n,e,t,o,r){let s=this.db.prepare("SELECT role, title FROM doc_threads WHERE doc_id = ? AND thread_id = ?").get(n,e),a=s&&(ae[s.role]??0)>=ae[o]?s.role:o,c=t.trim()||s?.title||"";this.db.prepare(`INSERT INTO doc_threads (doc_id, thread_id, title, role, last_activity_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (doc_id, thread_id) DO UPDATE SET title = excluded.title, role = excluded.role,
          last_activity_at = excluded.last_activity_at`).run(n,e,c.slice(0,140),a,r),this.db.prepare(`DELETE FROM doc_threads WHERE doc_id = ? AND thread_id NOT IN (
          SELECT thread_id FROM doc_threads WHERE doc_id = ? ORDER BY last_activity_at DESC LIMIT ?)`).run(n,n,50)}revisionRow(n,e){let t=Number(e),o=Number.isInteger(t)?this.db.prepare("SELECT * FROM doc_revisions WHERE doc_id = ? AND id = ?").get(n,t):void 0;if(!o)throw new d("not_found",`revision ${String(e)} not found`);return o}commentById(n,e){return Pe(this.db.prepare("SELECT * FROM doc_comments WHERE doc_id = ? AND id = ?").get(n,e))}uniqueSlug(n){let e=new Set(this.db.prepare("SELECT slug FROM docs WHERE slug = ? OR slug LIKE ? ESCAPE '\\'").all(n,`${Me(n)}-%`).map(t=>t.slug));if(!e.has(n))return n;for(let t=2;;t+=1){let o=`${n}-${t}`;if(!e.has(o))return o}}};function vt(i){return i.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,48).replace(/-+$/g,"")||"design-doc"}function Rt(i,n,e){let t=i;return n.forEach((o,r)=>{let s=n.length>1?` (edit ${r+1})`:"";if(!o||typeof o.oldText!="string"||typeof o.newText!="string")throw new d("invalid",`each edit needs string oldText and newText${s}`);if(!o.oldText)throw new d("invalid",`oldText must not be empty${s}`);if(o.oldText===o.newText)throw new d("invalid",`oldText and newText are identical${s}`);let a=At(t,o.oldText);if(a===0)throw new d("conflict",`oldText not found in ${e}${s}; re-read the file and match its text exactly, including whitespace`);if(a>1&&!o.replaceAll)throw new d("conflict",`oldText matches ${a} places in ${e}${s}; include more surrounding text or set replaceAll`);t=o.replaceAll?t.split(o.oldText).join(o.newText):t.replace(o.oldText,()=>o.newText)}),t}function At(i,n){let e=0,t=i.indexOf(n);for(;t!==-1;)e+=1,t=i.indexOf(n,t+n.length);return e}function A(i){try{return ge(i)}catch(n){throw n instanceof v?new d("invalid",n.message):n}}function Ne(i,n,e){let t=A(i);if(typeof n!="string")throw new d("invalid",`content for ${t} must be a string`);let o=G(N(t)),r=e??(o?"base64":"utf8");if(o&&r!=="base64")throw new d("invalid",`${t} is an image; send its bytes base64-encoded`);if(!o&&r!=="utf8")throw new d("invalid",`${t} is a text file; send it as UTF-8 text`);if(r==="base64"){let a=n.replace(/\s+/g,"");if(!/^[A-Za-z0-9+/]*={0,2}$/.test(a)||a.length%4!==0)throw new d("invalid",`content for ${t} is not valid base64`);let c=Buffer.from(a,"base64").length;if(c>2097152)throw new d("limit",`${t} exceeds the ${I(2097152)} image limit`);return{path:t,content:a,encoding:"base64",size:c}}let s=Buffer.byteLength(n,"utf8");if(s>262144)throw new d("limit",`${t} exceeds the ${I(262144)} file limit; split it into several files`);return{path:t,content:n,encoding:"utf8",size:s}}function J(i,n,e){if(e==null)return;if(!Number.isInteger(e)||e<0)throw new d("invalid","baseRevision must be a non-negative integer");let t=n?.revision??0;if(t!==e)throw new d("conflict",n?`${i} changed since revision ${e} (now ${t}, last edited by ${F(n.updated_by).label}); re-read it and reapply your change`:`${i} does not exist (expected revision ${e}); re-read the doc`)}function Ce(i){let n=typeof i=="string"?i.replace(/\s+/g," ").trim():"";if(!n)throw new d("invalid","title is required");if(n.length>140)throw new d("invalid",`title must be at most ${140} characters`);return n}function Oe(i){let n=typeof i=="string"?i.trim():"";if(n.length>600)throw new d("invalid",`summary must be at most ${600} characters`);return n}function $e(i){if(!Array.isArray(i))throw new d("invalid","tags must be an array of strings");let n=[];for(let e of i){if(typeof e!="string")throw new d("invalid","tags must be an array of strings");let t=e.trim().toLowerCase().replace(/\s+/g,"-");if(t){if(t.length>32)throw new d("invalid",`tag ${JSON.stringify(t)} is longer than ${32} characters`);n.includes(t)||n.push(t)}}if(n.length>12)throw new d("invalid",`at most ${12} tags`);return n}function se(i){if(typeof i!="string")return null;let n=i.replace(/\s+/g," ").trim();return n?n.slice(0,200):null}function ke(i,n,e){let t=typeof i=="number"?Math.floor(i):Number.NaN;return!Number.isFinite(t)||t<=0?n:Math.min(t,e)}function Me(i){return i.replace(/[\\%_]/g,n=>`\\${n}`)}function F(i){try{let n=JSON.parse(i);return{kind:n.kind==="agent"?"agent":"user",label:typeof n.label=="string"&&n.label?n.label:"Unknown",threadId:typeof n.threadId=="string"?n.threadId:null}}catch{return{kind:"user",label:"Unknown",threadId:null}}}function It(i){try{let n=JSON.parse(i);return Array.isArray(n)?n.filter(e=>typeof e=="string"):[]}catch{return[]}}function k(i){return{id:i.id,slug:i.slug,title:i.title,summary:i.summary,status:b(i.status)?i.status:"draft",projectId:i.project_id,tags:It(i.tags),entryPath:i.entry_path,fileCount:Number(i.file_count??0),openComments:Number(i.open_comments??0),revision:i.revision,createdAt:i.created_at,updatedAt:i.updated_at,createdBy:F(i.created_by),updatedBy:F(i.updated_by)}}function M(i){return{path:i.path,kind:N(i.path),size:i.size,revision:i.revision,updatedAt:i.updated_at,updatedBy:F(i.updated_by)}}function Fe(i){return{id:i.id,path:i.path,revision:i.revision,op:["create","write","delete","rename"].includes(i.op)?i.op:"write",size:i.size,note:i.note,renamedFrom:i.renamed_from,actor:F(i.actor),createdAt:i.created_at}}function Pe(i){return{id:i.id,docId:i.doc_id,path:i.path,quote:i.quote,body:i.body,author:F(i.author),status:i.status==="resolved"?"resolved":"open",createdAt:i.created_at,resolvedAt:i.resolved_at}}function Lt(i){let n=i.role;return{threadId:i.thread_id,title:i.title,role:n in ae?n:"assistant",lastActivityAt:i.last_activity_at}}function f(i){return i&&typeof i=="object"&&!Array.isArray(i)?i:{}}function p(i,n){let e=i[n];if(typeof e!="string"||!e.trim())throw new d("invalid",`${n} is required`);return e}function u(i,n){let e=i[n];if(e!=null){if(typeof e!="string")throw new d("invalid",`${n} must be a string`);return e}}function de(i,n){let e=i[n];if(e==null||e==="")return;let t=typeof e=="string"?Number(e):e;if(typeof t!="number"||!Number.isInteger(t))throw new d("invalid",`${n} must be an integer`);return t}function je(i,n){let e=i[n];if(e!=null){if(typeof e=="string")return e.split(",").map(t=>t.trim()).filter(Boolean);if(!Array.isArray(e)||e.some(t=>typeof t!="string"))throw new d("invalid",`${n} must be an array of strings`);return e}}function Ue(i,n){let e=u(i,n);if(e!==void 0){if(!b(e))throw new d("invalid",`${n} must be one of ${L.join(", ")}`);return e}}function Q(i,n){let e=f(n),t=u(e,"scope")??"project";if(t!=="project"&&t!=="all")throw new d("invalid","scope must be project or all");let o=u(e,"status")??"active";if(o!=="active"&&o!=="all"&&!b(o))throw new d("invalid",`status must be active, all, or one of ${L.join(", ")}`);let r=i.store.list({projectId:t==="project"&&i.projectId?i.projectId:void 0,query:u(e,"query"),status:o,limit:de(e,"limit")});return`${t==="project"&&i.projectId?"Design docs for this project (plus global docs), newest first:":"Design docs across all projects, newest first:"}
${pe(r)}`}function ee(i,n){let e=f(n),t=p(e,"doc"),o=u(e,"path"),r=i.store.get(t);if(o){let a=i.store.readFile(r.id,o),c=`${x(a)}

To change it, call design_doc_write with doc="${r.id}", path="${a.path}", baseRevision=${a.revision}.`,l=a.encoding==="base64"?fe(a.path):null;return l?{content:[{type:"text",text:c},{type:"image",data:a.content,mimeType:l}]}:c}if(e.includeAll===!0||e.includeAll==="true")return`${B(r,i.store.readAllFiles(r.id))}

${W(r)}`;let s=r.files.some(a=>a.path===r.entryPath)?x(i.store.readFile(r.id,r.entryPath)):"";return[$(r),s?`## Entry file
${s}`:"",'Read other files with design_doc_read path="\u2026", or everything at once with includeAll=true.',W(r)].filter(Boolean).join(`

`)}function te(i,n,e){let t=f(n),o=u(t,"template");if(o&&!S.some(c=>c.id===o))throw new d("invalid",`template must be one of ${S.map(c=>c.id).join(", ")}`);let r=t.files;if(r!==void 0&&!Array.isArray(r))throw new d("invalid","files must be an array");let s=t.global===!0||t.global==="true",a=i.store.create({title:p(t,"title"),summary:u(t,"summary"),tags:je(t,"tags"),status:Ue(t,"status"),template:o,files:r?.map((c,l)=>{let m=f(c);if(typeof m.path!="string"||typeof m.content!="string")throw new d("invalid",`files[${l}] needs string path and content`);let E=m.encoding==="base64"?"base64":void 0;return{path:m.path,content:m.content,encoding:E}}),projectId:s?null:i.projectId??null},e);return i.changed(a.id),`Created design doc ${a.id} ("${a.title}").

${$(a)}

${W(a)}`}function C(i,n,e){let t=f(n),o=p(t,"doc"),r=p(t,"path"),s=de(t,"baseRevision"),a=u(t,"note"),c=u(t,"content"),l=u(t,"renameTo"),m=t.delete===!0||t.delete==="true",E=t.edits;if([c!==void 0,E!==void 0,m,l!==void 0].filter(Boolean).length!==1)throw new d("invalid","pass exactly one of content, edits, delete or renameTo");let g=i.store.summary(o);if(m)return i.store.deleteFile(g.id,r,e,{baseRevision:s,note:a}),i.changed(g.id),`Deleted ${r} from ${g.id}. It stays in history and can be restored from the Design Docs panel.`;if(l!==void 0){let D=i.store.renameFile(g.id,r,l,e,{baseRevision:s,note:a});return i.changed(D.docId),`Renamed ${r} to ${D.path} (rev ${D.revision}).`}let w;if(E!==void 0){if(!Array.isArray(E))throw new d("invalid","edits must be an array");w=i.store.editFile(g.id,{path:r,edits:E,baseRevision:s,note:a},e)}else{let D=t.encoding==="base64"?"base64":void 0;w=i.store.writeFile(g.id,{path:r,content:c,encoding:D,baseRevision:s,note:a},e)}return i.changed(w.docId),`${w.created?"Created":"Updated"} ${w.path} in ${w.docId} \u2192 revision ${w.revision}. Use baseRevision=${w.revision} for your next change to this file. The user sees updates live in the Design Docs panel.`}function ne(i,n,e){let t=f(n),o=p(t,"doc"),r=i.store.update(o,{title:u(t,"title"),summary:u(t,"summary"),status:Ue(t,"status"),tags:je(t,"tags"),entryPath:u(t,"entryPath")},e);return i.changed(r.id),`Updated ${r.id}: "${r.title}" \xB7 ${r.status} \xB7 tags: ${r.tags.join(", ")||"none"} \xB7 entry: ${r.entryPath}`}function q(i,n,e){let t=f(n),o=p(t,"doc"),r=u(t,"resolve"),s=u(t,"reopen");if(r||s){let c=i.store.setCommentStatus(o,r??s,r?"resolved":"open",e);i.changed(c.docId);let l=u(t,"body");return l?.trim()&&i.store.addComment(o,{body:l,path:c.path,quote:c.quote},e),`${r?"Resolved":"Reopened"} comment ${c.id}.${l?.trim()?" Added your reply as a new comment.":""}`}let a=i.store.addComment(o,{body:p(t,"body"),path:u(t,"path"),quote:u(t,"quote")},e);return i.changed(a.docId),`Added comment ${a.id}.
${re(a)}`}function qe(i,n){let e=f(n),t=p(e,"doc");return me(i.store.history(t,{path:u(e,"path"),limit:de(e,"limit")}))}var Nt="design-docs",ie=[{name:"list",summary:"List design docs",usage:"list [--query <text>] [--status active|all|<status>] [--all-projects] [--json]"},{name:"show",summary:"Show a doc manifest and its entry file",usage:"show <doc> [--all] [--json]"},{name:"read",summary:"Print one file raw",usage:"read <doc> <path>"},{name:"create",summary:"Create a design doc",usage:"create --title <title> [--summary <text>] [--template technical|product|adr|api|blank] [--tags a,b] [--global]"},{name:"write",summary:"Write a whole file (creates it if missing)",usage:"write <doc> <path> (--file <local-path> | --content <text>) [--base-revision <n>] [--note <text>]"},{name:"edit",summary:"Exact-match replace inside a file",usage:"edit <doc> <path> --old <text> --new <text> [--replace-all] [--base-revision <n>] [--note <text>]"},{name:"rm",summary:"Delete a file (kept in history)",usage:"rm <doc> <path> [--base-revision <n>]"},{name:"mv",summary:"Rename a file",usage:"mv <doc> <from> <to> [--base-revision <n>]"},{name:"update",summary:"Change title, summary, status, tags or entry file",usage:"update <doc> [--title <t>] [--summary <s>] [--status <status>] [--tags a,b] [--entry <path>]"},{name:"comment",summary:"Add a review comment",usage:"comment <doc> <body> [--path <file>] [--quote <text>]"},{name:"resolve",summary:"Resolve a comment",usage:"resolve <doc> <comment-id> [--note <reply>]"},{name:"history",summary:"Show revision history",usage:"history <doc> [--path <file>] [--limit <n>]"},{name:"export",summary:"Print every file as one bundle",usage:"export <doc> [--json]"}],Ct=new Set(["json","all","all-projects","global","replace-all","help"]);function Ot(i){let n=[],e={};for(let t=0;t<i.length;t+=1){let o=i[t];if(o==="--"){n.push(...i.slice(t+1));break}if(o.startsWith("--")){let r=o.slice(2),s=r.indexOf("=");if(s!==-1)e[r.slice(0,s)]=r.slice(s+1);else if(Ct.has(r))e[r]=!0;else{let a=i[t+1];if(a===void 0)throw new d("invalid",`--${r} needs a value`);e[r]=a,t+=1}}else o==="-h"?e.help=!0:n.push(o)}return{positional:n,flags:e}}function ce(){let i=Math.max(...ie.map(n=>n.name.length));return["zcc design-docs \u2014 design documents your agents can read and edit","","Commands:",...ie.map(n=>`  ${n.name.padEnd(i)}  ${n.summary}`),"","Usage:",...ie.map(n=>`  zcc design-docs ${n.usage}`),"","<doc> is a design doc id (dd_\u2026) or slug."].join(`
`)}var $t={kind:"user",label:"CLI",threadId:null};function T(i,n){let e=i[n];return typeof e=="string"?e:void 0}function _(i,n,e){let t=i[n];if(!t)throw new d("invalid",`missing <${e}>; see zcc design-docs help`);return t}async function kt(i,n,e){try{let t=await Mt(i,n,e);return{exitCode:0,stdout:t.endsWith(`
`)?t:`${t}
`}}catch(t){let o=t instanceof Error?t.message:String(t);return{exitCode:t instanceof d&&t.code==="invalid"?2:1,stderr:`${o}
`}}}async function Mt(i,n,e){let[t,...o]=n;if(!t||t==="help"||t==="--help"||t==="-h")return ce();let{positional:r,flags:s}=Ot(o);if(s.help)return ce();let a={store:i.store,changed:i.changed,projectId:e.projectId??null},c=async()=>e.threadId?i.actorFor(e.threadId):$t,l=T(s,"base-revision"),m=T(s,"note"),E=s.json===!0;switch(t){case"list":{let y=s["all-projects"]===!0?"all":"project";if(E){let g=i.store.list({projectId:y==="project"&&e.projectId?e.projectId:void 0,query:T(s,"query"),status:T(s,"status")??"active"});return JSON.stringify(g,null,2)}return Q(a,{query:T(s,"query"),status:T(s,"status"),scope:y})}case"show":{let y=_(r,0,"doc");if(E)return JSON.stringify(i.store.get(y),null,2);let g=ee(a,{doc:y,includeAll:s.all===!0});return typeof g=="string"?g:g.content.map(w=>"text"in w?w.text:"").join(`
`)}case"read":return i.store.readFile(_(r,0,"doc"),_(r,1,"path")).content;case"create":return te(a,{title:T(s,"title")??r.join(" "),summary:T(s,"summary"),template:T(s,"template"),tags:T(s,"tags"),status:T(s,"status"),global:s.global===!0},await c());case"write":{let y=_(r,0,"doc"),g=_(r,1,"path"),w=T(s,"file"),h=T(s,"content");if(w!==void 0&&h!==void 0)throw new d("invalid","pass either --file or --content, not both");if(w!==void 0){if(!e.threadId)throw new d("invalid","--file needs an agent thread; use --content instead");h=await i.readLocalFile({threadId:e.threadId,path:w,cwd:e.cwd})}if(h===void 0)throw new d("invalid","write needs --file <path> or --content <text>");return C(a,{doc:y,path:g,content:h,baseRevision:l,note:m},await c())}case"edit":{let y=T(s,"old"),g=T(s,"new");if(y===void 0||g===void 0)throw new d("invalid","edit needs --old <text> and --new <text>");return C(a,{doc:_(r,0,"doc"),path:_(r,1,"path"),edits:[{oldText:y,newText:g,replaceAll:s["replace-all"]===!0}],baseRevision:l,note:m},await c())}case"rm":return C(a,{doc:_(r,0,"doc"),path:_(r,1,"path"),delete:!0,baseRevision:l,note:m},await c());case"mv":return C(a,{doc:_(r,0,"doc"),path:_(r,1,"from"),renameTo:_(r,2,"to"),baseRevision:l,note:m},await c());case"update":return ne(a,{doc:_(r,0,"doc"),title:T(s,"title"),summary:T(s,"summary"),status:T(s,"status"),tags:T(s,"tags"),entryPath:T(s,"entry")},await c());case"comment":return q(a,{doc:_(r,0,"doc"),body:r.slice(1).join(" ")||T(s,"body"),path:T(s,"path"),quote:T(s,"quote")},await c());case"resolve":return q(a,{doc:_(r,0,"doc"),resolve:_(r,1,"comment-id"),body:m},await c());case"history":return qe(a,{doc:_(r,0,"doc"),path:T(s,"path"),limit:T(s,"limit")});case"export":{let y=_(r,0,"doc"),g=i.store.get(y),w=i.store.readAllFiles(g.id);return E?JSON.stringify({...g,files:w},null,2):B(g,w,{maxChars:Number.MAX_SAFE_INTEGER})}default:throw new d("invalid",`unknown command "${t}"

${ce()}`)}}function He(i,n){i.cli.register({name:Nt,summary:"Read and edit design docs (specs, RFCs, ADRs) shared with your agents",commands:ie.map(e=>({...e})),run:(e,t)=>kt(n,e,t)})}function Xe(i){return async({threadId:n,path:e,cwd:t})=>{let o=await i.threads.get({threadId:n});if(!o)throw new d("not_found",`thread ${n} not found`);let r=St(e)?e:t?xt(t,e):e,s=await i.files.read({hostId:o.hostId,path:r,...t?{rootPath:t}:{}});if(s.contentEncoding!=="utf8")throw new d("invalid",`${e} is not a text file`);return s.content}}var Ft=4e3,Be=12,Pt=10,We=24e3,Ge=["## Design docs","The user keeps design documents (specs, RFCs, ADRs, product docs) in the Design Docs plugin. Each doc is a small set of files \u2014 markdown, mermaid `.mmd` diagrams, self-contained `.html` mockups, code samples \u2014 rendered as formatted pages the user reviews.","- Use the `design_doc_*` tools (or `zcc design-docs \u2026` from a shell) to list, read, create and edit them. Read a doc before changing it; prefer `edits` over rewriting whole files and pass `baseRevision`.","- Treat open comments as review feedback: address them, then resolve them with a short note.","- When the user asks for a design, spec, RFC or plan worth keeping, offer to write it as a design doc instead of only replying in chat.",`- To show a doc in your reply, write its card on its own line: ${X("<id>")}`].join(`
`);function jt(i,n){let e=i.list({projectId:n||void 0,status:"active",limit:Be+1});if(e.length===0)return`${Ge}

There are no design docs for this project yet.`;let t=[Ge,"","Design docs for this project (newest first):"],o=t.join(`
`).length,r=0;for(let s of e.slice(0,Be)){let a=s.openComments?` \xB7 ${s.openComments} open comment${s.openComments===1?"":"s"}`:"",c=s.summary?` \u2014 ${U(s.summary,110)}`:"",l=`- ${s.id} "${U(s.title,80)}" (${P[s.status]}${a})${c}`;if(o+l.length+80>Ft)break;t.push(l),o+=l.length+1,r+=1}return e.length>r&&t.push("- \u2026 more: call design_doc_list"),t.join(`
`)}function ze(i,n,e=()=>{}){i.agents.contributeInstructions(t=>{try{return jt(n,t.projectId||null)}catch(o){return e(`design docs instructions failed: ${o instanceof Error?o.message:String(o)}`),null}}),i.ui.registerMentionProvider({id:"design-doc",label:"Design docs",search(t){let o=typeof t=="string"?t:t.query,r=typeof t=="string"?void 0:t.projectId;return n.list({projectId:r||void 0,query:o,status:"active",limit:Pt}).map(s=>({id:s.id,label:`${s.title} \xB7 ${P[s.status]}`}))},resolve(t){let o=n.get(t),r=o.files.some(a=>a.path===o.entryPath)?n.readFile(o.id,o.entryPath):null,s=r?r.content.length>We&&r.encoding==="utf8"?`${x({...r,content:r.content.slice(0,We)})}
(truncated \u2014 read the rest with design_doc_read)`:x(r):"";return{context:[`The user referenced design doc ${o.id}. Its current state:`,$(o),s,`Read other files with design_doc_read doc="${o.id}" path="\u2026"; edit with design_doc_write.`].filter(Boolean).join(`

`)}}})}var Ut=[{id:"review",label:"Review",description:"Critical review with anchored comments",icon:"MessageSquareText",instruction:"Review this design doc critically, as a senior engineer would before approving it. Leave one review comment per issue with design_doc_comment (anchor it with path and an exact quote) covering gaps, risks, ambiguities, contradictions and missing alternatives. Do not rewrite the doc yourself. Finish with a short summary of the most important issues."},{id:"address",label:"Address comments",description:"Apply the open review feedback",icon:"CheckCheck",instruction:"Address every open review comment on this design doc: make the edits each one asks for (or explain why not), then resolve each comment with design_doc_comment resolve=<id> and a one-line body describing what changed."},{id:"complete",label:"Fill the gaps",description:"Complete empty or placeholder sections",icon:"WandSparkles",instruction:"Complete the sections of this design doc that are empty, placeholders (\u2026) or thin. Keep the author's intent and voice, ground statements in this project's code where relevant, and mark assumptions explicitly as **Assumption:**."},{id:"diagram",label:"Add diagrams",description:"Mermaid architecture, flow and sequence diagrams",icon:"Workflow",instruction:"Add mermaid diagrams that make this design easier to understand: architecture/components, the main data flow, and the key sequence(s). Put each larger diagram in diagrams/<name>.mmd and embed small ones inline as ```mermaid blocks where they help the narrative. Make sure every diagram parses."},{id:"ground",label:"Check against code",description:"Verify claims against this project's code",icon:"ScanSearch",instruction:"Check this design doc against the project's actual codebase. Correct inaccurate statements, name the real files, modules and APIs involved, and leave a comment wherever the design conflicts with how the code works today."},{id:"plan",label:"Implementation plan",description:"Milestones, tasks, risks and tests",icon:"ListChecks",instruction:"Turn this design into an implementation plan. Add a plan.md file with milestones, ordered tasks (each small enough for one pull request), dependencies, risks and a test strategy, grounded in this project's code. Link plan.md from the README."}];function Ye(i){return Ut.find(n=>n.id===i)??null}var le=4e3;function Ke(i){let n=i.path?` Focus on ${i.path}.`:"",e=[i.action?.instruction,i.prompt?.trim()].filter(Boolean).join(`

`);return[`You are working on the design doc "${i.doc.title}" (id ${i.doc.id}) in the Design Docs plugin.${n}`,e,`Start with design_doc_read doc="${i.doc.id}" to see its files and open comments. Make changes in the doc itself with design_doc_write (prefer small edits with baseRevision) and design_doc_comment, rather than pasting long content into chat. The user is watching the doc update live. When you finish, summarise what you changed and end with ::design-doc{id="${i.doc.id}"} on its own line.`].filter(Boolean).join(`

`)}var R={kind:"user",label:"You",threadId:null};function H(i,n){let e=i[n];if(e!=null){if(typeof e!="number"||!Number.isInteger(e))throw new d("invalid",`${n} must be an integer`);return e}}function Je(i,n){let e=i[n];if(e!==void 0){if(!Array.isArray(e)||e.some(t=>typeof t!="string"))throw new d("invalid",`${n} must be an array of strings`);return e}}function qt(i,n="Design doc from chat"){let e=i.split(`
`).map(r=>r.trim()).filter(Boolean),o=(e.find(r=>/^#{1,3}\s+\S/.test(r))??e[0]??"").replace(/^#+\s*|^[-*>]\s+/,"").replace(/[*_`[\]]/g,"").trim();return o?o.length>80?`${o.slice(0,79).trimEnd()}\u2026`:o:n}function Ht(i){let{store:n,changed:e}=i;return{templates:()=>S.map(({id:t,label:o,description:r,files:s})=>({id:t,label:o,description:r,files:s.map(a=>a.path)})),projects:async()=>(await i.sdk.projects.list()).map(({id:t,name:o})=>({id:t,name:o})),list:t=>{let o=f(t),r=u(o,"status")??"all";if(r!=="all"&&r!=="active"&&!b(r))throw new d("invalid","unknown status filter");let s=o.projectId;return n.list({projectId:typeof s=="string"&&s?s:void 0,query:u(o,"query"),status:r,limit:H(o,"limit")??200})},get:t=>n.get(p(f(t),"doc")),create:t=>{let o=f(t),r=u(o,"projectId"),s=u(o,"status");if(s!==void 0&&!b(s))throw new d("invalid","unknown status");let a=n.create({title:p(o,"title"),summary:u(o,"summary"),template:u(o,"template"),tags:Je(o,"tags"),status:s,projectId:r||null},R);return e(a.id),a},update:t=>{let o=f(t),r=u(o,"status");if(r!==void 0&&!b(r))throw new d("invalid","unknown status");let s=o.projectId;if(s!=null&&typeof s!="string")throw new d("invalid","projectId must be a string or null");let a=n.update(p(o,"doc"),{title:u(o,"title"),summary:u(o,"summary"),status:r,tags:Je(o,"tags"),entryPath:u(o,"entryPath"),projectId:s===void 0?void 0:s||null},R);return e(a.id),a},remove:t=>{let o=n.summary(p(f(t),"doc"));return n.remove(o.id),e(o.id),{ok:!0}},readFile:t=>{let o=f(t);return n.readFile(p(o,"doc"),p(o,"path"))},writeFile:t=>{let o=f(t),r=o.content;if(typeof r!="string")throw new d("invalid","content must be a string");let s=n.writeFile(p(o,"doc"),{path:p(o,"path"),content:r,encoding:o.encoding==="base64"?"base64":void 0,baseRevision:H(o,"baseRevision"),note:u(o,"note")},R);return e(s.docId),s},editFile:t=>{let o=f(t);if(!Array.isArray(o.edits))throw new d("invalid","edits must be an array");let r=n.editFile(p(o,"doc"),{path:p(o,"path"),edits:o.edits,baseRevision:H(o,"baseRevision"),note:u(o,"note")},R);return e(r.docId),r},deleteFile:t=>{let o=f(t),r=n.summary(p(o,"doc"));return n.deleteFile(r.id,p(o,"path"),R,{baseRevision:H(o,"baseRevision")}),e(r.id),{ok:!0}},renameFile:t=>{let o=f(t),r=n.renameFile(p(o,"doc"),p(o,"from"),p(o,"to"),R);return e(r.docId),r},history:t=>{let o=f(t);return n.history(p(o,"doc"),{path:u(o,"path"),limit:H(o,"limit")})},revision:t=>{let o=f(t);return n.revisionContent(p(o,"doc"),o.id)},restore:t=>{let o=f(t),r=n.restoreRevision(p(o,"doc"),o.id,R);return e(r.docId),r},addComment:t=>{let o=f(t),r=n.addComment(p(o,"doc"),{body:p(o,"body"),path:u(o,"path"),quote:u(o,"quote")},R);return e(r.docId),r},setCommentStatus:t=>{let o=f(t),r=p(o,"status"),s=n.setCommentStatus(p(o,"doc"),o.id,r,R);return e(s.docId),s},deleteComment:t=>{let o=f(t),r=n.summary(p(o,"doc"));return n.deleteComment(r.id,o.id,R),e(r.id),{ok:!0}},unlinkThread:t=>{let o=f(t),r=n.summary(p(o,"doc"));return n.unlinkThread(r.id,p(o,"threadId")),e(r.id),{ok:!0}},createFromMessage:async t=>{let o=f(t),r=p(o,"threadId"),s=p(o,"text"),a=await i.sdk.threads.get({threadId:r});if(!a)throw new Error(`Thread ${r} was not found.`);let c=n.create({title:u(o,"title")?.trim()||qt(s),projectId:a.projectId??null,files:[{path:"README.md",content:s}]},R);return n.linkThread(c.id,r,a.title?.trim()||"Agent thread","assistant"),e(c.id),n.summary(c.id)},askAgent:async t=>{let o=f(t),r=n.summary(p(o,"doc")),s=u(o,"action"),a=s?Ye(s):null;if(s&&!a)throw new d("invalid",`unknown agent action ${s}`);let c=u(o,"prompt")?.trim()??"";if(!a&&!c)throw new d("invalid","pick an action or write a request");if(c.length>le)throw new d("invalid",`request must be at most ${le} characters`);let l=r.projectId??(u(o,"projectId")||null);if(!l)throw new d("invalid","this doc is global; choose a project for the agent to run in");let m=`${a?a.label:"Design doc"} \xB7 ${r.title}`.slice(0,120),E=u(o,"providerId"),y=await i.sdk.threads.spawn({projectId:l,prompt:Ke({doc:r,action:a,prompt:c,path:u(o,"path")}),title:m,...E?{providerId:E}:{},visibility:"visible",pluginMetadata:{designDocId:r.id,...a?{action:a.id}:{}}});return n.linkThread(r.id,y.id,m,a?.id==="review"?"reviewer":"assistant"),e(r.id),{threadId:y.id,projectId:l}}}}function Ze(i,n){for(let[e,t]of Object.entries(Ht(n)))i.rpc.method(e,t)}var oe={type:"string",description:"Design doc id (dd_\u2026) or slug, as shown by design_doc_list or the instructions catalog."},Ve=S.map(i=>i.id);function Qe(i,n=200){let e=new Map;return async t=>{let o=e.get(t);if(o===void 0){try{let r=await i(t);o=(r?.title||r?.titleFallback||"").trim()||"Agent"}catch{o="Agent"}e.size>=n&&e.delete(e.keys().next().value),e.set(t,o)}return{kind:"agent",label:o,threadId:t}}}function et(i,n){let e=t=>({store:n.store,changed:n.changed,projectId:t.projectId||null});i.agents.registerTool({name:"design_doc_list",description:"List design documents (specs, RFCs, ADRs, product docs) that the user keeps in the Design Docs plugin. Defaults to active docs of the current project plus global docs. Use query to search titles, summaries, tags and file contents.",parameters:{type:"object",properties:{query:{type:"string",description:"Free-text search."},status:{type:"string",enum:["active","all",...L],description:"active (default) hides archived docs."},scope:{type:"string",enum:["project","all"],description:"project (default) or every project."},limit:{type:"integer",minimum:1,maximum:200}},additionalProperties:!1},presentation:{label:{pending:"Listing design docs",completed:"Listed design docs"},icon:{glyph:"Search"}},execute:(t,o)=>Q(e(o),t)}),i.agents.registerTool({name:"design_doc_read",description:"Read a design doc. A design doc is a small project of files (markdown, mermaid .mmd diagrams, HTML mockups, code, images). Without path: returns the manifest (files with revisions, open review comments) and the entry file. With path: returns that file and its revision. includeAll=true returns every text file at once. Always read before editing, and treat open comments as review feedback to address.",parameters:{type:"object",properties:{doc:oe,path:{type:"string",description:"File path inside the doc, e.g. README.md or diagrams/flow.mmd."},includeAll:{type:"boolean",description:"Return all text files (bounded) instead of just the entry file."}},required:["doc"],additionalProperties:!1},presentation:{label:{pending:"Reading design doc",completed:"Read design doc"},icon:{glyph:"FileText"}},execute:(t,o)=>ee(e(o),t)}),i.agents.registerTool({name:"design_doc_create",description:`Create a new design doc the user can review in the Design Docs panel. Pass files to write your own content, or a template to start from (${Ve.join(", ")}). The doc belongs to the current project unless global=true. Write rich GitHub-flavoured markdown: headings, tables, task lists, \`\`\`mermaid diagrams and $math$ all render. Put larger diagrams in .mmd files and UI mockups in self-contained .html files.`,parameters:{type:"object",properties:{title:{type:"string",description:'Human title, e.g. "Offline sync for mobile".'},summary:{type:"string",description:"One or two sentences shown in lists."},template:{type:"string",enum:Ve,description:"Starter files when files is omitted."},tags:{type:"array",items:{type:"string"}},status:{type:"string",enum:[...L]},global:{type:"boolean",description:"Make the doc visible to every project."},files:{type:"array",description:"Initial files. Include a README.md as the entry point.",items:{type:"object",properties:{path:{type:"string"},content:{type:"string"},encoding:{type:"string",enum:["utf8","base64"],description:"base64 only for images."}},required:["path","content"],additionalProperties:!1}}},required:["title"],additionalProperties:!1},presentation:{label:{pending:"Creating design doc",completed:"Created design doc"},icon:{glyph:"File"}},execute:async(t,o)=>te(e(o),t,await n.actorFor(o.threadId))}),i.agents.registerTool({name:"design_doc_write",description:"Change one file in a design doc. Pass exactly one of: edits (exact-match find/replace, preferred for changes), content (whole file; creates the file if it does not exist), delete=true, or renameTo. Pass baseRevision (the revision you last read) so you never overwrite a concurrent edit by the user; on a conflict, re-read the file and reapply. Every write is kept in history and appears live in the panel.",parameters:{type:"object",properties:{doc:oe,path:{type:"string",description:"File path inside the doc. New folders are created implicitly."},edits:{type:"array",description:"Applied in order. oldText must match exactly once unless replaceAll is set.",items:{type:"object",properties:{oldText:{type:"string"},newText:{type:"string"},replaceAll:{type:"boolean"}},required:["oldText","newText"],additionalProperties:!1}},content:{type:"string",description:"Full new file content."},encoding:{type:"string",enum:["utf8","base64"],description:"base64 only for images."},delete:{type:"boolean"},renameTo:{type:"string"},baseRevision:{type:"integer",minimum:0,description:"Revision you read; 0 asserts the file is new."},note:{type:"string",description:"Short change note shown in history."}},required:["doc","path"],additionalProperties:!1},presentation:{label:{pending:"Editing design doc",completed:"Edited design doc"},icon:{glyph:"EditFile"}},execute:async(t,o)=>C(e(o),t,await n.actorFor(o.threadId))}),i.agents.registerTool({name:"design_doc_update",description:"Update design doc metadata: title, summary, status (draft \u2192 review \u2192 approved \u2192 implemented, or archived), tags, or the entry file.",parameters:{type:"object",properties:{doc:oe,title:{type:"string"},summary:{type:"string"},status:{type:"string",enum:[...L]},tags:{type:"array",items:{type:"string"},description:"Replaces the tag list."},entryPath:{type:"string",description:"File shown first when the doc opens."}},required:["doc"],additionalProperties:!1},presentation:{label:{pending:"Updating design doc",completed:"Updated design doc"},icon:{glyph:"EditFile"}},execute:async(t,o)=>ne(e(o),t,await n.actorFor(o.threadId))}),i.agents.registerTool({name:"design_doc_comment",description:"Leave a review comment on a design doc (optionally anchored to a file and a quoted passage), or resolve / reopen an existing comment by id. Resolve comments once your edits address them, with body explaining what changed.",parameters:{type:"object",properties:{doc:oe,body:{type:"string",description:"Comment text (markdown). With resolve, posted as a reply."},path:{type:"string",description:"File the comment is about."},quote:{type:"string",description:"Exact passage the comment refers to."},resolve:{type:"string",description:"Comment id to mark resolved."},reopen:{type:"string",description:"Comment id to reopen."}},required:["doc"],additionalProperties:!1},presentation:{label:{pending:"Commenting on design doc",completed:"Commented on design doc"},icon:{glyph:"ListTodo"}},execute:async(t,o)=>q(e(o),t,await n.actorFor(o.threadId))})}function Xt(i){let n=new V(i.storage.database()),e=o=>i.realtime.publish(ue,{docId:o}),t=Qe(o=>i.sdk.threads.get({threadId:o}));et(i,{store:n,changed:e,actorFor:t}),ze(i,n,o=>i.log.warn(o)),He(i,{store:n,changed:e,actorFor:t,readLocalFile:Xe(i.sdk)}),Ze(i,{store:n,changed:e,sdk:i.sdk}),i.events.on("thread.idle",o=>{for(let r of n.touchThread(o.threadId,o.thread?.title??null))e(r)}),i.events.on("thread.deleted",o=>{for(let r of n.forgetThread(o.threadId))e(r)}),i.log.info("design docs ready")}export{Xt as default};
