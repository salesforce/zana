import { createRequire as __createRequire } from "node:module";
import { dirname as __pathDirname } from "node:path";
import { fileURLToPath as __fileURLToPath } from "node:url";
const require = __createRequire(import.meta.url);
var __filename = __fileURLToPath(import.meta.url);
var __dirname = __pathDirname(__filename);
import{dirname as Or,join as Xn}from"node:path";import{fileURLToPath as Mr}from"node:url";var he="changed",B=["draft","review","approved","implemented","archived"],dt={draft:"Draft",review:"In review",approved:"Approved",implemented:"Implemented",archived:"Archived"};function x(t){return typeof t=="string"&&B.includes(t)}function ht(t,n){let e=i=>i.replace(/["\\\n\r]/g,"");return n?`::design-doc{id="${e(t)}" path="${e(n)}"}`:`::design-doc{id="${e(t)}"}`}import{join as pr,relative as hr,resolve as Ct,sep as ce}from"node:path";function N(t){return t.kind==="agent"?`agent "${t.label}"`:"the user"}function $(t){return t>=1024*1024?`${Math.round(t/(1024*1024)*10)/10} MiB`:t>=1024?`${Math.round(t/1024)} KiB`:`${t} B`}function q(t,n=Date.now()){let e=Math.max(0,Math.round((n-t)/1e3));if(e<45)return"just now";let i=Math.round(e/60);if(i<60)return`${i}m ago`;let r=Math.round(i/60);if(r<24)return`${r}h ago`;let o=Math.round(r/24);return o<30?`${o}d ago`:new Date(t).toISOString().slice(0,10)}var ge=`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{title}}</title>
<link rel="stylesheet" href="zcc-kit/site.css">
<script src="zcc-kit/site.js"></script>
</head>`,me=`${ge}
<body>
<header class="site-header">
  <a class="brand" href="#summary"><span class="brand-mark" aria-hidden="true">R</span><span class="brand-text"><strong>{{title}}</strong><span>Report</span></span></a>
  <nav><a href="#summary">Summary</a><a href="#trend">Trend</a><a href="#breakdown">Breakdown</a><a href="#details">Details</a></nav>
  <div class="actions"><button class="button" data-kit-theme>Theme</button></div>
</header>
<main>
  <section id="summary">
    <p class="eyebrow">Week 8</p>
    <h1>{{title}}</h1>
    <p class="lede">{{summary}}</p>
    <div class="kpis">
      <div class="tile">
        <div class="label">Success rate</div>
        <div class="value">69%</div>
        <div class="note"><span class="delta good up">+4 pts</span> vs last week</div>
        <svg class="spark" data-spark="52,55,58,61,63,66,65,69" data-format="integer" aria-label="Success rate"></svg>
      </div>
      <div class="tile">
        <div class="label">Runs</div>
        <div class="value">1,284</div>
        <div class="note">Last 8 weeks</div>
        <svg class="spark" data-spark="120,140,150,160,170,175,180,189" aria-label="Runs per week"></svg>
      </div>
      <div class="tile">
        <div class="label">Median time</div>
        <div class="value">6.4 min</div>
        <div class="note"><span class="delta bad up">+3%</span> vs last week</div>
        <svg class="spark" data-spark="6.1,6.3,6.0,6.2,6.5,6.3,6.2,6.4" aria-label="Median minutes"></svg>
      </div>
      <div class="tile">
        <div class="label">Status</div>
        <div class="value"><span class="status good">Healthy</span></div>
        <div class="note">No regressions this week</div>
      </div>
    </div>
    <div class="callout">
      <p>Replace the sample numbers with your own. Charts read <code>data/weekly.csv</code> or the JSON next to them; tables sort and filter on their own.</p>
    </div>
  </section>

  <section id="trend">
    <div class="section-head"><h2>Trend</h2><p>How each option moved, week by week.</p></div>
    <div class="grid cols-2">
      <div class="card">
        <figure class="chart">
          <figcaption>Success rate by week</figcaption>
          <p class="sub">Share of runs that succeeded</p>
          <script type="application/json">{"type": "line", "data": "data/weekly.csv", "x": "week", "y": ["Option A", "Option B"], "format": "percent", "xLabel": "Week"}</script>
        </figure>
      </div>
      <div class="card">
        <figure class="chart">
          <figcaption>Runs this week, by kind</figcaption>
          <script type="application/json">{"type": "bar", "labels": ["Bugfix", "Feature", "Refactor", "Tests", "Docs"], "series": [{"name": "Runs", "values": [42, 31, 27, 18, 9]}], "format": "integer"}</script>
        </figure>
      </div>
    </div>
  </section>

  <section id="breakdown">
    <div class="section-head"><h2>Breakdown</h2><p>Where the runs ended up.</p></div>
    <div class="grid cols-2">
      <div class="card">
        <figure class="chart">
          <figcaption>Outcome mix</figcaption>
          <script type="application/json">{"type": "bar", "stacked": true, "labels": ["Option A", "Option B"], "series": [{"name": "Succeeded", "values": [69, 61]}, {"name": "Failed", "values": [21, 27]}, {"name": "Timed out", "values": [10, 12]}], "format": "integer", "xLabel": "Option"}</script>
        </figure>
      </div>
      <div class="card">
        <figure class="chart">
          <figcaption>Median minutes per run</figcaption>
          <script type="application/json">{"type": "bar", "horizontal": true, "labels": ["Bugfix", "Feature", "Refactor", "Tests"], "series": [{"name": "Option A", "values": [6.2, 11.5, 8.1, 4.4]}, {"name": "Option B", "values": [7.1, 12.9, 9.4, 5.0]}], "xLabel": "Kind"}</script>
        </figure>
      </div>
    </div>
  </section>

  <section id="details">
    <div class="section-head"><h2>Details</h2></div>
    <div class="filters">
      <span class="title">Filter</span>
      <label>Search <input type="search" data-filter="#runs" placeholder="Task or note"></label>
      <label>Option
        <select data-filter="#runs" data-column="Option"><option value="">All</option><option>Option A</option><option>Option B</option></select>
      </label>
    </div>
    <div class="tab-list"><button data-tab="runs">Runs</button><button data-tab="method">Method</button></div>
    <div data-tab-panel="runs">
      <div class="table-wrap">
        <table id="runs" class="sortable">
          <thead><tr><th>Task</th><th>Option</th><th>Outcome</th><th class="num">Score</th><th class="num">Minutes</th></tr></thead>
          <tbody>
            <tr><td>fix-auth-race</td><td>Option A</td><td><span class="status good">Succeeded</span></td><td class="num">0.92</td><td class="num">6.1</td></tr>
            <tr><td>add-csv-export</td><td>Option B</td><td><span class="status critical">Failed</span></td><td class="num">0.41</td><td class="num">12.4</td></tr>
            <tr><td>refactor-store</td><td>Option A</td><td><span class="status good">Succeeded</span></td><td class="num">0.85</td><td class="num">9.0</td></tr>
            <tr><td>flaky-upload-test</td><td>Option B</td><td><span class="status warning">Timed out</span></td><td class="num">0.00</td><td class="num">20.0</td></tr>
            <tr><td>docs-quickstart</td><td>Option A</td><td><span class="status good">Succeeded</span></td><td class="num">0.78</td><td class="num">3.2</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div data-tab-panel="method">
      <p>Describe how the numbers were collected: the task set, how a run is scored, what counts as a timeout, and anything left out.</p>
    </div>
  </section>
</main>
<footer class="site-footer"><p>Data: <a href="data/weekly.csv">data/weekly.csv</a>. Made with Design Docs.</p></footer>
</body>
</html>
`,fe=`week,Option A,Option B
W1,0.52,0.47
W2,0.55,0.49
W3,0.58,0.50
W4,0.61,0.54
W5,0.63,0.55
W6,0.66,0.58
W7,0.65,0.60
W8,0.69,0.61
`,ye=`${ge}
<body>
<header class="site-header">
  <a class="brand" href="#context"><span class="brand-mark" aria-hidden="true">D</span><span class="brand-text"><strong>{{title}}</strong><span>Design doc</span></span></a>
  <nav><a href="#context">Context</a><a href="#goals">Goals</a><a href="#proposal">Proposal</a><a href="#alternatives">Alternatives</a><a href="#risks">Risks</a><a href="#rollout">Rollout</a><a href="#questions">Questions</a></nav>
  <div class="actions"><button class="button" data-kit-theme>Theme</button></div>
</header>
<main class="narrow">
  <section id="context">
    <p class="eyebrow">Design doc \xB7 <span class="pill">Draft</span></p>
    <h1>{{title}}</h1>
    <p class="lede">{{summary}}</p>
    <dl>
      <dt>Author</dt><dd>\u2026</dd>
      <dt>Reviewers</dt><dd>\u2026</dd>
      <dt>Updated</dt><dd>\u2026</dd>
    </dl>
    <h2>Context</h2>
    <p>What problem are we solving, for whom, and why now? Link the evidence (incidents, metrics, user feedback) that motivates the change.</p>
    <div class="callout warning"><p><strong>Assumption:</strong> state what this design takes for granted, so reviewers can challenge it.</p></div>
  </section>

  <section id="goals">
    <h2>Goals and non-goals</h2>
    <div class="grid cols-2">
      <div class="card"><h3>Goals</h3><ul><li>\u2026</li><li>\u2026</li></ul></div>
      <div class="card"><h3>Non-goals</h3><ul><li>\u2026</li><li>\u2026</li></ul></div>
    </div>
  </section>

  <section id="proposal">
    <h2>Proposal</h2>
    <p>The design in one paragraph, then the pieces.</p>
    <div class="flow">
      <div class="step"><b>1. Client</b>What starts the flow.</div>
      <div class="step"><b>2. Service</b>What it validates and stores.</div>
      <div class="step"><b>3. Worker</b>What runs later, and how it retries.</div>
      <div class="step"><b>4. Result</b>What the user sees.</div>
    </div>
    <h3>Interfaces</h3>
    <pre><code>POST /v1/items
{ "name": "example" }
\u2192 201 { "id": "it_123" }</code></pre>
    <h3>Data model</h3>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Field</th><th>Type</th><th>Notes</th></tr></thead>
        <tbody>
          <tr><td><code>id</code></td><td>string</td><td>Primary key.</td></tr>
          <tr><td><code>created_at</code></td><td>timestamp</td><td>Set by the service.</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <section id="alternatives">
    <h2>Alternatives considered</h2>
    <div class="table-wrap">
      <table class="sortable">
        <thead><tr><th>Option</th><th>Pros</th><th>Cons</th><th>Verdict</th></tr></thead>
        <tbody>
          <tr><td>Proposed</td><td>\u2026</td><td>\u2026</td><td><span class="status good">Chosen</span></td></tr>
          <tr><td>Alternative A</td><td>\u2026</td><td>\u2026</td><td><span class="status">Rejected</span></td></tr>
          <tr><td>Do nothing</td><td>No cost now.</td><td>The problem stays.</td><td><span class="status">Rejected</span></td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <section id="risks">
    <h2>Risks</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Risk</th><th>Impact</th><th>Mitigation</th></tr></thead>
        <tbody>
          <tr><td>\u2026</td><td><span class="status critical">High</span></td><td>\u2026</td></tr>
          <tr><td>\u2026</td><td><span class="status warning">Medium</span></td><td>\u2026</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <section id="rollout">
    <h2>Rollout</h2>
    <ol>
      <li><strong>Behind a flag.</strong> Internal users only; watch the error rate.</li>
      <li><strong>Gradual.</strong> 10% \u2192 50% \u2192 100%, with a rollback plan at each step.</li>
      <li><strong>Clean up.</strong> Remove the flag and the old path.</li>
    </ol>
    <p>How we know it worked:</p>
    <div class="meter" style="--value: 0%"><span>0%</span></div>
  </section>

  <section id="questions">
    <h2>Open questions</h2>
    <ol><li>\u2026</li><li>\u2026</li></ol>
  </section>
</main>
<footer class="site-footer"><p>Made with Design Docs.</p></footer>
</body>
</html>
`;var Gn=`# {{title}}

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
`,Kn=`flowchart LR
  user([User]) --> ui[Client]
  ui --> api[Service API]
  api --> db[(Database)]
  api --> queue[[Queue]]
  queue --> worker[Worker]
`,zn=`# {{title}}

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
`,Yn=`<!doctype html>
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
`,Jn=`# {{title}}

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
`,Vn=`# {{title}}

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
`,Zn=`openapi: 3.1.0
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
`,k=[{id:"technical",label:"Technical design",description:"RFC-style design: context, goals, proposal, alternatives, rollout.",files:[{path:"README.md",content:Gn},{path:"diagrams/architecture.mmd",content:Kn}]},{id:"product",label:"Product spec",description:"Problem, users, metrics, scope, requirements and an HTML mockup.",files:[{path:"README.md",content:zn},{path:"mockups/overview.html",content:Yn}]},{id:"adr",label:"Decision record",description:"A single architectural decision with options and consequences.",files:[{path:"README.md",content:Jn}]},{id:"api",label:"API design",description:"Resources, auth, errors and an OpenAPI contract.",files:[{path:"README.md",content:Vn},{path:"api/openapi.yaml",content:Zn}]},{id:"report",label:"Interactive report",description:"A one-page site: KPIs, charts from CSV, a sortable table. Publishes to GitHub Pages.",entryPath:"index.html",files:[{path:"index.html",content:me},{path:"data/weekly.csv",content:fe}]},{id:"html-design",label:"HTML design doc",description:"A technical design as a web page with section nav. Publishes to GitHub Pages.",entryPath:"index.html",files:[{path:"index.html",content:ye}]},{id:"blank",label:"Blank",description:"A single README.md to start from scratch.",files:[{path:"README.md",content:`# {{title}}

{{summary}}
`}]}],we="technical";function be(t){return k.find(n=>n.id===t)??null}function ve(t,n){let e=n.summary.trim()||"One-paragraph summary of the proposal.";return t.files.map(i=>{let r=/\.html?$/i.test(i.path),o=s=>r?Qn(s):s;return{path:i.path,content:i.content.replaceAll("{{title}}",o(n.title)).replaceAll("{{summary}}",o(e))}})}function Qn(t){return t.replace(/[&<>"']/g,n=>`&#${n.charCodeAt(0)};`)}var ti=12e4;function ei(t,n=Date.now()){let e=[dt[t.status],`${t.fileCount} file${t.fileCount===1?"":"s"}`,t.openComments?`${t.openComments} open comment${t.openComments===1?"":"s"}`:null,t.alternativeTo?`alternative to ${t.alternativeTo}`:null,`updated ${q(t.updatedAt,n)}`].filter(Boolean),i=t.summary?` \u2014 ${K(t.summary,140)}`:"";return`- ${t.id} "${t.title}" (${e.join(" \xB7 ")})${i}`}function Ee(t,n=Date.now()){return t.length===0?"No design docs match.":t.map(e=>ei(e,n)).join(`
`)}function ni(t,n,e){let i=t.path===n?" [entry]":"";return`- ${t.path}${i} \u2014 ${t.kind}, ${$(t.size)}, rev ${t.revision}, ${N(t.updatedBy)} ${q(t.updatedAt,e)}`}function ct(t,n=Date.now()){let e=t.path?` on ${t.path}`:"",i=t.quote?` \u203A "${K(t.quote,120)}"`:"",r=t.status==="resolved"?" [resolved]":"";return[`- [${t.id}]${e}${i}${r} ${N(t.author)}, ${q(t.createdAt,n)}: ${t.body}`,...t.replies.map(o=>`  \u21B3 reply ${N(o.author)}, ${q(o.createdAt,n)}: ${o.body.replace(/\n/g,`
    `)}`)].join(`
`)}function Q(t,n={}){let e=n.now??Date.now(),i=t.projectId?n.projectName??t.projectId:"global (all projects)",r=[`# ${t.title}`,`id: ${t.id} \xB7 slug: ${t.slug} \xB7 status: ${t.status} \xB7 doc revision ${t.revision}`,`project: ${i} \xB7 created by ${N(t.createdBy)} \xB7 updated ${q(t.updatedAt,e)} by ${N(t.updatedBy)}`];t.summary&&r.push(`summary: ${t.summary}`),t.tags.length&&r.push(`tags: ${t.tags.join(", ")}`),t.alternativeTo&&r.push(`alternative to: ${t.alternativeTo}`),r.push("",`## Files (${t.files.length})`,...t.files.map(s=>ni(s,t.entryPath,e)));let o=t.comments.filter(s=>s.status==="open");return o.length&&r.push("",`## Open comments (${o.length})`,...o.map(s=>ct(s,e))),r.join(`
`)}function G(t){return t.encoding==="base64"?`<file path="${t.path}" revision="${t.revision}" kind="${t.kind}" encoding="base64" size="${$(t.size)}">(binary ${t.kind}, not shown as text)</file>`:`<file path="${t.path}" revision="${t.revision}" kind="${t.kind}">
${t.content}
</file>`}function gt(t,n,e={}){let i=e.maxChars??ti,r=[...n.filter(d=>d.path===t.entryPath),...n.filter(d=>d.path!==t.entryPath)],o=[Q(t,e)],s=o[0].length,a=[];for(let d of r){let c=G(d);if(s+c.length>i){a.push(d.path);continue}o.push(c),s+=c.length}return a.length&&o.push(`(${a.length} file(s) omitted to stay within size limits \u2014 read them by path: ${a.join(", ")})`),o.join(`

`)}var ii={error:"Error",missing:"Missing",blocked:"Blocked"};function ri(t){let n=t.source?` (${t.source}${t.line?`:${t.line}`:""})`:"";return`- ${ii[t.kind]}: ${K(t.message,300)}${n}`}function Ut(t){return!t.missing.length&&!t.warnings.length?null:[`Page check for ${t.path}:`,...t.missing.map(n=>`- Missing: the page uses ${n}, which is not a file in this doc.`),...t.warnings.map(n=>`- Blocked: ${n}`)].join(`
`)}function Bt(t,n){let e=new Set(t.unanchored),i=n.filter(r=>r.status==="open"&&r.path===t.path&&r.quote&&e.has(r.quote));return[...t.problems.map(ri),...i.map(r=>`- Comment ${r.id} quotes "${K(r.quote,120)}", which the page does not show.`)]}function qt(t,n,e=Date.now()){let i=`The Design Docs panel ran ${t.path} (rev ${t.revision}) ${q(t.at,e)}`,r=Bt(t,n);return r.length?[`${i}:`,...r].join(`
`):`${i} without problems.`}function Te(t,n=Date.now()){return t.length===0?"No history.":t.map(e=>{let i=e.renamedFrom?` (from ${e.renamedFrom})`:"",r=e.note?` \u2014 ${e.note}`:"";return`- #${e.id} ${e.op} ${e.path}${i} \u2192 rev ${e.revision}, ${$(e.size)}, ${N(e.actor)} ${q(e.createdAt,n)}${r}`}).join(`
`)}function mt(t,n){return`To show it to the user, put this on its own line in your reply: ${ht(t.id,n)}`}function K(t,n){let e=t.replace(/\s+/g," ").trim();return e.length<=n?e:`${e.slice(0,n-1)}\u2026`}var oi=new Set(["script","style","textarea","title","xmp","iframe","noembed","noframes","noscript"]),si=/[A-Za-z][^\t\n\f\r />]*/y,ai=/[\t\n\f\r /]*/y,Re=/[\t\n\f\r ]*/y,di=/[^\t\n\f\r />][^\t\n\f\r />=]*/y,ci=/[^\t\n\f\r >]*/y,li={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0",mdash:"\u2014",ndash:"\u2013",hellip:"\u2026",middot:"\xB7",bull:"\u2022",lsquo:"\u2018",rsquo:"\u2019",ldquo:"\u201C",rdquo:"\u201D",laquo:"\xAB",raquo:"\xBB",copy:"\xA9",reg:"\xAE",trade:"\u2122",deg:"\xB0",times:"\xD7",plusmn:"\xB1",larr:"\u2190",rarr:"\u2192",uarr:"\u2191",darr:"\u2193"};function Xt(t){return t.includes("&")?t.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));?/g,(n,e,i,r)=>{if(r)return li[r.toLowerCase()]??n;let o=e?Number(e):parseInt(i,16);return o>0&&o<=1114111?String.fromCodePoint(o):n}):t}function Wt(t){return t.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;")}function tt(t,n,e){return t.lastIndex=e,t.exec(n)?.[0]??""}function ui(t,n){let e=tt(si,t,n+1),i=n+1+e.length,r=[];for(;i<t.length;){let o=tt(ai,t,i);if(i+=o.length,i>=t.length)return null;if(t[i]===">")return{name:e.toLowerCase(),attributes:r,selfClosing:o.endsWith("/"),start:n,end:i+1};let s=tt(di,t,i)||t[i];i+=s.length,i+=tt(Re,t,i).length;let a=null;if(t[i]==="="){i+=1,i+=tt(Re,t,i).length;let d=t[i];if(d==='"'||d==="'"){let c=t.indexOf(d,i+1);if(c<0)return null;a=t.slice(i+1,c),i=c+1}else a=tt(ci,t,i),i+=a.length}r.push({name:s.toLowerCase(),value:a===null?null:Xt(a)})}return null}var pi=new Set(["","module","text/javascript","application/javascript","text/ecmascript","application/ecmascript"]);function Gt(t){return pi.has((t??"").trim().toLowerCase())}var hi=new Set(["textarea","xmp"]);function Kt(t){let n="",e=!1,i=0,r=o=>{let s=t.slice(i,o).replace(/<!--[\s\S]*?(?:-->|$)/g,"").replace(/<[/!?][^>]*>?/g,"");n+=Xt(s)};for(let o of ft(t))o.start<i||(r(o.start),i=o.end,o.name==="script"&&Gt(A(o,"type"))&&(e=!0),o.name==="template"?i=gi(t,i):o.content&&(hi.has(o.name)&&(n+=Xt(t.slice(o.content.start,o.content.end))),i=o.content.closeEnd));return r(t.length),{text:n,scripted:e}}function gi(t,n){let e=/<(\/?)template\b[^>]*>/gi;e.lastIndex=n;let i=1;for(let r=e.exec(t);r;r=e.exec(t))if(i+=r[1]?-1:1,i===0)return e.lastIndex;return t.length}function*ft(t){let n=0;for(;n<t.length;){let e=t.indexOf("<",n);if(e<0)return;let i=t[e+1]??"";if(t.startsWith("<!--",e)){let o=t.indexOf("-->",e+4);n=o<0?t.length:o+3;continue}if(i==="!"||i==="?"||i==="/"&&/[A-Za-z]/.test(t[e+2]??"")){let o=t.indexOf(">",e+2);n=o<0?t.length:o+1;continue}if(!/[A-Za-z]/.test(i)){n=e+1;continue}let r=ui(t,e);if(!r)return;if(n=r.end,oi.has(r.name)){let o=new RegExp(`</${r.name}(?=[\\t\\n\\f\\r />])`,"ig");o.lastIndex=r.end;let s=o.exec(t),a=s?s.index:t.length,d=s?t.indexOf(">",a):-1,c=d<0?t.length:d+1;yield{...r,content:{start:r.end,end:a,closeEnd:c}},n=c;continue}yield r}}function A(t,n){let e=t.attributes.find(i=>i.name===n);return e?e.value:void 0}function z(t,n,e=!1){let i=n.map(r=>r.value===null?` ${r.name}`:` ${r.name}="${Wt(r.value)}"`);return`<${t}${i.join("")}${e?" />":">"}`}function yt(t,n){let e=-1;for(let r of ft(t)){if(r.name==="head")return t.slice(0,r.end)+n+t.slice(r.end);if(r.name==="html"){e=r.end;continue}break}if(e>=0)return t.slice(0,e)+n+t.slice(e);let i=t.match(/^\s*<!doctype[^>]*>/i);return i?i[0]+n+t.slice(i[0].length):n+t}var mi=/^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/,S=class extends Error{constructor(n){super(n),this.name="DesignDocPathError"}};function L(t){if(typeof t!="string")throw new S("path must be a string");let n=t.trim().replace(/\\/g,"/");for(;n.startsWith("./");)n=n.slice(2);if(!n)throw new S("path is required");if(n.startsWith("/"))throw new S("path must be relative to the design doc");if(n.length>160)throw new S("path must be at most 160 characters");let e=n.split("/");if(e.length>10)throw new S("path must be at most 10 levels deep");for(let i of e){if(i===".."||i===".")throw new S('path must not contain "." or ".." segments');if(!mi.test(i)||i.endsWith(" ")||i.endsWith("."))throw new S(`invalid path segment ${JSON.stringify(i)}: use letters, digits, ".", "_", "-" or spaces, starting with a letter or digit`)}return e.join("/")}function zt(t){let n=t.split("/").pop()??t,e=n.lastIndexOf(".");return e<=0?"":n.slice(e+1).toLowerCase()}var fi={md:"markdown",markdown:"markdown",mdx:"markdown",html:"html",htm:"html",mmd:"mermaid",mermaid:"mermaid",svg:"svg",png:"image",jpg:"image",jpeg:"image",gif:"image",webp:"image",ico:"image",woff:"font",woff2:"font",ttf:"font",otf:"font",txt:"text"},_e={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",ico:"image/x-icon"},yi={woff:"font/woff",woff2:"font/woff2",ttf:"font/ttf",otf:"font/otf"},wi={json:"json",yaml:"yaml",yml:"yaml",toml:"toml",ts:"typescript",tsx:"tsx",js:"javascript",jsx:"jsx",mjs:"javascript",py:"python",go:"go",rs:"rust",java:"java",kt:"kotlin",swift:"swift",rb:"ruby",sql:"sql",sh:"bash",css:"css",graphql:"graphql",gql:"graphql",proto:"protobuf",xml:"xml",cls:"apex",apex:"apex"};function D(t){let n=zt(t),e=fi[n];return e||(wi[n]?"code":"text")}function et(t){return t==="image"||t==="font"}function nt(t){return _e[zt(t)]??null}var bi={html:"text/html",htm:"text/html",css:"text/css",js:"text/javascript",mjs:"text/javascript",json:"application/json",svg:"image/svg+xml",xml:"application/xml",csv:"text/csv",md:"text/markdown",txt:"text/plain"};function wt(t){let n=zt(t),e=_e[n]??yi[n];return e||`${bi[n]??"text/plain"};charset=utf-8`}var vi=/^[a-z][a-z0-9+.-]*:/i;function O(t,n){let e=n.trim();if(!e||e.startsWith("#")||e.startsWith("//")||vi.test(e))return null;let i=e.split(/[?#]/,1)[0],r=i;try{r=decodeURIComponent(i)}catch{}let o=r.startsWith("/")?[]:t.split("/").slice(0,-1);for(let s of r.split("/"))if(!(!s||s===".")){if(s===".."){if(!o.length)return null;o.pop();continue}o.push(s)}return o.length?o.join("/"):null}function it(t,n){let e=t.split("/"),i=n.split("/"),r=Math.min(e.length,i.length);for(let o=0;o<r;o+=1){let s=o===e.length-1,a=o===i.length-1;if(e[o]!==i[o])return s!==a?s?-1:1:e[o].localeCompare(i[o],void 0,{sensitivity:"base",numeric:!0})}return e.length-i.length}import{Buffer as en}from"node:buffer";import{readFileSync as nn,realpathSync as Qe,statSync as Zi}from"node:fs";import{join as Qi,sep as tr}from"node:path";var Ae="dd-page",xe="dd-files";var Ie=50,Vr=256*1024,Ei=1e3;var Ti=500;var Ri=new Set(["error","missing","blocked"]);function _i(t){return t&&typeof t=="object"&&!Array.isArray(t)?t:null}function De(t,n){return typeof t=="string"?t.slice(0,n):null}function Di(t){return typeof t=="number"&&Number.isFinite(t)?t:null}function Pe(t){let n=_i(t),e=n?.kind,i=De(n?.message,Ti);if(!n||!Ri.has(e)||!i)return null;let r=De(n.source,Ei),o=Di(n.line);return{kind:e,message:i,...r?{source:r}:{},...o!==null&&o>0?{line:Math.floor(o)}:{}}}var vt="https://doc.invalid",X="zcc-kit",$e=["site.css","site.js"],Se=12*1024*1024,eo=960*1024;function Le(t,n,e){let i=new Map(n.map(r=>[r.path,r.revision]));return!e&&t.revision!==(i.get(t.path)??null)||t.deps.some(r=>(i.get(r.path)??0)!==r.revision)?!0:t.missing.some(r=>i.has(r))}function Yt(t){return JSON.stringify(t).replace(/</g,"\\u003c")}function Et(t){return`${vt}/${t.split("/").map(encodeURIComponent).join("/")}`}function ke(t){let n=t.lastIndexOf("/");return n<0?`${vt}/`:`${Et(t.slice(0,n))}/`}import{Buffer as Ai}from"node:buffer";var Jt=/^(?:[a-z][a-z0-9+.-]*:)?\/\//i,xi=/\.(?:mp4|m4v|webm|ogg|ogv|mov|mp3|m4a|wav|flac|aac)$/i,Ii=8,Pi=40,$i={img:["src","srcset"],source:["src","srcset"],input:["src"],video:["poster"],image:["href","xlink:href"],feimage:["href","xlink:href"]},Si=/\/\*[\s\S]*?\*\/|@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"([^"]*)"|'([^']*)')([^;]*);?|url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"(?:[^"\\\n]|\\[\s\S])*"|'(?:[^'\\\n]|\\[\s\S])*'/gi,Li=/(?:^|[;\n}])\s*import\s*(?:[\w$*{}\s,]+?\s*from\s*)?["'](\.{1,2}\/|\/)[^"']*["']/;function Zt(t){return t.replace(/<(\/script|!--)/gi,"\\x3C$1")}function Ce(t){return t.replace(/<\/style/gi,"<\\/style")}function ki(t){if(t.kind==="svg"&&t.encoding==="utf8")return`data:image/svg+xml;base64,${Ai.from(t.content,"utf8").toString("base64")}`;if(t.encoding!=="base64")return null;if(t.kind==="image"){let n=nt(t.path);return n?`data:${n};base64,${t.content}`:null}return t.kind==="font"?`data:${wt(t.path)};base64,${t.content}`:null}function Ci(t,n){let e=n.trim();if(!e)return t;let i=[],r=e.match(/^layer(?:\(\s*([^)]*?)\s*\))?(?=\s|$)/i);if(r&&(i.push(r[1]?`@layer ${r[1]}`:"@layer"),e=e.slice(r[0].length).trim()),/^supports\(/i.test(e)){let o=0,s=8;for(;s<e.length;s+=1)if(e[s]==="(")o+=1;else if(e[s]===")"&&(o-=1)===0)break;i.push(`@supports ${e.slice(8,s+1)}`),e=e.slice(s+1).trim()}return e&&i.push(`@media ${e}`),`${i.map(o=>`${o} {
`).join("")}${t}
${i.map(()=>"}").join(`
`)}`}function Ni(t){let n=[],e=0;for(;e<t.length;){for(;e<t.length&&/[\s,]/.test(t[e]);)e+=1;if(e>=t.length)break;let i=e;for(;i<t.length&&!/\s/.test(t[i]);)i+=1;let r=t.slice(e,i),o="";if(r.endsWith(","))r=r.replace(/,+$/,""),e=i;else{let s=i,a=0;for(;s<t.length&&(t[s]!==","||a>0);)t[s]==="("?a+=1:t[s]===")"&&(a-=1),s+=1;o=t.slice(i,s).trim(),e=s+1}n.push({url:r,descriptor:o})}return n}var Vt=class{constructor(n){this.input=n}input;files=new Map;assets=new Map;missing=new Set;warnings=new Set;assetBytes=0;overBudget=!1;read(n){if(this.files.has(n))return this.files.get(n);let e=null;try{e=this.input.read(n)}catch{e=null}return this.files.set(n,e),!e&&n!==this.input.entryPath&&this.missing.add(n),e}warn(n){this.warnings.size<Pi&&this.warnings.add(n)}asset(n){if(this.assets.has(n))return this.assets.get(n);let e=this.read(n),i=e?ki(e):null;if(i){let r=this.input.assetBudget??Se;this.assetBytes+i.length>r?(this.overBudget||(this.warn(`Some images and fonts load on demand: the page inlines at most ${Math.round(r/(1024*1024))} MB of them.`),this.overBudget=!0),i=null):this.assetBytes+=i.length}return this.assets.set(n,i),i}resolveUrl(n,e){let i=O(n,e);if(!i)return null;let r=this.asset(i);if(r)return r;let o=e.indexOf("#");return Et(i)+(o>=0?e.slice(o):"")}css(n,e,i=[],r=[]){let o=n.replace(Si,(s,...a)=>{if(s.startsWith("/*")||s.startsWith('"')||s.startsWith("'"))return s;if(s[0]==="@"){let u=a[0]??a[1]??a[2]??a[3]??a[4]??"",p=O(e,u);if(!p)return Jt.test(u)&&this.warn(`External stylesheet ${u} does not load in previews; add the file to the doc.`),r.push(s.endsWith(";")?s:`${s};`),"";if(i.includes(p)||i.length>=Ii)return this.warn(`${e} imports ${p} in a cycle or too deeply; the import was skipped.`),"";let y=this.read(p);if(!y||y.encoding!=="utf8")return"";let E=this.css(y.content.replace(/@charset\s+["'][^"']*["']\s*;/gi,""),p,[...i,e],r);return Ci(E,a[5]??"")}let d=(a[6]??a[7]??a[8]??"").trim(),c=this.resolveUrl(e,d);return c?`url("${c}")`:s});return i.length||!r.length?o:`${r.join(`
`)}
${o}`}srcset(n){return Ni(n).map(({url:e,descriptor:i})=>`${this.resolveUrl(this.input.entryPath,e)??e}${i?` ${i}`:""}`).join(", ")}stylesheet(n,e){let i=O(this.input.entryPath,e);if(!i)return Jt.test(e)&&this.warn(`External stylesheet ${e} does not load in previews; add the file to the doc.`),null;let r=this.read(i);if(!r||r.encoding!=="utf8")return"";let o=n.attributes.filter(a=>["media","title","id","disabled"].includes(a.name)),s=this.css(r.content,i);return`${z("style",[{name:"data-dd-href",value:i},...o])}${Ce(s)}</style>`}script(n,e){let i=(A(n,"type")??"").trim().toLowerCase();if(!Gt(i))return null;if(A(n,"nomodule")!==void 0)return"";let r=i==="module",o=[{name:"type",value:"text/x-dd-script"}];r&&o.push({name:"data-dd-type",value:"module"});let s=A(n,"src");s!==void 0&&A(n,"async")!==void 0?o.push({name:"data-dd-async",value:null}):s!==void 0&&!r&&A(n,"defer")!==void 0&&o.push({name:"data-dd-defer",value:null});let a=n.attributes.filter(u=>u.name.startsWith("data-")&&!u.name.startsWith("data-dd-")),d=e,c=this.input.entryPath;if(s!==void 0){let u=s?O(this.input.entryPath,s):null;if(!u)return s&&Jt.test(s)&&this.warn(`External script ${s} is blocked in previews; add the file to the doc.`),null;o.push({name:"data-dd-src",value:u});let p=this.read(u);if(!p||p.encoding!=="utf8")return`${z("script",[...o,{name:"data-dd-missing",value:null},...a])}</script>`;d=Zt(p.content),c=u}return r&&Li.test(d)&&this.warn(`${c} imports other modules; previews run each script on its own, so bundle modules into one file.`),`${z("script",[...o,...a])}${d}</script>`}refresh(n){let e=(A(n,"content")??"").match(/^\s*(\d+(?:\.\d+)?)?\s*[;,]?\s*(?:url\s*=\s*)?(['"]?)(.*?)\2\s*$/i),i=e?.[3]?O(this.input.entryPath,e[3]):null;if(!i)return null;let r=e[3].indexOf("#"),o=Et(i)+(r>=0?e[3].slice(r):"");return z("meta",[{name:"name",value:"dd-refresh"},{name:"content",value:`${e[1]??"0"};${o}`}])}attributes(n){let e=$i[n.name]??[],i=!1,r=n.attributes.map(s=>{if(s.value===null)return s;let a=null;return s.name==="style"&&/url\(/i.test(s.value)?a=this.css(s.value,this.input.entryPath):e.includes(s.name)&&(a=s.name==="srcset"?this.srcset(s.value):this.resolveUrl(this.input.entryPath,s.value)),a===null||a===s.value?s:(i=!0,{name:s.name,value:a})}),o=A(n,"src");return(n.name==="video"||n.name==="audio"||n.name==="source")&&o&&xi.test(o.split(/[?#]/,1)[0])&&this.warn("Audio and video do not play in previews."),i?z(n.name,r,n.selfClosing):null}run(){let{html:n,entryPath:e}=this.input,i="",r=0,o=!1,s=(d,c,u)=>{u!==null&&(i+=n.slice(r,d)+u,r=c)};for(let d of ft(n))if(d.name==="base")s(d.start,d.end,"");else if(d.name==="link"){let c=(A(d,"rel")??"").toLowerCase().split(/\s+/).filter(Boolean),u=A(d,"href");if(c.includes("stylesheet")&&!c.includes("alternate")&&(o=!0),!u)continue;if(c.includes("stylesheet")&&!c.includes("alternate"))s(d.start,d.end,this.stylesheet(d,u));else if(c.some(p=>p==="icon"||p==="apple-touch-icon"||p==="mask-icon")){let p=O(e,u),y=p?this.asset(p):null;if(y){let E=d.attributes.map(h=>h.name==="href"?{name:"href",value:y}:h);s(d.start,d.end,z("link",E))}}else c.some(p=>["preload","modulepreload","prefetch","prerender"].includes(p))&&O(e,u)&&s(d.start,d.end,"")}else if(d.name==="style"&&d.content){o=!0;let c=this.css(n.slice(d.content.start,d.content.end),e);s(d.start,d.content.closeEnd,`${n.slice(d.start,d.end)}${Ce(c)}</style>`)}else d.name==="script"&&d.content?s(d.start,d.content.closeEnd,this.script(d,n.slice(d.content.start,d.content.end))):d.name==="iframe"?O(e,A(d,"src")??"")&&this.warn("Pages embedded with <iframe> do not render in previews; link to them instead."):d.name==="meta"&&(A(d,"http-equiv")??"").toLowerCase()==="refresh"?s(d.start,d.end,this.refresh(d)):d.content||s(d.start,d.end,this.attributes(d));i+=n.slice(r),i=yt(i,`<base href="${Wt(ke(e))}">`);let a=[...this.files].filter(d=>d[1]!==null).map(([d,c])=>({path:d,revision:c.revision})).sort((d,c)=>d.path.localeCompare(c.path));return{html:i,deps:a,missing:[...this.missing].sort(),warnings:[...this.warnings],styled:o}}};function Ne(t){return new Vt(t).run()}import{randomBytes as Gi}from"node:crypto";var Oe=[`CREATE TABLE docs (
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
  CREATE INDEX doc_threads_by_thread ON doc_threads (thread_id);`,`ALTER TABLE doc_comments ADD COLUMN parent_id TEXT;
  CREATE INDEX doc_comments_by_parent ON doc_comments (doc_id, parent_id);`,`ALTER TABLE docs ADD COLUMN pinned_at INTEGER;
  ALTER TABLE docs ADD COLUMN alternative_to TEXT;`];var Dt="Agent",At="CLI agent",l=class extends Error{constructor(e,i){super(i);this.code=e;this.name="DesignDocError"}code},ee={assistant:1,reviewer:2,editor:3,author:4},Xe=`d.*,
  (SELECT COUNT(*) FROM doc_files f WHERE f.doc_id = d.id) AS file_count,
  (SELECT COUNT(*) FROM doc_comments c WHERE c.doc_id = d.id AND c.status = 'open' AND c.parent_id IS NULL) AS open_comments`,_t=class{constructor(n,e={}){this.db=n;this.now=e.now??Date.now,this.randomId=e.randomId??(i=>`${i}${Gi(6).toString("hex")}`),this.maxHistoryBytes=e.maxHistoryBytes??50331648,n.migrate(Oe)}db;now;randomId;maxHistoryBytes;list(n={}){let e=[],i=[];n.projectId!==void 0&&(n.projectId===null?e.push("d.project_id IS NULL"):(e.push("(d.project_id = ? OR d.project_id IS NULL)"),i.push(n.projectId)));let r=n.status??"all";if(r==="active")e.push("d.status <> 'archived'");else if(r!=="all"){if(!x(r))throw new l("invalid",`unknown status ${JSON.stringify(r)}`);e.push("d.status = ?"),i.push(r)}let o=typeof n.query=="string"?n.query.trim():"";if(o){let c=`%${Je(o)}%`,u=n.contents===!1?"":` OR EXISTS (SELECT 1 FROM doc_files f WHERE f.doc_id = d.id AND f.encoding = 'utf8'
          AND f.content LIKE ? ESCAPE '\\')`;e.push(`(d.title LIKE ? ESCAPE '\\' OR d.summary LIKE ? ESCAPE '\\'
        OR d.slug LIKE ? ESCAPE '\\' OR d.tags LIKE ? ESCAPE '\\'${u})`),i.push(c,c,c,c),u&&i.push(c)}let s=Ye(n.limit,50,200),a=`SELECT ${Xe} FROM docs d
      ${e.length?`WHERE ${e.join(" AND ")}`:""}
      ORDER BY d.updated_at DESC, d.id LIMIT ?`;return this.db.prepare(a).all(...i,s).map(Y)}find(n){let e=this.findRow(n);return e?Y(e):null}summary(n){return Y(this.requireRow(n))}get(n){let e=this.requireRow(n),i=this.db.prepare("SELECT doc_id, path, encoding, size, revision, updated_at, updated_by FROM doc_files WHERE doc_id = ?").all(e.id).map(rt).sort((s,a)=>it(s.path,a.path)),r=Ze(this.db.prepare("SELECT * FROM doc_comments WHERE doc_id = ? ORDER BY created_at, rowid").all(e.id)),o=this.db.prepare("SELECT thread_id, title, role, last_activity_at FROM doc_threads WHERE doc_id = ? ORDER BY last_activity_at DESC").all(e.id).map(Vi);return{...Y(e),files:i,comments:r,threads:o}}create(n,e){let i=Ge(n.title),r=Ke(n.summary??""),o=ze(n.tags??[]),s=n.status??"draft";if(!x(s))throw new l("invalid",`unknown status ${JSON.stringify(s)}`);let a,d;if(n.files&&n.files.length>0)a=n.files;else{let f=be(n.template??we);if(!f)throw new l("invalid",`unknown template ${JSON.stringify(n.template)}`);a=ve(f,{title:i,summary:r}),d=f.entryPath}if(a.length>500)throw new l("limit",`a design doc holds at most ${500} files`);let c=a.map(f=>We(f.path,f.content,f.encoding)),u=new Set;for(let f of c){let T=f.path.toLowerCase();if(u.has(T))throw new l("invalid",`duplicate file path ${f.path}`);u.add(T)}if(c.reduce((f,T)=>f+T.size,0)>25165824)throw new l("limit",`a design doc holds at most ${$(25165824)}`);let y=n.entryPath?C(n.entryPath):d??c.find(f=>f.path.toLowerCase()==="readme.md")?.path??c.find(f=>f.path.toLowerCase()==="index.html")?.path??c.find(f=>D(f.path)==="markdown")?.path??c[0].path;if(!c.some(f=>f.path===y))throw new l("invalid",`entryPath ${y} is not one of the doc's files`);let E=this.randomId("dd_"),h=this.now(),v=JSON.stringify(e);return this.db.transaction(()=>{let f=this.uniqueSlug(Ki(i));this.db.prepare(`INSERT INTO docs (id, slug, title, summary, status, project_id, tags, entry_path, revision,
            created_at, updated_at, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`).run(E,f,i,r,s,n.projectId??null,JSON.stringify(o),y,h,h,v,v);for(let T of c)this.insertFile(E,T,1,h,v),this.recordRevision(E,T.path,1,"create",T,v,h,{note:"Created"});e.threadId&&this.linkThreadRow(E,e.threadId,e.label,"author",h)}),this.get(E)}update(n,e,i){let r=this.requireRow(n),o=[],s=[];if(e.title!==void 0&&(o.push("title = ?"),s.push(Ge(e.title))),e.summary!==void 0&&(o.push("summary = ?"),s.push(Ke(e.summary))),e.status!==void 0){if(!x(e.status))throw new l("invalid",`unknown status ${JSON.stringify(e.status)}`);o.push("status = ?"),s.push(e.status)}if(e.tags!==void 0&&(o.push("tags = ?"),s.push(JSON.stringify(ze(e.tags)))),e.entryPath!==void 0){let a=C(e.entryPath);if(!this.fileRow(r.id,a))throw new l("invalid",`entryPath ${a} is not one of the doc's files`);o.push("entry_path = ?"),s.push(a)}return e.projectId!==void 0&&(o.push("project_id = ?"),s.push(e.projectId)),e.alternativeTo!==void 0&&(o.push("alternative_to = ?"),s.push(e.alternativeTo===null?null:this.alternativeTarget(r,e.alternativeTo))),o.length===0?Y(this.requireRow(r.id)):(this.db.transaction(()=>{this.db.prepare(`UPDATE docs SET ${o.join(", ")} WHERE id = ?`).run(...s,r.id),this.touch(r.id,i)}),Y(this.requireRow(r.id)))}setPinned(n,e){let i=this.requireRow(n);return e!==(i.pinned_at!==null)&&this.db.prepare("UPDATE docs SET pinned_at = ? WHERE id = ?").run(e?this.now():null,i.id),Y(this.requireRow(i.id))}remove(n){let e=this.requireRow(n);this.db.transaction(()=>{this.db.prepare("UPDATE docs SET alternative_to = NULL WHERE alternative_to = ?").run(e.id);for(let i of["doc_files","doc_revisions","doc_comments","doc_threads"])this.db.prepare(`DELETE FROM ${i} WHERE doc_id = ?`).run(e.id);this.db.prepare("DELETE FROM docs WHERE id = ?").run(e.id)})}readFile(n,e){let i=this.requireRow(n),r=C(e),o=this.fileRow(i.id,r);if(!o)throw this.missingFile(i.id,r);return{...rt(o),content:o.content,encoding:o.encoding==="base64"?"base64":"utf8"}}readAllFiles(n){let e=this.requireRow(n);return this.db.prepare("SELECT * FROM doc_files WHERE doc_id = ?").all(e.id).map(i=>({...rt(i),content:i.content,encoding:i.encoding==="base64"?"base64":"utf8"})).sort((i,r)=>it(i.path,r.path))}writeFile(n,e,i){let r=this.requireRow(n),o=We(e.path,e.content,e.encoding),s=Qt(e.note);return this.db.transaction(()=>{let a=this.fileRow(r.id,o.path);Tt(o.path,a,e.baseRevision),a||this.assertCanAdd(r.id,o.path),this.assertDocBudget(r.id,o.size-(a?.size??0));let d=this.now(),c=JSON.stringify(i),u;if(a){if(a.content===o.content&&a.encoding===o.encoding)return{...rt(a),docId:r.id,created:!1};u=a.revision+1,this.db.prepare(`UPDATE doc_files SET content = ?, encoding = ?, size = ?, revision = ?, updated_at = ?, updated_by = ?
              WHERE doc_id = ? AND path = ?`).run(o.content,o.encoding,o.size,u,d,c,r.id,o.path)}else u=this.nextRevisionFor(r.id,o.path),this.insertFile(r.id,o,u,d,c);return this.recordRevision(r.id,o.path,u,a?"write":"create",o,c,d,{note:s}),this.touch(r.id,i,d),i.threadId&&this.linkThreadRow(r.id,i.threadId,i.label,"editor",d),{...rt(this.fileRow(r.id,o.path)),docId:r.id,created:!a}})}writeFiles(n,e,i){let r=this.requireRow(n);return this.db.transaction(()=>e.map(o=>this.writeFile(r.id,o,i)))}editFile(n,e,i){let r=this.requireRow(n),o=C(e.path);if(!Array.isArray(e.edits)||e.edits.length===0)throw new l("invalid","edits must be a non-empty array");if(e.edits.length>50)throw new l("limit",`at most ${50} edits per call`);return this.db.transaction(()=>{let s=this.fileRow(r.id,o);if(!s)throw this.missingFile(r.id,o);if(s.encoding==="base64")throw new l("invalid",`${o} is a binary file; write it whole instead of editing`);Tt(o,s,e.baseRevision);let a=zi(s.content,e.edits,o);return this.writeFile(r.id,{path:o,content:a,baseRevision:s.revision,note:e.note},i)})}deleteFile(n,e,i,r={}){let o=this.requireRow(n),s=C(e);this.db.transaction(()=>{let a=this.fileRow(o.id,s);if(!a)throw this.missingFile(o.id,s);if(Tt(s,a,r.baseRevision),this.fileCount(o.id)<=1)throw new l("invalid","a design doc must keep at least one file");let c=this.now(),u=JSON.stringify(i);if(this.db.prepare("DELETE FROM doc_files WHERE doc_id = ? AND path = ?").run(o.id,s),this.recordRevision(o.id,s,a.revision+1,"delete",a,u,c,{note:Qt(r.note)}),o.entry_path===s){let p=this.firstFilePath(o.id);this.db.prepare("UPDATE docs SET entry_path = ? WHERE id = ?").run(p,o.id)}this.touch(o.id,i,c),i.threadId&&this.linkThreadRow(o.id,i.threadId,i.label,"editor",c)})}renameFile(n,e,i,r,o={}){let s=this.requireRow(n),a=C(e),d=C(i);if(a===d)throw new l("invalid","renameTo must differ from path");return this.db.transaction(()=>{let c=this.fileRow(s.id,a);if(!c)throw this.missingFile(s.id,a);if(Tt(a,c,o.baseRevision),et(D(a))!==et(D(d)))throw new l("invalid",`cannot rename ${a} to ${d}: the file type would change encoding`);let u=this.caseInsensitiveClash(s.id,d,a);if(u)throw new l("conflict",`${u} already exists in this design doc`);let p=this.now(),y=JSON.stringify(r),E=Qt(o.note),h=c.revision+1;this.db.prepare("DELETE FROM doc_files WHERE doc_id = ? AND path = ?").run(s.id,a),this.recordRevision(s.id,a,h,"delete",c,y,p,{note:E??`Renamed to ${d}`});let v=this.nextRevisionFor(s.id,d),f={path:d,content:c.content,encoding:c.encoding,size:c.size};return this.insertFile(s.id,f,v,p,y),this.recordRevision(s.id,d,v,"rename",f,y,p,{note:E,renamedFrom:a}),this.db.prepare("UPDATE doc_comments SET path = ? WHERE doc_id = ? AND path = ?").run(d,s.id,a),s.entry_path===a&&this.db.prepare("UPDATE docs SET entry_path = ? WHERE id = ?").run(d,s.id),this.touch(s.id,r,p),r.threadId&&this.linkThreadRow(s.id,r.threadId,r.label,"editor",p),{...rt(this.fileRow(s.id,d)),docId:s.id,created:!0}})}history(n,e={}){let i=this.requireRow(n),r=Ye(e.limit,50,100),o="id, doc_id, path, revision, op, size, note, renamed_from, actor, created_at";return(e.path?this.db.prepare(`SELECT ${o} FROM doc_revisions WHERE doc_id = ? AND path = ? ORDER BY id DESC LIMIT ?`).all(i.id,C(e.path),r):this.db.prepare(`SELECT ${o} FROM doc_revisions WHERE doc_id = ? ORDER BY id DESC LIMIT ?`).all(i.id,r)).map(Ve)}revisionContent(n,e){let i=this.requireRow(n),r=this.revisionRow(i.id,e);return{...Ve(r),content:r.content,encoding:r.encoding==="base64"?"base64":"utf8"}}restoreRevision(n,e,i,r={}){let o=this.requireRow(n),s=this.revisionRow(o.id,e);return this.writeFile(o.id,{path:s.path,content:s.content,encoding:s.encoding==="base64"?"base64":"utf8",baseRevision:r.baseRevision,note:`Restored revision ${s.revision}`},i)}addComment(n,e,i){let r=this.requireRow(n),o=te(e.body),s=e.path?C(e.path):null;if(s&&!this.fileRow(r.id,s))throw this.missingFile(r.id,s);let a=typeof e.quote=="string"&&e.quote.trim()?e.quote.trim().slice(0,500):null,d=this.randomId("c_"),c=this.now();return this.db.transaction(()=>{this.insertComment(r.id,{id:d,parentId:null,path:s,quote:a,body:o},i,c),this.touchReview(r.id),i.threadId&&this.linkThreadRow(r.id,i.threadId,i.label,"reviewer",c)}),this.commentById(r.id,d)}addReply(n,e,i,r){let o=this.requireRow(n),s=te(i),a=this.now(),d="";return this.db.transaction(()=>{d=this.rootComment(o,e).id,this.insertComment(o.id,{id:this.randomId("c_"),parentId:d,path:null,quote:null,body:s},r,a),this.touchReview(o.id),r.threadId&&this.linkThreadRow(o.id,r.threadId,r.label,"reviewer",a)}),this.commentById(o.id,d)}setCommentStatus(n,e,i,r,o){let s=this.requireRow(n);if(i!=="open"&&i!=="resolved")throw new l("invalid",`unknown comment status ${JSON.stringify(i)}`);let a=typeof o=="string"&&o.trim()?te(o):null,d=this.now(),c="";return this.db.transaction(()=>{c=this.rootComment(s,e).id,this.db.prepare("UPDATE doc_comments SET status = ?, resolved_at = ? WHERE doc_id = ? AND id = ?").run(i,i==="resolved"?d:null,s.id,c),a&&this.insertComment(s.id,{id:this.randomId("c_"),parentId:c,path:null,quote:null,body:a},r,d),this.touchReview(s.id),r.threadId&&this.linkThreadRow(s.id,r.threadId,r.label,"reviewer",d)}),this.commentById(s.id,c)}deleteComment(n,e,i){let r=this.requireRow(n),o=String(e??"");this.db.transaction(()=>{if(this.db.prepare("DELETE FROM doc_comments WHERE doc_id = ? AND id = ?").run(r.id,o).changes===0)throw new l("not_found",`comment ${o} not found in ${r.slug}`);this.db.prepare("DELETE FROM doc_comments WHERE doc_id = ? AND parent_id = ?").run(r.id,o),this.touchReview(r.id)})}linkThread(n,e,i,r){let o=this.requireRow(n);this.db.transaction(()=>this.linkThreadRow(o.id,e,i,r,this.now()))}unlinkThread(n,e){let i=this.requireRow(n);this.db.prepare("DELETE FROM doc_threads WHERE doc_id = ? AND thread_id = ?").run(i.id,e)}touchThread(n,e){let i=this.docsForThread(n);if(i.length===0)return i;let r=this.now(),o=e?.trim().slice(0,140)??"";return this.db.prepare("UPDATE doc_threads SET last_activity_at = ?, title = CASE WHEN ? <> '' THEN ? ELSE title END WHERE thread_id = ?").run(r,o,o,n),i}forgetThread(n){let e=this.docsForThread(n);return e.length&&this.db.prepare("DELETE FROM doc_threads WHERE thread_id = ?").run(n),e}docsForThread(n){return this.db.prepare("SELECT doc_id FROM doc_threads WHERE thread_id = ?").all(n).map(e=>e.doc_id)}findRow(n){if(typeof n!="string"||!n.trim())return null;let e=n.trim();return this.db.prepare(`SELECT ${Xe} FROM docs d WHERE d.id = ? OR d.slug = ? LIMIT 1`).get(e,e.toLowerCase())??null}alternativeTarget(n,e){let i=this.requireRow(e);if(i.id===n.id)throw new l("invalid","a doc cannot be an alternative to itself");if(i.alternative_to!==null)throw new l("invalid",`${i.slug} is itself an alternative; point at the doc it is an alternative to (${i.alternative_to})`);if(this.db.prepare("SELECT COUNT(*) AS n FROM docs WHERE alternative_to = ?").get(n.id).n>0)throw new l("invalid",`${n.slug} has its own alternatives; detach them before making it an alternative`);return i.id}requireRow(n){let e=this.findRow(n);if(!e)throw new l("not_found",`design doc ${JSON.stringify(n)} not found; list docs to get a valid id or slug`);return e}fileRow(n,e){return this.db.prepare("SELECT * FROM doc_files WHERE doc_id = ? AND path = ?").get(n,e)??null}fileCount(n){return this.db.prepare("SELECT COUNT(*) AS n FROM doc_files WHERE doc_id = ?").get(n).n}firstFilePath(n){let e=this.db.prepare("SELECT path FROM doc_files WHERE doc_id = ?").all(n).map(i=>i.path).sort(it);return e.find(i=>i.toLowerCase()==="readme.md")??e.find(i=>D(i)==="markdown")??e[0]}missingFile(n,e){let i=this.db.prepare("SELECT path FROM doc_files WHERE doc_id = ? ORDER BY path LIMIT 40").all(n).map(r=>r.path);return new l("not_found",`${e} not found; files: ${i.join(", ")||"(none)"}`)}caseInsensitiveClash(n,e,i){return this.db.prepare("SELECT path FROM doc_files WHERE doc_id = ? AND lower(path) = lower(?) AND path <> ? LIMIT 1").get(n,e,i??"")?.path??null}assertCanAdd(n,e){let i=this.caseInsensitiveClash(n,e);if(i)throw new l("conflict",`${i} already exists with different letter case`);if(this.fileCount(n)>=500)throw new l("limit",`a design doc holds at most ${500} files`)}assertDocBudget(n,e){if(e<=0)return;if(this.db.prepare("SELECT COALESCE(SUM(size), 0) AS n FROM doc_files WHERE doc_id = ?").get(n).n+e>25165824)throw new l("limit",`a design doc holds at most ${$(25165824)} of files`)}nextRevisionFor(n,e){return(this.db.prepare("SELECT MAX(revision) AS n FROM doc_revisions WHERE doc_id = ? AND path = ?").get(n,e).n??0)+1}insertFile(n,e,i,r,o){this.db.prepare(`INSERT INTO doc_files (doc_id, path, content, encoding, size, revision, updated_at, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(n,e.path,e.content,e.encoding,e.size,i,r,o)}recordRevision(n,e,i,r,o,s,a,d={}){this.db.prepare(`INSERT INTO doc_revisions (doc_id, path, revision, op, content, encoding, size, note, renamed_from, actor, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(n,e,i,r,o.content,o.encoding,o.size,d.note??null,d.renamedFrom??null,s,a);let c=o.encoding==="base64"?3:o.size>262144?5:25;this.db.prepare(`DELETE FROM doc_revisions WHERE doc_id = ? AND path = ? AND id NOT IN (
          SELECT id FROM doc_revisions WHERE doc_id = ? AND path = ? ORDER BY id DESC LIMIT ?)`).run(n,e,n,e,c),this.pruneHistoryBytes(n)}pruneHistoryBytes(n){let e=this.db.prepare("SELECT COALESCE(SUM(size), 0) AS n FROM doc_revisions WHERE doc_id = ?").get(n).n;if(e<=this.maxHistoryBytes)return;let i=this.db.prepare(`SELECT id, size FROM doc_revisions r WHERE doc_id = ? AND id <> (
          SELECT MAX(id) FROM doc_revisions WHERE doc_id = r.doc_id AND path = r.path) ORDER BY id ASC`).all(n),r=e-this.maxHistoryBytes,o=this.db.prepare("DELETE FROM doc_revisions WHERE id = ?");for(let s of i){if(r<=0)break;o.run(s.id),r-=s.size}}touch(n,e,i=this.now()){this.db.prepare("UPDATE docs SET revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ?").run(i,JSON.stringify(e),n)}touchReview(n){this.db.prepare("UPDATE docs SET revision = revision + 1 WHERE id = ?").run(n)}linkThreadRow(n,e,i,r,o){let s=this.db.prepare("SELECT role, title FROM doc_threads WHERE doc_id = ? AND thread_id = ?").get(n,e),a=s&&(ee[s.role]??0)>=ee[r]?s.role:r,d=i.trim(),c=(d===Dt?"":d)||s?.title||d;this.db.prepare(`INSERT INTO doc_threads (doc_id, thread_id, title, role, last_activity_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (doc_id, thread_id) DO UPDATE SET title = excluded.title, role = excluded.role,
          last_activity_at = excluded.last_activity_at`).run(n,e,c.slice(0,140),a,o),this.db.prepare(`DELETE FROM doc_threads WHERE doc_id = ? AND thread_id NOT IN (
          SELECT thread_id FROM doc_threads WHERE doc_id = ? ORDER BY last_activity_at DESC LIMIT ?)`).run(n,n,50)}revisionRow(n,e){let i=Number(e),r=Number.isInteger(i)?this.db.prepare("SELECT * FROM doc_revisions WHERE doc_id = ? AND id = ?").get(n,i):void 0;if(!r)throw new l("not_found",`revision ${String(e)} not found`);return r}commentById(n,e){let i=this.db.prepare("SELECT * FROM doc_comments WHERE doc_id = ? AND (id = ? OR parent_id = ?) ORDER BY created_at, rowid").all(n,e,e);return Ze(i)[0]}rootComment(n,e){let i=String(e??""),r=this.db.prepare("SELECT * FROM doc_comments WHERE doc_id = ? AND id = ?").get(n.id,i);if(!r)throw new l("not_found",`comment ${i} not found in ${n.slug}`);if(r.parent_id)throw new l("invalid",`${i} is a reply; use its comment ${r.parent_id} instead`);return r}insertComment(n,e,i,r){if(this.db.prepare("SELECT COUNT(*) AS n FROM doc_comments WHERE doc_id = ?").get(n).n>=500)throw new l("limit",`a design doc holds at most ${500} comments and replies; delete resolved ones first`);this.db.prepare(`INSERT INTO doc_comments (id, doc_id, parent_id, path, quote, body, author, status, created_at, resolved_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, NULL)`).run(e.id,n,e.parentId,e.path,e.quote,e.body,JSON.stringify(i),r)}uniqueSlug(n){let e=new Set(this.db.prepare("SELECT slug FROM docs WHERE slug = ? OR slug LIKE ? ESCAPE '\\'").all(n,`${Je(n)}-%`).map(i=>i.slug));if(!e.has(n))return n;for(let i=2;;i+=1){let r=`${n}-${i}`;if(!e.has(r))return r}}};function Ki(t){return t.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,48).replace(/-+$/g,"")||"design-doc"}function zi(t,n,e){let i=t;return n.forEach((r,o)=>{let s=n.length>1?` (edit ${o+1})`:"";if(!r||typeof r.oldText!="string"||typeof r.newText!="string")throw new l("invalid",`each edit needs string oldText and newText${s}`);if(!r.oldText)throw new l("invalid",`oldText must not be empty${s}`);if(r.oldText===r.newText)throw new l("invalid",`oldText and newText are identical${s}`);let a=Yi(i,r.oldText);if(a===0)throw new l("conflict",`oldText not found in ${e}${s}; re-read the file and match its text exactly, including whitespace`);if(a>1&&!r.replaceAll)throw new l("conflict",`oldText matches ${a} places in ${e}${s}; include more surrounding text or set replaceAll`);i=r.replaceAll?i.split(r.oldText).join(r.newText):i.replace(r.oldText,()=>r.newText)}),i}function Yi(t,n){let e=0,i=t.indexOf(n);for(;i!==-1;)e+=1,i=t.indexOf(n,i+n.length);return e}function C(t){try{return L(t)}catch(n){throw n instanceof S?new l("invalid",n.message):n}}function We(t,n,e){let i=C(t);if(typeof n!="string")throw new l("invalid",`content for ${i} must be a string`);let r=et(D(i)),o=e??(r?"base64":"utf8");if(r&&o!=="base64")throw new l("invalid",`${i} is a binary file; send its bytes base64-encoded`);if(!r&&o!=="utf8")throw new l("invalid",`${i} is a text file; send it as UTF-8 text`);if(o==="base64"){let a=n.replace(/\s+/g,"");if(!/^[A-Za-z0-9+/]*={0,2}$/.test(a)||a.length%4!==0)throw new l("invalid",`content for ${i} is not valid base64`);let d=Buffer.from(a,"base64").length;if(d>2097152)throw new l("limit",`${i} exceeds the ${$(2097152)} binary file limit`);return{path:i,content:a,encoding:"base64",size:d}}let s=Buffer.byteLength(n,"utf8");if(s>2097152)throw new l("limit",`${i} exceeds the ${$(2097152)} file limit; split it into several files`);return{path:i,content:n,encoding:"utf8",size:s}}function Tt(t,n,e){if(e==null)return;if(!Number.isInteger(e)||e<0)throw new l("invalid","baseRevision must be a non-negative integer");let i=n?.revision??0;if(i!==e)throw new l("conflict",n?`${t} changed since revision ${e} (now ${i}, last edited by ${N(V(n.updated_by))}); re-read it and reapply your change`:`${t} does not exist (expected revision ${e}); re-read the doc`)}function Ge(t){let n=typeof t=="string"?t.replace(/\s+/g," ").trim():"";if(!n)throw new l("invalid","title is required");if(n.length>140)throw new l("invalid",`title must be at most ${140} characters`);return n}function Ke(t){let n=typeof t=="string"?t.trim():"";if(n.length>600)throw new l("invalid",`summary must be at most ${600} characters`);return n}function ze(t){if(!Array.isArray(t))throw new l("invalid","tags must be an array of strings");let n=[];for(let e of t){if(typeof e!="string")throw new l("invalid","tags must be an array of strings");let i=e.trim().toLowerCase().replace(/\s+/g,"-");if(i){if(i.length>32)throw new l("invalid",`tag ${JSON.stringify(i)} is longer than ${32} characters`);n.includes(i)||n.push(i)}}if(n.length>12)throw new l("invalid",`at most ${12} tags`);return n}function Qt(t){if(typeof t!="string")return null;let n=t.replace(/\s+/g," ").trim();return n?n.slice(0,200):null}function Ye(t,n,e){let i=typeof t=="number"?Math.floor(t):Number.NaN;return!Number.isFinite(i)||i<=0?n:Math.min(i,e)}function Je(t){return t.replace(/[\\%_]/g,n=>`\\${n}`)}function V(t){try{let n=JSON.parse(t);return{kind:n.kind==="agent"?"agent":"user",label:typeof n.label=="string"&&n.label?n.label:"Unknown",threadId:typeof n.threadId=="string"?n.threadId:null}}catch{return{kind:"user",label:"Unknown",threadId:null}}}function Ji(t){try{let n=JSON.parse(t);return Array.isArray(n)?n.filter(e=>typeof e=="string"):[]}catch{return[]}}function Y(t){return{id:t.id,slug:t.slug,title:t.title,summary:t.summary,status:x(t.status)?t.status:"draft",projectId:t.project_id,tags:Ji(t.tags),entryPath:t.entry_path,fileCount:Number(t.file_count??0),openComments:Number(t.open_comments??0),pinnedAt:t.pinned_at??null,alternativeTo:t.alternative_to??null,revision:t.revision,createdAt:t.created_at,updatedAt:t.updated_at,createdBy:V(t.created_by),updatedBy:V(t.updated_by)}}function rt(t){return{path:t.path,kind:D(t.path),size:t.size,revision:t.revision,updatedAt:t.updated_at,updatedBy:V(t.updated_by)}}function Ve(t){return{id:t.id,path:t.path,revision:t.revision,op:["create","write","delete","rename"].includes(t.op)?t.op:"write",size:t.size,note:t.note,renamedFrom:t.renamed_from,actor:V(t.actor),createdAt:t.created_at}}function Ze(t){let n=new Map;for(let e of t)e.parent_id||n.set(e.id,{id:e.id,docId:e.doc_id,path:e.path,quote:e.quote,body:e.body,author:V(e.author),status:e.status==="resolved"?"resolved":"open",createdAt:e.created_at,resolvedAt:e.resolved_at,replies:[]});for(let e of t)e.parent_id&&n.get(e.parent_id)?.replies.push({id:e.id,body:e.body,author:V(e.author),createdAt:e.created_at});return[...n.values()]}function te(t){let n=typeof t=="string"?t.trim():"";if(!n)throw new l("invalid","comment body is required");if(n.length>8e3)throw new l("limit",`comment body must be at most ${8e3} characters`);return n}function Vi(t){let n=t.role;return{threadId:t.thread_id,title:t.title,role:n in ee?n:"assistant",lastActivityAt:t.last_activity_at}}var M=()=>null,er=200,nr=8*1024*1024;function rn(t){let n=new Map,e,i=r=>{let o;try{o=L(r)}catch{return null}if(e===void 0)try{e=Qe(t)}catch{e=null}if(!e)return null;try{let s=Qe(Qi(e,o));if(!s.startsWith(e+tr))return null;let a=Zi(s);if(!a.isFile()||a.size>2097152)return null;let d=D(o),c=et(d),u=nn(s,c?"base64":"utf8");return{path:`${X}/${o}`,kind:d,content:u,encoding:c?"base64":"utf8",revision:0}}catch{return null}};return r=>{if(n.has(r))return n.get(r);let o=i(r);return n.size<er&&n.set(r,o),o}}function xt(t,n,e){return i=>{try{let r=t.readFile(n,i);return{path:r.path,kind:r.kind,content:r.content,encoding:r.encoding,revision:r.revision}}catch(r){if(!(r instanceof l)||r.code!=="not_found"&&r.code!=="invalid")throw r}return i.startsWith(`${X}/`)?e(i.slice(X.length+1)):null}}function on(t){try{return L(t)}catch(n){throw new l("invalid",n.message)}}function ot(t,n,e){let i=t.summary(e.doc),r=on(e.path??i.entryPath);if(D(r)!=="html")throw new l("invalid",`${r} is not an HTML page`);if(e.draft!==void 0&&en.byteLength(e.draft,"utf8")>2097152)throw new l("limit",`the draft of ${r} is larger than a doc file may be`);let o=xt(t,i.id,n),s=o(r);if(e.draft===void 0&&(!s||s.revision===0))throw new l("not_found",`${r} not found in ${i.slug}`);let a=e.draft??s.content,d=Ne({entryPath:r,html:a,read:o});return{docId:i.id,path:r,revision:s&&s.revision>0?s.revision:null,...d}}function ir(t,n,e=nr){let i=new Set([n.path,...n.deps.map(a=>a.path)]),r=t.filter(a=>!i.has(a.path)).sort((a,d)=>+(a.encoding==="base64")-+(d.encoding==="base64")||it(a.path,d.path)),o={},s=0;for(let a of r){let d=a.content.length+a.path.length;s+d>e||(s+=d,o[a.path]={kind:a.kind,encoding:a.encoding,content:a.content})}return o}function rr(t,n,e,i){let r=ot(t,n,{doc:e.doc,path:e.path}),o=t.readAllFiles(r.docId),s={mode:"standalone",docId:r.docId,path:r.path,endpoint:i.endpoint,files:o.map(c=>c.path),missing:r.missing,warnings:r.warnings},a=ir(o,r,i.packBudget),d=`<script type="application/json" id="${Ae}">${Yt(s)}</script><script type="application/json" id="${xe}">${Yt(a)}</script><script>${Zt(i.runtime)}</script>`;return yt(r.html,d)}var or=["sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox","default-src 'none'","script-src 'unsafe-inline' blob:","style-src 'unsafe-inline'","img-src data: blob: https:","font-src data:","connect-src https:","form-action 'none'",`base-uri ${vt}`,"frame-ancestors 'none'"].join("; "),sn="sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'none'",ie={"cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer","cross-origin-resource-policy":"same-origin"};function tn(t){let n=t instanceof l?t.code:null,e=n==="not_found"?404:n==="invalid"||n==="limit"?400:500,i=n?t.message:"The page could not be rendered.";return{status:e,body:`${i}
`,headers:{...ie,"content-type":"text/plain; charset=utf-8","content-security-policy":sn}}}function an(t,n){let e=t.query[n];return typeof e=="string"&&e?e:void 0}function ne(t,n){let e=an(t,n);if(!e)throw new l("invalid",`${n} is required`);return e}function sr(t){let n=D(t);return n==="image"?nt(t)??"application/octet-stream":n==="font"?wt(t):n==="svg"?"image/svg+xml":"text/plain; charset=utf-8"}function dn(t){let n=(e,i)=>({status:200,body:rr(t.store,t.kit,{doc:e,path:i},{endpoint:t.endpoint,runtime:t.runtime()}),headers:{...ie,"content-type":"text/html; charset=utf-8","content-security-policy":or}});return{page(e){try{return n(ne(e,"doc"),an(e,"path"))}catch(i){return tn(i)}},file(e){try{let i=ne(e,"doc"),r=on(ne(e,"path"));if(D(r)==="html")return n(i,r);let o=t.store.summary(i),s=xt(t.store,o.id,t.kit)(r);if(!s)throw new l("not_found",`${r} not found in ${o.slug}`);return{status:200,body:s.encoding==="base64"?new Uint8Array(en.from(s.content,"base64")):s.content,headers:{...ie,"content-type":sr(r),"content-security-policy":sn}}}catch(i){return tn(i)}}}}function cn(t){return`/api/v1/plugins/${encodeURIComponent(t)}/http`}function ln(t,n,e,i){let r=new URL(`${n}/page`,t);return r.searchParams.set("doc",e),r.searchParams.set("path",i),r.href}function un(t=process.env){let n=t.ZCC_SERVER_URL?.trim();return n?n.replace(/\/+$/,""):`http://127.0.0.1:${t.ZCC_SERVER_PORT&&/^\d+$/.test(t.ZCC_SERVER_PORT)?t.ZCC_SERVER_PORT:"8780"}`}function pn(t,n=()=>{}){let e=null;return()=>{if(e!==null)return e;let i;try{i=nn(t,"utf8")}catch(r){return n(`page runtime unavailable: ${r.message}`),""}return e=i,i}}function oe(t,n){return{projectName:t.projectName?.(n.projectId)??null}}function w(t){return t&&typeof t=="object"&&!Array.isArray(t)?t:{}}function g(t,n){let e=t[n];if(typeof e!="string"||!e.trim())throw new l("invalid",`${n} is required`);return e}function m(t,n){let e=t[n];if(e!=null){if(typeof e!="string")throw new l("invalid",`${n} must be a string`);return e}}function j(t,n){let e=t.store.find(n);if(!e)return n;if(e.id!==n.trim()&&t.projectId&&e.projectId&&e.projectId!==t.projectId){let r=t.projectName?.(e.projectId)??e.projectId;throw new l("invalid",`"${n.trim()}" is a design doc in project ${r} (${e.id}), not this one. Pass its id to use it from here, or call design_doc_list to find this project's doc.`)}return e.id}function se(t,n){let e=t[n];if(e==null||e==="")return;let i=typeof e=="string"?Number(e):e;if(typeof i!="number"||!Number.isInteger(i))throw new l("invalid",`${n} must be an integer`);return i}function gn(t,n){let e=t[n];if(e!=null){if(typeof e=="string")return e.split(",").map(i=>i.trim()).filter(Boolean);if(!Array.isArray(e)||e.some(i=>typeof i!="string"))throw new l("invalid",`${n} must be an array of strings`);return e}}function mn(t,n){let e=m(t,n);if(e!==void 0){if(!x(e))throw new l("invalid",`${n} must be one of ${B.join(", ")}`);return e}}function It(t,n){let e=w(n),i=m(e,"scope")??"project";if(i!=="project"&&i!=="all")throw new l("invalid","scope must be project or all");let r=m(e,"status")??"active";if(r!=="active"&&r!=="all"&&!x(r))throw new l("invalid",`status must be active, all, or one of ${B.join(", ")}`);let o=t.store.list({projectId:i==="project"&&t.projectId?t.projectId:void 0,query:m(e,"query"),status:r,limit:se(e,"limit")});return`${i==="project"&&t.projectId?"Design docs for this project (plus global docs), newest first:":"Design docs across all projects, newest first:"}
${Ee(o)}`}var ar=5;function hn(t,n,e){if(D(e)!=="html")return[];let i=[];try{let o=Ut(ot(t.store,t.kit??M,{doc:n.id,path:e}));o&&i.push(o)}catch{}let r=t.reports?.current(n.id,n.files).find(o=>o.path===e);return r&&i.push(qt(r,n.comments)),i}function dr(t,n){let e=(t.reports?.current(n.id,n.files)??[]).filter(o=>o.path!==n.entryPath&&Bt(o,n.comments).length);if(!e.length)return null;let i=e.slice(0,ar).map(o=>qt(o,n.comments)),r=e.length-i.length;return["## Page problems",...i,r?`(${r} more page(s) had problems; read them by path.)`:""].filter(Boolean).join(`

`)}var cr=new Set(["image/png","image/jpeg","image/gif","image/webp"]);function Pt(t,n){let e=w(n),i=j(t,g(e,"doc")),r=m(e,"path"),o=t.store.get(i);if(r){let d=t.store.readFile(o.id,r),c=`${G(d)}

To change it, call design_doc_write with doc="${o.id}", path="${d.path}", baseRevision=${d.revision}.`,u=d.encoding==="base64"?nt(d.path):null;return u&&cr.has(u)?{content:[{type:"text",text:c},{type:"image",data:d.content,mimeType:u}]}:[c,...hn(t,o,d.path)].join(`

`)}if(e.includeAll===!0||e.includeAll==="true")return`${gt(o,t.store.readAllFiles(o.id),oe(t,o))}

${mt(o)}`;let s=o.files.some(d=>d.path===o.entryPath),a=s?G(t.store.readFile(o.id,o.entryPath)):"";return[Q(o,oe(t,o)),a?`## Entry file
${a}`:"",...s?hn(t,o,o.entryPath):[],dr(t,o)??"",'Read other files with design_doc_read path="\u2026", or everything at once with includeAll=true.',mt(o)].filter(Boolean).join(`

`)}function $t(t,n,e){let i=w(n),r=m(i,"template");if(r&&!k.some(d=>d.id===r))throw new l("invalid",`template must be one of ${k.map(d=>d.id).join(", ")}`);let o=i.files;if(o!==void 0&&!Array.isArray(o))throw new l("invalid","files must be an array");let s=i.global===!0||i.global==="true",a=t.store.create({title:g(i,"title"),summary:m(i,"summary"),tags:gn(i,"tags"),status:mn(i,"status"),template:r,files:o?.map((d,c)=>{let u=w(d);if(typeof u.path!="string"||typeof u.content!="string")throw new l("invalid",`files[${c}] needs string path and content`);let p=u.encoding==="base64"?"base64":void 0;return{path:u.path,content:u.content,encoding:p}}),entryPath:m(i,"entryPath"),projectId:s?null:t.projectId??null},e);return t.changed(a.id),`Created design doc ${a.id} ("${a.title}").

${Q(a,oe(t,a))}

${mt(a)}`}function Z(t,n,e){let i=w(n),r=j(t,g(i,"doc")),o=g(i,"path"),s=se(i,"baseRevision"),a=m(i,"note"),d=m(i,"content"),c=m(i,"renameTo"),u=i.delete===!0||i.delete==="true",p=i.edits??void 0;if([d!==void 0,p!==void 0,u,c!==void 0].filter(Boolean).length!==1)throw new l("invalid","pass exactly one of content, edits, delete or renameTo");let E=t.store.summary(r);if(u)return t.store.deleteFile(E.id,o,e,{baseRevision:s,note:a}),t.changed(E.id),`Deleted ${o} from ${E.id}. It stays in history and can be restored from the Design Docs panel.`;if(c!==void 0){let T=t.store.renameFile(E.id,o,c,e,{baseRevision:s,note:a});return t.changed(T.docId),`Renamed ${o} to ${T.path} (rev ${T.revision}).`}let h;if(p!==void 0){if(!Array.isArray(p))throw new l("invalid","edits must be an array");h=t.store.editFile(E.id,{path:o,edits:p,baseRevision:s,note:a},e)}else{let T=i.encoding==="base64"?"base64":void 0;h=t.store.writeFile(E.id,{path:o,content:d,encoding:T,baseRevision:s,note:a},e)}return t.changed(h.docId),[`${h.created?"Created":"Updated"} ${h.path} in ${h.docId} \u2192 revision ${h.revision}. Use baseRevision=${h.revision} for your next change to this file. The user sees updates live in the Design Docs panel.`,...lr(t,h.docId,h.path)].join(`

`)}function lr(t,n,e){if(D(e)!=="html")return[];let i=[];try{let r=Ut(ot(t.store,t.kit??M,{doc:n,path:e}));r&&i.push(r),Kt(t.store.readFile(n,e).content).scripted&&i.push("Its scripts run when the page is open in the Design Docs panel; read the page again after that to see any script errors.")}catch{}return i}function St(t,n,e){let i=w(n),r=j(t,g(i,"doc")),o=m(i,"alternativeTo"),s=t.store.update(r,{title:m(i,"title"),summary:m(i,"summary"),status:mn(i,"status"),tags:gn(i,"tags"),entryPath:m(i,"entryPath"),alternativeTo:o===void 0?void 0:o.trim()?j(t,o):null},e);t.changed(s.id);let a=s.alternativeTo?` \xB7 alternative to ${s.alternativeTo}`:"";return`Updated ${s.id}: "${s.title}" \xB7 ${s.status} \xB7 tags: ${s.tags.join(", ")||"none"} \xB7 entry: ${s.entryPath}${a}`}function st(t,n,e){let i=w(n),r=j(t,g(i,"doc")),o={resolve:m(i,"resolve"),reopen:m(i,"reopen"),replyTo:m(i,"replyTo")},s=Object.entries(o).filter(([,p])=>p?.trim());if(s.length>1)throw new l("invalid",`pass only one of resolve, reopen or replyTo (got ${s.map(([p])=>p).join(" and ")})`);let[a,d]=s[0]??[];if(a&&(i.path!==void 0||i.quote!==void 0))throw new l("invalid",`path and quote anchor a new comment; ${a} keeps the comment's own anchor`);if(a==="replyTo"){let p=t.store.addReply(r,d,g(i,"body"),e);return t.changed(p.docId),`Replied to comment ${p.id}.
${ct(p)}`}if(a){let p=m(i,"body"),y=t.store.setCommentStatus(r,d,a==="resolve"?"resolved":"open",e,p);return t.changed(y.docId),`${a==="resolve"?"Resolved":"Reopened"} comment ${y.id}${p?.trim()?" and added your reply":""}.
${ct(y)}`}let c=t.store.addComment(r,{body:g(i,"body"),path:m(i,"path"),quote:m(i,"quote")},e);t.changed(c.docId);let u=c.quote?ur(t.store,c):null;return`Added comment ${c.id}.
${ct(c)}${u?`

${u}`:""}`}function re(t){return t.replace(/!?\[([^\]]*)\]\([^)]*\)/g,"$1").replace(/[*_`~#>|]/g,"").replace(/\s+/g," ").trim().toLowerCase()}function ur(t,n){if(!n.path)return"Note: the quote has no path, so the panel cannot highlight it. Pass path with quote next time.";let e=t.readFile(n.docId,n.path);if(e.encoding!=="utf8")return null;let i=re(n.quote);if(e.kind==="html"){let r=Kt(e.content);return re(r.text).includes(i)?null:r.scripted?`Note: the quote is not in the HTML of ${n.path}. The panel highlights it if the page's scripts show that text; otherwise quote the text as the page shows it.`:`Note: the quote does not appear on ${n.path}, so the panel cannot highlight it. Quote the text as the page shows it, not its HTML.`}return re(e.content).includes(i)?null:`Note: the quote does not appear in ${n.path}, so the panel cannot highlight it. Quote the passage exactly as written.`}function fn(t,n){let e=w(n),i=j(t,g(e,"doc"));return Te(t.store.history(i,{path:m(e,"path"),limit:se(e,"limit")}))}var yn=".nojekyll";function Lt(t,n){let e=t.map(({path:o,content:s,encoding:a})=>({path:o,content:s,encoding:a})),i=new Set(t.map(o=>o.path));if(t.some(o=>o.encoding==="utf8"&&o.content.includes(`${X}/`)))for(let o of $e){let s=`${X}/${o}`,a=i.has(s)?null:n(o);a&&e.push({path:s,content:a.content,encoding:a.encoding})}return t.some(o=>o.kind==="html")&&!i.has(yn)&&e.push({path:yn,content:"",encoding:"utf8"}),e}function wn(t){let n=t.split("/");return n.some(e=>e.startsWith("."))?"hidden":n.includes("node_modules")?"dependencies":n[0]===X?"the site kit; Design Docs serves it and export copies it":null}async function ae(t,n,e){let i=[],r=0,o=!1,s=async()=>{for(;!o&&r<t.length;){let a=r;r+=1;try{i[a]=await e(t[a])}catch(d){throw o=!0,d}}};return await Promise.all(Array.from({length:Math.min(n,t.length)},s)),i}var gr="design-docs",kt=[{name:"list",summary:"List design docs",usage:"list [--query <text>] [--status active|all|<status>] [--all-projects] [--json]"},{name:"show",summary:"Show a doc manifest and its entry file",usage:"show <doc> [--all] [--json]"},{name:"read",summary:"Print one text file raw",usage:"read <doc> <path>"},{name:"create",summary:"Create a design doc",usage:`create --title <title> [--summary <text>] [--template ${k.map(t=>t.id).join("|")}] [--status <status>] [--tags a,b] [--global]`},{name:"write",summary:"Write a whole file (creates it if missing)",usage:"write <doc> <path> (--file <local-path> | --content <text>) [--base-revision <n>] [--note <text>]"},{name:"edit",summary:"Exact-match replace inside a file",usage:"edit <doc> <path> --old <text> --new <text> [--replace-all] [--base-revision <n>] [--note <text>]"},{name:"rm",summary:"Delete a file (kept in history)",usage:"rm <doc> <path> [--base-revision <n>] [--note <text>]"},{name:"mv",summary:"Rename a file",usage:"mv <doc> <from> <to> [--base-revision <n>] [--note <text>]"},{name:"update",summary:"Change title, summary, status, tags or entry file",usage:"update <doc> [--title <t>] [--summary <s>] [--status <status>] [--tags a,b] [--entry <path>] [--alternative-to <doc>]"},{name:"comment",summary:"Add a review comment",usage:"comment <doc> <body> [--path <file>] [--quote <text>]"},{name:"reply",summary:"Reply to a comment",usage:"reply <doc> <comment-id> <body>"},{name:"resolve",summary:"Resolve a comment",usage:"resolve <doc> <comment-id> [--note <reply>]"},{name:"reopen",summary:"Reopen a resolved comment",usage:"reopen <doc> <comment-id> [--note <reply>]"},{name:"history",summary:"Show revision history",usage:"history <doc> [--path <file>] [--limit <n>]"},{name:"import",summary:"Bring local files (a site folder) into a doc, or into a new one with --title",usage:"import (<doc> | --title <title>) <file>... [--base <folder>] [--entry <path>] [--note <text>] [--global]"},{name:"export",summary:"Write the doc as a static site (--out), or print it as one bundle",usage:"export <doc> (--out <folder> | [--json])"},{name:"preview",summary:"Print the URL of an HTML page rendered like the published site",usage:"preview <doc> [<page.html>]"}],mr=new Set(["json","all","all-projects","global","replace-all","help"]);function fr(t){let n=[],e={};for(let i=0;i<t.length;i+=1){let r=t[i];if(r==="--"){n.push(...t.slice(i+1));break}if(r.startsWith("--")){let o=r.slice(2),s=o.indexOf("=");if(s!==-1)e[o.slice(0,s)]=o.slice(s+1);else if(mr.has(o))e[o]=!0;else{let a=t[i+1];if(a===void 0)throw new l("invalid",`--${o} needs a value`);e[o]=a,i+=1}}else r==="-h"?e.help=!0:n.push(r)}return{positional:n,flags:e}}function de(){let t=Math.max(...kt.map(n=>n.name.length));return["zcc design-docs \u2014 design documents your agents can read and edit","","Commands:",...kt.map(n=>`  ${n.name.padEnd(t)}  ${n.summary}`),"","Usage:",...kt.map(n=>`  zcc design-docs ${n.usage}`),"","<doc> is a design doc id (dd_\u2026) or slug.","Publish a site: zcc design-docs export <doc> --out docs, commit it, then serve that folder with GitHub Pages."].join(`
`)}var yr={kind:"user",label:"CLI",threadId:null},bn=9e5,vn=8;function b(t,n){let e=t[n];return typeof e=="string"?e:void 0}function R(t,n,e){let i=t[n];if(!i)throw new l("invalid",`missing <${e}>; see zcc design-docs help`);return i}async function wr(t,n,e){try{let i=await br(t,n,e);return{exitCode:0,stdout:i.endsWith(`
`)?i:`${i}
`}}catch(i){let r=i instanceof Error?i.message:String(i);return{exitCode:i instanceof l&&i.code==="invalid"?2:1,stderr:`${r}
`}}}async function br(t,n,e){let[i,...r]=n;if(!i||i==="help"||i==="--help"||i==="-h")return de();let{positional:o,flags:s}=fr(r);if(s.help)return de();let[a]=await Promise.all([t.caller(e),t.projects?.refresh()]),d=h=>t.projects?.name(h)??null,c={store:t.store,changed:t.changed,projectId:a.projectId,projectName:d,kit:t.kit,reports:t.reports},u=h=>j(c,R(o,h,"doc")),p=b(s,"base-revision"),y=b(s,"note"),E=s.json===!0;switch(i){case"list":{let h=s["all-projects"]===!0?"all":"project";if(E){let v=t.store.list({projectId:h==="project"&&a.projectId?a.projectId:void 0,query:b(s,"query"),status:b(s,"status")??"active"});return JSON.stringify(v,null,2)}return It(c,{query:b(s,"query"),status:b(s,"status"),scope:h})}case"show":{if(E)return JSON.stringify(t.store.get(u(0)),null,2);let h=Pt(c,{doc:R(o,0,"doc"),includeAll:s.all===!0});return typeof h=="string"?h:h.content.map(v=>"text"in v?v.text:"").join(`
`)}case"read":{let h=t.store.readFile(u(0),R(o,1,"path"));if(h.encoding!=="utf8")throw new l("invalid",`${h.path} is a binary file; open it in the Design Docs panel or read it with the design_doc_read tool`);return h.content}case"create":return $t(c,{title:b(s,"title")??o.join(" "),summary:b(s,"summary"),template:b(s,"template"),tags:b(s,"tags"),status:b(s,"status"),global:s.global===!0},a.actor);case"write":{let h=R(o,1,"path"),v=b(s,"file"),f=b(s,"content");if(v!==void 0&&f!==void 0)throw new l("invalid","pass either --file or --content, not both");if(v!==void 0){if(!a.files)throw new l("invalid","--file reads only inside a registered project; run it from the project folder or pass --content");let T=await t.readLocalFile({files:a.files,path:v,cwd:e.cwd});if(T.encoding!=="utf8")throw new l("invalid",`${v} is not a text file; bring images and fonts in with zcc design-docs import`);f=T.content}if(f===void 0)throw new l("invalid","write needs --file <path> or --content <text>");return Z(c,{doc:R(o,0,"doc"),path:h,content:f,baseRevision:p,note:y},a.actor)}case"edit":{let h=b(s,"old"),v=b(s,"new");if(h===void 0||v===void 0)throw new l("invalid","edit needs --old <text> and --new <text>");return Z(c,{doc:R(o,0,"doc"),path:R(o,1,"path"),edits:[{oldText:h,newText:v,replaceAll:s["replace-all"]===!0}],baseRevision:p,note:y},a.actor)}case"rm":return Z(c,{doc:R(o,0,"doc"),path:R(o,1,"path"),delete:!0,baseRevision:p,note:y},a.actor);case"mv":return Z(c,{doc:R(o,0,"doc"),path:R(o,1,"from"),renameTo:R(o,2,"to"),baseRevision:p,note:y},a.actor);case"update":return St(c,{doc:R(o,0,"doc"),title:b(s,"title"),summary:b(s,"summary"),status:b(s,"status"),tags:b(s,"tags"),entryPath:b(s,"entry"),alternativeTo:b(s,"alternative-to")},a.actor);case"comment":return st(c,{doc:R(o,0,"doc"),body:o.slice(1).join(" ")||b(s,"body"),path:b(s,"path"),quote:b(s,"quote")},a.actor);case"reply":return st(c,{doc:R(o,0,"doc"),replyTo:R(o,1,"comment-id"),body:o.slice(2).join(" ")||b(s,"body")},a.actor);case"resolve":case"reopen":return st(c,{doc:R(o,0,"doc"),[i]:R(o,1,"comment-id"),body:y},a.actor);case"history":return fn(c,{doc:R(o,0,"doc"),path:b(s,"path"),limit:b(s,"limit")});case"import":return vr(t,c,a,o,s,e);case"export":{if(s.out!==void 0)return Er(t,a,u(0),s,e);let h=t.store.get(u(0)),v=t.store.readAllFiles(h.id);if(E){let f=JSON.stringify({...h,files:v},null,2);if(f.length>bn)throw new l("limit",`${h.id} is too large for --json here; export it without --json for a bounded bundle`);return f}return gt(h,v,{maxChars:bn,projectName:d(h.projectId)})}case"preview":{if(!t.pageUrl)throw new l("invalid","previews are not available here");let h=t.store.summary(u(0)),v=t.store.readFile(h.id,o[1]??h.entryPath);if(v.kind!=="html")throw new l("invalid",`${v.path} is not an HTML page; pass one, e.g. zcc design-docs preview ${h.slug} index.html`);let f=t.pageUrl(h.id,v.path);return[f,"","Open it in any browser on this machine; reload to see later edits. Pages run sandboxed, as on a static host.",`From a thread, show it in the app's browser panel: zcc browser create --url '${f}' --reveal (plus --host/--instance/--generation/--thread from zcc browser instances).`].join(`
`)}default:throw new l("invalid",`unknown command "${i}"

${de()}`)}}function En(t,n){if(!t.files)throw new l("invalid",`${n} works only inside a registered project; run it from the project folder`);return t.files}function Nt(t,n,e){return Ct(e&&ut(e,t.root)?e:t.root,n)}function Tn(t){return t instanceof Error?t.message:String(t)}async function vr(t,n,e,i,r,o){let s=b(r,"title"),a=s===void 0?t.store.summary(j(n,R(i,0,"doc"))):null,d=a?i.slice(1):i;if(d.length===0)throw new l("invalid","import needs the files to bring in, e.g. zcc design-docs import <doc> $(git ls-files site) --base site");if(d.length>500)throw new l("limit",`a design doc holds at most ${500} files; import fewer`);let c=En(e,"import"),u=Nt(c,b(r,"base")??".",o.cwd);if(!ut(u,c.root))throw new l("invalid",`--base must be inside the project folder ${c.root}`);let p=new Map,y=[];for(let _ of d){let H=Nt(c,_,o.cwd);if(H===Ct(u)||!ut(H,u))throw new l("invalid",`${_} is not inside ${u}; pass --base <folder> that holds every file`);let U=hr(u,H).split(ce).join("/"),pt=wn(U);pt?y.push(`${U} (${pt})`):p.set(U,H)}if(p.size===0)throw new l("invalid",`nothing to import; skipped ${y.join(", ")}`);let E=0,h=await ae([...p],vn,async([_,H])=>{let U;try{U=await t.readLocalFile({files:c,path:H})}catch(pt){throw new Error(`cannot read ${_}: ${Tn(pt)}`)}if(E+=U.sizeBytes,E>25165824)throw new l("limit",`these files add up to more than a design doc holds (${$(25165824)})`);return{path:_,content:U.content,encoding:U.encoding}}),v=b(r,"note")??"Imported",f=b(r,"entry"),T=y.length>0?[`Skipped ${y.length}: ${y.join(", ")}`]:[];if(!a){let _=t.store.create({title:s,summary:b(r,"summary"),projectId:r.global===!0?null:e.projectId,files:h,entryPath:f??h.find(H=>H.path.toLowerCase()==="index.html")?.path},e.actor);return t.changed(_.id),[`Created design doc ${_.id} ("${_.title}") from ${h.length} files; it opens on ${_.entryPath}.`,...T,`Preview: zcc design-docs preview ${_.slug}`].join(`
`)}let Ft=t.store.writeFiles(a.id,h.map(_=>({..._,note:v})),e.actor);f!==void 0&&t.store.update(a.id,{entryPath:f},e.actor),t.changed(a.id);let pe=Ft.filter(_=>_.created).length,Ht=t.store.summary(a.id);return[`Imported ${Ft.length} files into ${Ht.slug} (${Ht.id}): ${pe} new, ${Ft.length-pe} updated or unchanged. It opens on ${Ht.entryPath}.`,...T].join(`
`)}async function Er(t,n,e,i,r){let o=b(i,"out");if(!o)throw new l("invalid","--out needs the folder to write the site into");if(!t.writeLocalFile)throw new l("invalid","export --out is not available here");let s=En(n,"export --out"),a=Nt(s,o,r.cwd);if(!ut(a,s.root))throw new l("invalid",`--out must be inside the project folder ${s.root}`);let d=t.store.summary(e),c=t.store.readAllFiles(d.id),u=Lt(c,t.kit??M),p=t.writeLocalFile;await ae(u,vn,async h=>{try{await p({files:s,path:pr(a,h.path),content:h.content,encoding:h.encoding})}catch(v){throw new Error(`cannot write ${h.path}: ${Tn(v)}`)}});let y=u.slice(c.length).map(h=>h.path),E=c.some(h=>h.kind==="html");return[`Exported ${d.slug} to ${a}: ${c.length} doc files${y.length>0?`, plus ${y.join(", ")}`:""}.`,"Files already there that the doc does not have were left in place.",...E?[`It opens on ${d.entryPath}${d.entryPath==="index.html"?"":"; a static host serves index.html first, so add one or link to it"}.`,"GitHub Pages: commit the folder, then in the repository settings under Pages, deploy from a branch and pick it (it must be the root or /docs)."]:[]].join(`
`)}function Rn(t,n){t.cli.register({name:gr,summary:"Read and edit design docs (specs, RFCs, ADRs) shared with your agents",commands:kt.map(e=>({...e})),run:(e,i)=>wr(n,e,i)})}function ut(t,n){let e=Ct(n),i=Ct(t);return i===e||i.startsWith(e.endsWith(ce)?e:e+ce)}function Tr(t,n){if(n)return t.filter(e=>e.path&&ut(n,e.path)).sort((e,i)=>i.path.length-e.path.length)[0]}function _n(t,n){return async e=>{let i=e.threadId?await t.threads.get({threadId:e.threadId}).catch(()=>null):null,r=await t.projects.list().catch(()=>[]);if(i){let a=(i.environmentId?await t.environments.get({environmentId:i.environmentId}).catch(()=>null):null)?.path??r.find(d=>d.id===i.projectId)?.path??null;return{actor:await n(i.id),projectId:i.projectId,files:a?{hostId:i.hostId,root:a}:null}}let o=Tr(r,e.cwd);return{actor:e.threadId?{kind:"agent",label:At,threadId:null}:yr,projectId:e.projectId??o?.id??null,files:o?.path?{root:o.path}:null}}}function Dn(t){return async({files:n,path:e,cwd:i})=>{let r=await t.files.read({...n.hostId?{hostId:n.hostId}:{},path:Nt(n,e,i),rootPath:n.root});return{content:r.content,encoding:r.contentEncoding,sizeBytes:r.sizeBytes}}}function An(t){return async({files:n,path:e,content:i,encoding:r})=>{await t.files.write({...n.hostId?{hostId:n.hostId}:{},path:e,rootPath:n.root,content:i,contentEncoding:r,createParents:!0})}}var Rr=4e3,xn=12,_r=10,In=24e3,Pn=["## Design docs","The user keeps design documents (specs, RFCs, ADRs, product docs) in the Design Docs plugin. Each doc is a small set of files \u2014 markdown, mermaid `.mmd` diagrams, self-contained `.html` mockups, code samples \u2014 rendered as formatted pages the user reviews.","- Use the `design_doc_*` tools (or `zcc design-docs \u2026` from a shell) to list, read, create and edit them. Read a doc before changing it; prefer `edits` over rewriting whole files and pass `baseRevision`.","- Treat open comments as review feedback: address them, then resolve each with a short `body` saying what changed. Answer a question in its thread with `replyTo` instead of opening a new comment.","- Create a design doc only when the user explicitly asks for one (a design doc, spec, RFC or ADR). Brainstorming, exploring an idea, planning a change or small fixes stay in chat; do not create a doc or offer one for them.","- Design docs are not the Library: save notes, findings, runbooks and postmortems with the `library_*` tools, and keep design docs for specs, RFCs, ADRs and designs the user reviews.",`- To show a doc in your reply, write its card on its own line: ${ht("<id>")}`].join(`
`);function Dr(t,n){let e=t.list({projectId:n||void 0,status:"active",limit:xn+1});if(e.length===0)return`${Pn}

There are no design docs for this project yet.`;let i=[Pn,"","Design docs for this project (newest first):"],r=i.join(`
`).length,o=0;for(let s of e.slice(0,xn)){let a=s.openComments?` \xB7 ${s.openComments} open comment${s.openComments===1?"":"s"}`:"",d=s.summary?` \u2014 ${K(s.summary,110)}`:"",c=`- ${s.id} "${K(s.title,80)}" (${dt[s.status]}${a})${d}`;if(r+c.length+80>Rr)break;i.push(c),r+=c.length+1,o+=1}return e.length>o&&i.push("- \u2026 more: call design_doc_list"),i.join(`
`)}function $n(t,n,e=()=>{},i){t.agents.contributeInstructions(r=>{try{return Dr(n,r.projectId||null)}catch(o){return e(`design docs instructions failed: ${o instanceof Error?o.message:String(o)}`),null}}),t.ui.registerMentionProvider({id:"design-doc",label:"Design docs",search(r){let o=typeof r=="string"?r:r.query,s=typeof r=="string"?void 0:r.projectId;return n.list({projectId:s||void 0,query:o,contents:!1,status:"active",limit:_r}).map(a=>({id:a.id,label:`${a.title} \xB7 ${dt[a.status]}`}))},async resolve(r){await i?.refresh();let o=n.get(r),s=o.files.some(d=>d.path===o.entryPath)?n.readFile(o.id,o.entryPath):null,a=s?s.content.length>In&&s.encoding==="utf8"?`${G({...s,content:s.content.slice(0,In)})}
(truncated \u2014 read the rest with design_doc_read)`:G(s):"";return{context:[`The user referenced design doc ${o.id}. Its current state:`,Q(o,{projectName:i?.name(o.projectId)??null}),a,`Read other files with design_doc_read doc="${o.id}" path="\u2026"; edit with design_doc_write.`].filter(Boolean).join(`

`)}}})}var Ar=100,xr=128*1024,Ir=50,Pr=1e3;function F(t){throw new l("invalid",t)}function Ot(t,n,e,i){return Array.isArray(t)||F(`${n} must be an array`),t.length>e&&F(`${n} has more than ${e} entries`),t.map(i)}function le(t,n){return typeof t=="string"&&t.length<=Pr?t:F(`${n} must be a doc path`)}function Sn(t){JSON.stringify(t).length>xr&&F("render report is too large");let n;try{n=L(le(t.path,"path"))}catch(i){F(i.message)}let e=t.revision;return(typeof e!="number"||!Number.isSafeInteger(e)||e<1)&&F("revision must be a saved revision"),{path:n,revision:e,deps:Ot(t.deps,"deps",500,(i,r)=>{let o=i&&typeof i=="object"?i:{},s=o.revision;return(typeof s!="number"||!Number.isSafeInteger(s)||s<0)&&F(`deps[${r}] needs a revision`),{path:le(o.path,`deps[${r}].path`),revision:s}}),missing:Ot(t.missing,"missing",500,(i,r)=>le(i,`missing[${r}]`)),problems:Ot(t.problems,"problems",Ie,(i,r)=>Pe(i)??F(`problems[${r}] is not a page problem`)),unanchored:Ot(t.unanchored,"unanchored",500,(i,r)=>typeof i=="string"&&i.length<=500?i:F(`unanchored[${r}] must be a quote`)).slice(0,Ir)}}var Mt=class{constructor(n=Ar,e=Date.now){this.max=n;this.now=e}max;now;reports=new Map;record(n,e){let i=`${n}\0${e.path}`;for(this.reports.delete(i),this.reports.set(i,{...e,docId:n,at:this.now()});this.reports.size>this.max;)this.reports.delete(this.reports.keys().next().value)}current(n,e){let i=[];for(let[r,o]of this.reports)o.docId===n&&(Le(o,e,!1)?this.reports.delete(r):i.push(o));return i.sort((r,o)=>r.path.localeCompare(o.path))}};var $r=[{id:"review",label:"Review",description:"Critical review with anchored comments",icon:"MessageSquareText",instruction:"Review this design doc critically, as a senior engineer would before approving it. Leave one review comment per issue with design_doc_comment (anchor it with path and an exact quote) covering gaps, risks, ambiguities, contradictions and missing alternatives. Do not rewrite the doc yourself. Finish with a short summary of the most important issues."},{id:"address",label:"Address comments",description:"Apply the open review feedback",icon:"CheckCheck",instruction:"Address every open review comment on this design doc: make the edits each one asks for (or explain why not), then resolve each comment with design_doc_comment resolve=<id> and a one-line body describing what changed."},{id:"complete",label:"Fill the gaps",description:"Complete empty or placeholder sections",icon:"WandSparkles",instruction:"Complete the sections of this design doc that are empty, placeholders (\u2026) or thin. Keep the author's intent and voice, ground statements in this project's code where relevant, and mark assumptions explicitly as **Assumption:**."},{id:"diagram",label:"Add diagrams",description:"Mermaid architecture, flow and sequence diagrams",icon:"Workflow",instruction:"Add mermaid diagrams that make this design easier to understand: architecture/components, the main data flow, and the key sequence(s). Put each larger diagram in diagrams/<name>.mmd and embed small ones inline as ```mermaid blocks where they help the narrative. Make sure every diagram parses."},{id:"ground",label:"Check against code",description:"Verify claims against this project's code",icon:"ScanSearch",instruction:"Check this design doc against the project's actual codebase. Correct inaccurate statements, name the real files, modules and APIs involved, and leave a comment wherever the design conflicts with how the code works today."},{id:"plan",label:"Implementation plan",description:"Milestones, tasks, risks and tests",icon:"ListChecks",instruction:"Turn this design into an implementation plan. Add a plan.md file with milestones, ordered tasks (each small enough for one pull request), dependencies, risks and a test strategy, grounded in this project's code. Link plan.md from the README."}];function Ln(t){return $r.find(n=>n.id===t)??null}var ue=4e3;function kn(t){let n=t.path?` Focus on ${t.path}.`:"",e=[t.action?.instruction,t.prompt?.trim()].filter(Boolean).join(`

`);return[`You are working on the design doc "${t.doc.title}" (id ${t.doc.id}) in the Design Docs plugin.${n}`,e,`Start with design_doc_read doc="${t.doc.id}" to see its files and open comments. Make changes in the doc itself with design_doc_write (prefer small edits with baseRevision) and design_doc_comment, rather than pasting long content into chat. The user is watching the doc update live. When you finish, summarise what you changed and end with ::design-doc{id="${t.doc.id}"} on its own line.`].filter(Boolean).join(`

`)}var Cn=/^(?:(?:https|ssh):\/\/(?:[\w.-]+@)?([\w.-]+)(?::\d+)?\/|[\w.-]+@([\w.-]+):)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;function Sr(t){return t.length>0&&t.length<=100&&/^[\w./-]+$/.test(t)&&!t.startsWith("-")&&!t.startsWith("/")&&!t.endsWith("/")&&!t.endsWith(".")&&!t.endsWith(".lock")&&!t.includes("..")&&!t.includes("//")}var W=class extends Error{};function Nn(t){let n=typeof t.repo=="string"?t.repo.trim():"";if(n.length>300)throw new W("repository URL must be at most 300 characters");if(n&&!Cn.test(n))throw new W("repository must be a clone URL such as https://github.com/owner/repo or git@github.com:owner/repo.git");let e=typeof t.branch=="string"?t.branch.trim():"";if(!Sr(e))throw new W("branch must be a valid git branch name, e.g. main or gh-pages");let i=t.folder??"root";if(i!=="root"&&i!=="docs")throw new W("folder must be root or docs");return{repo:n||null,branch:e,folder:i}}function Lr(t){let n=t.trim().match(Cn);if(!n)return null;let e=(n[1]??n[2]).toLowerCase(),[i,r]=[n[3],n[4]];return e==="github.com"?r.toLowerCase()===`${i.toLowerCase()}.github.io`?`https://${r}/`:`https://${i}.github.io/${r}/`:`https://${e}/pages/${i}/${r}/`}function On(t){let{doc:n,target:e}=t,i=e.folder==="docs",r=`branch ${e.branch}, ${i?"folder /docs":"its root"}`,o=e.repo?`the repository ${e.repo}, ${r}`:`this project's repository, ${r}`,s=e.repo?[`1. Export the site into a scratch folder inside this project: zcc design-docs export ${n.id} --out .zcc/tmp/publish-${n.slug}`,`2. Clone ${e.repo} into a new temporary directory outside the project and check out ${e.branch} (create the branch if the repository does not have it yet).`,`3. Copy the exported files into ${i?"docs/ of the clone":"the root of the clone"}, keeping .nojekyll and zcc-kit/. Then delete the scratch folder.`]:[`1. Make sure the working tree is on ${e.branch}. If it is on another branch or has uncommitted changes, stop and ask the user before switching.`,`2. Export the site: zcc design-docs export ${n.id} --out ${i?"docs":"."}`],a=s.length+1,d=e.repo?Lr(e.repo):null;return[`Publish the design doc "${n.title}" (id ${n.id}) as a static GitHub Pages site to ${o}. The user asked for this from the Publish button, so committing and pushing is approved.`,[...s,`${a}. Commit only the exported files with the message "Publish design doc: ${n.title.replace(/"/g,"'")}" and push to ${e.branch}. Never force-push or rewrite history; if the push is rejected, pull with rebase once and retry, otherwise stop and report.`,`${a+1}. Do not delete other files in the repository. If the folder holds pages this doc no longer has, list them in your summary instead of deleting them.`].join(`
`),`The site opens on ${n.entryPath}${n.entryPath==="index.html"?"":"; a static host serves index.html first, so say so if the doc has none"}.`,`When you finish, report the commit, the branch and the Pages URL${d?` (expected ${d})`:""}. If Pages may not be on yet, tell the user to enable it in the repository settings under Pages: deploy from branch ${e.branch}, folder ${i?"/docs":"/ (root)"}. End with ::design-doc{id="${n.id}"} on its own line.`].join(`

`)}var P={kind:"user",label:"You",threadId:null};function at(t,n){let e=t[n];if(e!=null){if(typeof e!="number"||!Number.isInteger(e))throw new l("invalid",`${n} must be an integer`);return e}}function Mn(t,n){let e=t[n];if(e!==void 0){if(!Array.isArray(e)||e.some(i=>typeof i!="string"))throw new l("invalid",`${n} must be an array of strings`);return e}}function kr(t,n="Design doc from chat"){let e=t.split(`
`).map(o=>o.trim()).filter(Boolean),r=(e.find(o=>/^#{1,3}\s+\S/.test(o))??e[0]??"").replace(/^#+\s*|^[-*>]\s+/,"").replace(/[*_`[\]]/g,"").trim();return r?r.length>80?`${r.slice(0,79).trimEnd()}\u2026`:r:n}function Cr(t){let{store:n,changed:e}=t,i=async r=>{if(!r)return;if(!(await t.sdk.projects.list()).some(s=>s.id===r))throw new l("invalid",`unknown project ${r}`)};return{templates:()=>k.map(({id:r,label:o,description:s,files:a})=>({id:r,label:o,description:s,files:a.map(d=>d.path)})),projects:async()=>(await t.sdk.projects.list()).map(({id:r,name:o})=>({id:r,name:o})),list:r=>{let o=w(r),s=m(o,"status")??"all";if(s!=="all"&&s!=="active"&&!x(s))throw new l("invalid","unknown status filter");let a=o.projectId;return n.list({projectId:typeof a=="string"&&a?a:void 0,query:m(o,"query"),status:s,limit:at(o,"limit")??200})},get:r=>n.get(g(w(r),"doc")),create:async r=>{let o=w(r),s=m(o,"projectId"),a=m(o,"status");if(a!==void 0&&!x(a))throw new l("invalid","unknown status");await i(s);let d=n.create({title:g(o,"title"),summary:m(o,"summary"),template:m(o,"template"),tags:Mn(o,"tags"),status:a,projectId:s||null},P);return e(d.id),d},update:async r=>{let o=w(r),s=m(o,"status");if(s!==void 0&&!x(s))throw new l("invalid","unknown status");let a=o.projectId;if(a!=null&&typeof a!="string")throw new l("invalid","projectId must be a string or null");await i(a);let d=o.alternativeTo;if(d!=null&&typeof d!="string")throw new l("invalid","alternativeTo must be a string or null");let c=n.update(g(o,"doc"),{title:m(o,"title"),summary:m(o,"summary"),status:s,tags:Mn(o,"tags"),entryPath:m(o,"entryPath"),projectId:a===void 0?void 0:a||null,alternativeTo:d===void 0?void 0:d||null},P);return e(c.id),c},pin:r=>{let o=w(r);if(typeof o.pinned!="boolean")throw new l("invalid","pinned must be a boolean");let s=n.setPinned(g(o,"doc"),o.pinned);return e(s.id),s},remove:r=>{let o=n.summary(g(w(r),"doc"));return n.remove(o.id),e(o.id),{ok:!0}},renderPage:r=>{let o=w(r),s=o.draft;if(s!==void 0&&typeof s!="string")throw new l("invalid","draft must be a string");return ot(n,t.kit??M,{doc:g(o,"doc"),path:m(o,"path"),draft:s})},readPageFile:r=>{let o=w(r),s=n.summary(g(o,"doc")),a=g(o,"path"),d;try{d=L(a)}catch{return null}let c=xt(n,s.id,t.kit??M)(d);return c?{kind:c.kind,encoding:c.encoding,content:c.content}:null},siteFiles:r=>{let o=n.summary(g(w(r),"doc"));return{slug:o.slug,files:Lt(n.readAllFiles(o.id),t.kit??M)}},pageLink:r=>{let o=w(r),s=n.summary(g(o,"doc"));if(!t.pageUrl)throw new l("invalid","standalone pages are not served here");let a;try{a=L(m(o,"path")??s.entryPath)}catch(d){throw new l("invalid",d.message)}return{url:t.pageUrl(s.id,a)}},reportRender:r=>{let o=w(r),s=n.summary(g(o,"doc"));return t.reports?.record(s.id,Sn(o)),{ok:!0}},readFile:r=>{let o=w(r);return n.readFile(g(o,"doc"),g(o,"path"))},writeFile:r=>{let o=w(r),s=o.content;if(typeof s!="string")throw new l("invalid","content must be a string");let a=n.writeFile(g(o,"doc"),{path:g(o,"path"),content:s,encoding:o.encoding==="base64"?"base64":void 0,baseRevision:at(o,"baseRevision"),note:m(o,"note")},P);return e(a.docId),a},editFile:r=>{let o=w(r);if(!Array.isArray(o.edits))throw new l("invalid","edits must be an array");let s=n.editFile(g(o,"doc"),{path:g(o,"path"),edits:o.edits,baseRevision:at(o,"baseRevision"),note:m(o,"note")},P);return e(s.docId),s},deleteFile:r=>{let o=w(r),s=n.summary(g(o,"doc"));return n.deleteFile(s.id,g(o,"path"),P,{baseRevision:at(o,"baseRevision")}),e(s.id),{ok:!0}},renameFile:r=>{let o=w(r),s=n.renameFile(g(o,"doc"),g(o,"from"),g(o,"to"),P);return e(s.docId),s},history:r=>{let o=w(r);return n.history(g(o,"doc"),{path:m(o,"path"),limit:at(o,"limit")})},revision:r=>{let o=w(r);return n.revisionContent(g(o,"doc"),o.id)},restore:r=>{let o=w(r),s=n.restoreRevision(g(o,"doc"),o.id,P,{baseRevision:at(o,"baseRevision")});return e(s.docId),s},addComment:r=>{let o=w(r),s=n.addComment(g(o,"doc"),{body:g(o,"body"),path:m(o,"path"),quote:m(o,"quote")},P);return e(s.docId),s},replyToComment:r=>{let o=w(r),s=n.addReply(g(o,"doc"),o.id,g(o,"body"),P);return e(s.docId),s},setCommentStatus:r=>{let o=w(r),s=g(o,"status"),a=n.setCommentStatus(g(o,"doc"),o.id,s,P);return e(a.docId),a},deleteComment:r=>{let o=w(r),s=n.summary(g(o,"doc"));return n.deleteComment(s.id,o.id,P),e(s.id),{ok:!0}},unlinkThread:r=>{let o=w(r),s=n.summary(g(o,"doc"));return n.unlinkThread(s.id,g(o,"threadId")),e(s.id),{ok:!0}},createFromMessage:async r=>{let o=w(r),s=g(o,"threadId"),a=g(o,"text"),d=await t.sdk.threads.get({threadId:s});if(!d)throw new Error(`Thread ${s} was not found.`);let c=n.create({title:m(o,"title")?.trim()||kr(a),projectId:d.projectId??null,files:[{path:"README.md",content:a}]},P);return n.linkThread(c.id,s,d.title?.trim()||"Agent thread","assistant"),e(c.id),n.summary(c.id)},askAgent:async r=>{let o=w(r),s=n.summary(g(o,"doc")),a=m(o,"action"),d=a?Ln(a):null;if(a&&!d)throw new l("invalid",`unknown agent action ${a}`);let c=m(o,"prompt")?.trim()??"";if(!d&&!c)throw new l("invalid","pick an action or write a request");if(c.length>ue)throw new l("invalid",`request must be at most ${ue} characters`);let u=s.projectId??(m(o,"projectId")||null);if(!u)throw new l("invalid","this doc is global; choose a project for the agent to run in");s.projectId||await i(u);let p=`${d?d.label:"Design doc"} \xB7 ${s.title}`.slice(0,120),y=m(o,"providerId"),E=await t.sdk.threads.spawn({projectId:u,prompt:kn({doc:s,action:d,prompt:c,path:m(o,"path")}),title:p,...y?{providerId:y}:{},visibility:"hidden",pluginMetadata:{designDocId:s.id,...d?{action:d.id}:{},panelAgent:jn(s.id)}});return n.linkThread(s.id,E.id,p,d?.id==="review"?"reviewer":"assistant"),e(s.id),{threadId:E.id,projectId:u}},publish:async r=>{let o=w(r),s=n.summary(g(o,"doc")),a;try{a=Nn(o)}catch(p){throw p instanceof W?new l("invalid",p.message):p}if(!n.get(s.id).files.some(p=>p.kind==="html"))throw new l("invalid","this doc has no HTML pages to publish; add an index.html first");let d=s.projectId??(m(o,"projectId")||null);if(!d)throw new l("invalid","this doc is global; choose a project for the agent to run in");s.projectId||await i(d);let c=`Publish \xB7 ${s.title}`.slice(0,120),u=await t.sdk.threads.spawn({projectId:d,prompt:On({doc:s,target:a}),title:c,visibility:"hidden",pluginMetadata:{designDocId:s.id,action:"publish",panelAgent:jn(s.id)}});return n.linkThread(s.id,u.id,c,"assistant"),e(s.id),{threadId:u.id,projectId:d}}}}var Nr="design-docs";function jn(t){return{panel:Nr,view:t}}function Fn(t,n){for(let[e,i]of Object.entries(Cr(n)))t.rpc.method(e,i)}function Hn(t,n={}){let e=n.ttlMs??3e4,i=n.now??Date.now,r=new Map,o=Number.NEGATIVE_INFINITY,s=null;return{name:a=>a?r.get(a)??null:null,refresh(){return s||(i()-o<e?Promise.resolve():(s=t().then(a=>{r=new Map(a.filter(d=>d.name).map(d=>[d.id,d.name]))},()=>{}).finally(()=>{o=i(),s=null}),s))}}}var jt={type:"string",description:"Design doc id (dd_\u2026) or slug, as shown by design_doc_list or the instructions catalog."},Un=k.map(t=>t.id);function Bn(t,n=200){let e=new Map;return async i=>{let r=e.get(i);if(r)return{kind:"agent",label:r,threadId:i};let o;try{o=await t(i)}catch{return{kind:"agent",label:Dt,threadId:i}}if(!o)return{kind:"agent",label:At,threadId:null};let s=(o.title||o.titleFallback||"").trim();return s?(e.size>=n&&e.delete(e.keys().next().value),e.set(i,s),{kind:"agent",label:s,threadId:i}):{kind:"agent",label:Dt,threadId:i}}}function qn(t,n){let e=async i=>(await n.projects?.refresh(),{store:n.store,changed:n.changed,projectId:i.projectId||null,projectName:r=>n.projects?.name(r)??null,kit:n.kit,reports:n.reports});t.agents.registerTool({name:"design_doc_list",description:"List design documents (specs, RFCs, ADRs, product docs) that the user keeps in the Design Docs plugin. Defaults to active docs of the current project plus global docs. Use query to search titles, summaries, tags and file contents.",parameters:{type:"object",properties:{query:{type:"string",description:"Free-text search."},status:{type:"string",enum:["active","all",...B],description:"active (default) hides archived docs."},scope:{type:"string",enum:["project","all"],description:"project (default) or every project."},limit:{type:"integer",minimum:1,maximum:200}},additionalProperties:!1},presentation:{label:{pending:"Listing design docs",completed:"Listed design docs"},icon:{glyph:"Search"}},execute:async(i,r)=>It(await e(r),i)}),t.agents.registerTool({name:"design_doc_read",description:"Read a design doc. A design doc is a small project of files (markdown, mermaid .mmd diagrams, HTML mockups, code, images). Without path: returns the manifest (files with revisions, open review comments) and the entry file. With path: returns that file and its revision. includeAll=true returns every text file at once. For an HTML page it also says which files the page uses that the doc lacks, what previews block, and, from the last time the panel ran it, script errors and comments whose quote the page no longer shows. Always read before editing, and treat open comments as review feedback to address.",parameters:{type:"object",properties:{doc:jt,path:{type:"string",description:"File path inside the doc, e.g. README.md or diagrams/flow.mmd."},includeAll:{type:"boolean",description:"Return all text files (bounded) instead of just the entry file."}},required:["doc"],additionalProperties:!1},presentation:{label:{pending:"Reading design doc",completed:"Read design doc"},icon:{glyph:"FileText"}},execute:async(i,r)=>Pt(await e(r),i)}),t.agents.registerTool({name:"design_doc_create",description:`Create a new design doc the user can review in the Design Docs panel. Pass files to write your own content, or a template to start from (${Un.join(", ")}). The doc belongs to the current project unless global=true. Write rich GitHub-flavoured markdown: headings, tables, task lists, \`\`\`mermaid diagrams and $math$ all render. Put larger diagrams in .mmd files and UI mockups in self-contained .html files (inline CSS and JS; nothing loads from a CDN). For a web page or site that will publish to GitHub Pages, start from the report or html-design template, or link zcc-kit/site.css and zcc-kit/site.js (see the design-docs skill).`,parameters:{type:"object",properties:{title:{type:"string",description:'Human title, e.g. "Offline sync for mobile".'},summary:{type:"string",description:"One or two sentences shown in lists."},template:{type:"string",enum:Un,description:"Starter files when files is omitted."},tags:{type:"array",items:{type:"string"}},status:{type:"string",enum:[...B]},global:{type:"boolean",description:"Make the doc visible to every project."},files:{type:"array",description:"Initial files. Include a README.md (a written doc) or an index.html (a site) as the entry point.",items:{type:"object",properties:{path:{type:"string"},content:{type:"string"},encoding:{type:"string",enum:["utf8","base64"],description:"base64 only for images and fonts."}},required:["path","content"],additionalProperties:!1}},entryPath:{type:"string",description:"File shown first when the doc opens; defaults to README.md, else index.html."}},required:["title"],additionalProperties:!1},presentation:{label:{pending:"Creating design doc",completed:"Created design doc"},icon:{glyph:"File"}},execute:async(i,r)=>$t(await e(r),i,await n.actorFor(r.threadId))}),t.agents.registerTool({name:"design_doc_write",description:"Change one file in a design doc. Pass exactly one of: edits (exact-match find/replace, preferred for changes), content (whole file; creates the file if it does not exist), delete=true, or renameTo. Pass baseRevision (the revision you last read) so you never overwrite a concurrent edit by the user; on a conflict, re-read the file and reapply. Every write is kept in history and appears live in the panel. Writing an HTML page returns a page check: missing files and blocked resources to fix.",parameters:{type:"object",properties:{doc:jt,path:{type:"string",description:"File path inside the doc. New folders are created implicitly."},edits:{type:"array",description:"Applied in order. oldText must match exactly once unless replaceAll is set.",items:{type:"object",properties:{oldText:{type:"string"},newText:{type:"string"},replaceAll:{type:"boolean"}},required:["oldText","newText"],additionalProperties:!1}},content:{type:"string",description:"Full new file content."},encoding:{type:"string",enum:["utf8","base64"],description:"base64 only for images and fonts."},delete:{type:"boolean"},renameTo:{type:"string"},baseRevision:{type:"integer",minimum:0,description:"Revision you read; 0 asserts the file is new."},note:{type:"string",description:"Short change note shown in history."}},required:["doc","path"],additionalProperties:!1},presentation:{label:{pending:"Editing design doc",completed:"Edited design doc"},icon:{glyph:"EditFile"}},execute:async(i,r)=>Z(await e(r),i,await n.actorFor(r.threadId))}),t.agents.registerTool({name:"design_doc_update",description:"Update design doc metadata: title, summary, status (draft \u2192 review \u2192 approved \u2192 implemented, or archived), tags, the entry file, or alternativeTo (the doc this one is a competing proposal to, so it nests under it in the doc list).",parameters:{type:"object",properties:{doc:jt,title:{type:"string"},summary:{type:"string"},status:{type:"string",enum:[...B]},tags:{type:"array",items:{type:"string"},description:"Replaces the tag list."},entryPath:{type:"string",description:"File shown first when the doc opens."},alternativeTo:{type:"string",description:"Id or slug of the doc this one is an alternative to. Empty string detaches it. One level deep: point at the original doc, not another alternative."}},required:["doc"],additionalProperties:!1},presentation:{label:{pending:"Updating design doc",completed:"Updated design doc"},icon:{glyph:"EditFile"}},execute:async(i,r)=>St(await e(r),i,await n.actorFor(r.threadId))}),t.agents.registerTool({name:"design_doc_comment",description:"Leave a review comment on a design doc (optionally anchored to a file and an exact quoted passage), reply in an existing comment's thread (replyTo), or resolve / reopen one by id. Pass at most one of replyTo, resolve or reopen. Once your edits address a comment, resolve it with body saying what changed.",parameters:{type:"object",properties:{doc:jt,body:{type:"string",description:"Comment text (markdown). Required for a new comment or replyTo; with resolve or reopen, posted as a reply."},path:{type:"string",description:"File a new comment is about."},quote:{type:"string",description:"Exact passage of that file a new comment refers to; the panel highlights it. For an HTML page, quote the text as the page shows it, not its markup."},replyTo:{type:"string",description:"Comment id to reply to (keeps its status)."},resolve:{type:"string",description:"Comment id to mark resolved."},reopen:{type:"string",description:"Comment id to reopen."}},required:["doc"],additionalProperties:!1},presentation:{label:{pending:"Commenting on design doc",completed:"Commented on design doc"},icon:{glyph:"ListTodo"}},execute:async(i,r)=>st(await e(r),i,await n.actorFor(r.threadId))})}var Wn=Or(Mr(import.meta.url));function jr(t){let n=new _t(t.storage.database()),e=rn(Xn(Wn,"kit")),i=cn(t.pluginId),r=u=>t.realtime.publish(he,{docId:u}),o=Bn(u=>t.sdk.threads.get({threadId:u})),s=Hn(()=>t.sdk.projects.list()),a=new Mt;qn(t,{store:n,changed:r,actorFor:o,projects:s,kit:e,reports:a}),$n(t,n,u=>t.log.warn(u),s);let d=(u,p)=>ln(un(),i,u,p);Rn(t,{store:n,changed:r,projects:s,caller:_n(t.sdk,o),readLocalFile:Dn(t.sdk),writeLocalFile:An(t.sdk),pageUrl:d,kit:e,reports:a}),Fn(t,{store:n,changed:r,sdk:t.sdk,kit:e,pageUrl:d,reports:a});let c=dn({store:n,kit:e,endpoint:i,runtime:pn(Xn(Wn,"page-runtime.js"),u=>t.log.warn(u))});t.http.route("GET","/page",c.page),t.http.route("GET","/file",c.file),t.events.on("thread.idle",u=>{for(let p of n.touchThread(u.threadId,u.thread?.title??null))r(p)}),t.events.on("thread.deleted",async u=>{let p=await t.sdk.threads.get({threadId:u.threadId}).catch(()=>null);if(!(p&&!p.deletedAt))for(let y of n.forgetThread(u.threadId))r(y)}),t.log.info("design docs ready")}export{jr as default};
