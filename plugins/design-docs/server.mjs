import { createRequire as __createRequire } from "node:module";
import { dirname as __pathDirname } from "node:path";
import { fileURLToPath as __fileURLToPath } from "node:url";
const require = __createRequire(import.meta.url);
var __filename = __fileURLToPath(import.meta.url);
var __dirname = __pathDirname(__filename);
import{dirname as Ir,join as Fn}from"node:path";import{fileURLToPath as Pr}from"node:url";var ue="changed",H=["draft","review","approved","implemented","archived"],at={draft:"Draft",review:"In review",approved:"Approved",implemented:"Implemented",archived:"Archived"};function x(t){return typeof t=="string"&&H.includes(t)}function pt(t,n){let e=i=>i.replace(/["\\\n\r]/g,"");return n?`::design-doc{id="${e(t)}" path="${e(n)}"}`:`::design-doc{id="${e(t)}"}`}import{join as ar,relative as dr,resolve as Lt,sep as ae}from"node:path";function N(t){return t.kind==="agent"?`agent "${t.label}"`:"the user"}function S(t){return t>=1024*1024?`${Math.round(t/(1024*1024)*10)/10} MiB`:t>=1024?`${Math.round(t/1024)} KiB`:`${t} B`}function U(t,n=Date.now()){let e=Math.max(0,Math.round((n-t)/1e3));if(e<45)return"just now";let i=Math.round(e/60);if(i<60)return`${i}m ago`;let s=Math.round(i/60);if(s<24)return`${s}h ago`;let r=Math.round(s/24);return r<30?`${r}d ago`:new Date(t).toISOString().slice(0,10)}var pe=`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{title}}</title>
<link rel="stylesheet" href="zcc-kit/site.css">
<script src="zcc-kit/site.js"></script>
</head>`,ge=`${pe}
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
`,he=`week,Option A,Option B
W1,0.52,0.47
W2,0.55,0.49
W3,0.58,0.50
W4,0.61,0.54
W5,0.63,0.55
W6,0.66,0.58
W7,0.65,0.60
W8,0.69,0.61
`,me=`${pe}
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
`;var Un=`# {{title}}

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
`,Bn=`flowchart LR
  user([User]) --> ui[Client]
  ui --> api[Service API]
  api --> db[(Database)]
  api --> queue[[Queue]]
  queue --> worker[Worker]
`,qn=`# {{title}}

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
`,Xn=`<!doctype html>
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
`,Wn=`# {{title}}

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
`,Gn=`# {{title}}

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
`,Kn=`openapi: 3.1.0
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
`,k=[{id:"technical",label:"Technical design",description:"RFC-style design: context, goals, proposal, alternatives, rollout.",files:[{path:"README.md",content:Un},{path:"diagrams/architecture.mmd",content:Bn}]},{id:"product",label:"Product spec",description:"Problem, users, metrics, scope, requirements and an HTML mockup.",files:[{path:"README.md",content:qn},{path:"mockups/overview.html",content:Xn}]},{id:"adr",label:"Decision record",description:"A single architectural decision with options and consequences.",files:[{path:"README.md",content:Wn}]},{id:"api",label:"API design",description:"Resources, auth, errors and an OpenAPI contract.",files:[{path:"README.md",content:Gn},{path:"api/openapi.yaml",content:Kn}]},{id:"report",label:"Interactive report",description:"A one-page site: KPIs, charts from CSV, a sortable table. Publishes to GitHub Pages.",entryPath:"index.html",files:[{path:"index.html",content:ge},{path:"data/weekly.csv",content:he}]},{id:"html-design",label:"HTML design doc",description:"A technical design as a web page with section nav. Publishes to GitHub Pages.",entryPath:"index.html",files:[{path:"index.html",content:me}]},{id:"blank",label:"Blank",description:"A single README.md to start from scratch.",files:[{path:"README.md",content:`# {{title}}

{{summary}}
`}]}],fe="technical";function ye(t){return k.find(n=>n.id===t)??null}function we(t,n){let e=n.summary.trim()||"One-paragraph summary of the proposal.";return t.files.map(i=>{let s=/\.html?$/i.test(i.path),r=o=>s?zn(o):o;return{path:i.path,content:i.content.replaceAll("{{title}}",r(n.title)).replaceAll("{{summary}}",r(e))}})}function zn(t){return t.replace(/[&<>"']/g,n=>`&#${n.charCodeAt(0)};`)}var Yn=12e4;function Jn(t,n=Date.now()){let e=[at[t.status],`${t.fileCount} file${t.fileCount===1?"":"s"}`,t.openComments?`${t.openComments} open comment${t.openComments===1?"":"s"}`:null,`updated ${U(t.updatedAt,n)}`].filter(Boolean),i=t.summary?` \u2014 ${G(t.summary,140)}`:"";return`- ${t.id} "${t.title}" (${e.join(" \xB7 ")})${i}`}function be(t,n=Date.now()){return t.length===0?"No design docs match.":t.map(e=>Jn(e,n)).join(`
`)}function Zn(t,n,e){let i=t.path===n?" [entry]":"";return`- ${t.path}${i} \u2014 ${t.kind}, ${S(t.size)}, rev ${t.revision}, ${N(t.updatedBy)} ${U(t.updatedAt,e)}`}function dt(t,n=Date.now()){let e=t.path?` on ${t.path}`:"",i=t.quote?` \u203A "${G(t.quote,120)}"`:"",s=t.status==="resolved"?" [resolved]":"";return[`- [${t.id}]${e}${i}${s} ${N(t.author)}, ${U(t.createdAt,n)}: ${t.body}`,...t.replies.map(r=>`  \u21B3 reply ${N(r.author)}, ${U(r.createdAt,n)}: ${r.body.replace(/\n/g,`
    `)}`)].join(`
`)}function Z(t,n={}){let e=n.now??Date.now(),i=t.projectId?n.projectName??t.projectId:"global (all projects)",s=[`# ${t.title}`,`id: ${t.id} \xB7 slug: ${t.slug} \xB7 status: ${t.status} \xB7 doc revision ${t.revision}`,`project: ${i} \xB7 created by ${N(t.createdBy)} \xB7 updated ${U(t.updatedAt,e)} by ${N(t.updatedBy)}`];t.summary&&s.push(`summary: ${t.summary}`),t.tags.length&&s.push(`tags: ${t.tags.join(", ")}`),s.push("",`## Files (${t.files.length})`,...t.files.map(o=>Zn(o,t.entryPath,e)));let r=t.comments.filter(o=>o.status==="open");return r.length&&s.push("",`## Open comments (${r.length})`,...r.map(o=>dt(o,e))),s.join(`
`)}function W(t){return t.encoding==="base64"?`<file path="${t.path}" revision="${t.revision}" kind="${t.kind}" encoding="base64" size="${S(t.size)}">(binary ${t.kind}, not shown as text)</file>`:`<file path="${t.path}" revision="${t.revision}" kind="${t.kind}">
${t.content}
</file>`}function gt(t,n,e={}){let i=e.maxChars??Yn,s=[...n.filter(d=>d.path===t.entryPath),...n.filter(d=>d.path!==t.entryPath)],r=[Z(t,e)],o=r[0].length,a=[];for(let d of s){let c=W(d);if(o+c.length>i){a.push(d.path);continue}r.push(c),o+=c.length}return a.length&&r.push(`(${a.length} file(s) omitted to stay within size limits \u2014 read them by path: ${a.join(", ")})`),r.join(`

`)}var Vn={error:"Error",missing:"Missing",blocked:"Blocked"};function Qn(t){let n=t.source?` (${t.source}${t.line?`:${t.line}`:""})`:"";return`- ${Vn[t.kind]}: ${G(t.message,300)}${n}`}function Ft(t){return!t.missing.length&&!t.warnings.length?null:[`Page check for ${t.path}:`,...t.missing.map(n=>`- Missing: the page uses ${n}, which is not a file in this doc.`),...t.warnings.map(n=>`- Blocked: ${n}`)].join(`
`)}function Ht(t,n){let e=new Set(t.unanchored),i=n.filter(s=>s.status==="open"&&s.path===t.path&&s.quote&&e.has(s.quote));return[...t.problems.map(Qn),...i.map(s=>`- Comment ${s.id} quotes "${G(s.quote,120)}", which the page does not show.`)]}function Ut(t,n,e=Date.now()){let i=`The Design Docs panel ran ${t.path} (rev ${t.revision}) ${U(t.at,e)}`,s=Ht(t,n);return s.length?[`${i}:`,...s].join(`
`):`${i} without problems.`}function Ee(t,n=Date.now()){return t.length===0?"No history.":t.map(e=>{let i=e.renamedFrom?` (from ${e.renamedFrom})`:"",s=e.note?` \u2014 ${e.note}`:"";return`- #${e.id} ${e.op} ${e.path}${i} \u2192 rev ${e.revision}, ${S(e.size)}, ${N(e.actor)} ${U(e.createdAt,n)}${s}`}).join(`
`)}function ht(t,n){return`To show it to the user, put this on its own line in your reply: ${pt(t.id,n)}`}function G(t,n){let e=t.replace(/\s+/g," ").trim();return e.length<=n?e:`${e.slice(0,n-1)}\u2026`}var ti=new Set(["script","style","textarea","title","xmp","iframe","noembed","noframes","noscript"]),ei=/[A-Za-z][^\t\n\f\r />]*/y,ni=/[\t\n\f\r /]*/y,ve=/[\t\n\f\r ]*/y,ii=/[^\t\n\f\r />][^\t\n\f\r />=]*/y,ri=/[^\t\n\f\r >]*/y,si={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:"\xA0",mdash:"\u2014",ndash:"\u2013",hellip:"\u2026",middot:"\xB7",bull:"\u2022",lsquo:"\u2018",rsquo:"\u2019",ldquo:"\u201C",rdquo:"\u201D",laquo:"\xAB",raquo:"\xBB",copy:"\xA9",reg:"\xAE",trade:"\u2122",deg:"\xB0",times:"\xD7",plusmn:"\xB1",larr:"\u2190",rarr:"\u2192",uarr:"\u2191",darr:"\u2193"};function Bt(t){return t.includes("&")?t.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));?/g,(n,e,i,s)=>{if(s)return si[s.toLowerCase()]??n;let r=e?Number(e):parseInt(i,16);return r>0&&r<=1114111?String.fromCodePoint(r):n}):t}function qt(t){return t.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;")}function V(t,n,e){return t.lastIndex=e,t.exec(n)?.[0]??""}function oi(t,n){let e=V(ei,t,n+1),i=n+1+e.length,s=[];for(;i<t.length;){let r=V(ni,t,i);if(i+=r.length,i>=t.length)return null;if(t[i]===">")return{name:e.toLowerCase(),attributes:s,selfClosing:r.endsWith("/"),start:n,end:i+1};let o=V(ii,t,i)||t[i];i+=o.length,i+=V(ve,t,i).length;let a=null;if(t[i]==="="){i+=1,i+=V(ve,t,i).length;let d=t[i];if(d==='"'||d==="'"){let c=t.indexOf(d,i+1);if(c<0)return null;a=t.slice(i+1,c),i=c+1}else a=V(ri,t,i),i+=a.length}s.push({name:o.toLowerCase(),value:a===null?null:Bt(a)})}return null}var ai=new Set(["","module","text/javascript","application/javascript","text/ecmascript","application/ecmascript"]);function Xt(t){return ai.has((t??"").trim().toLowerCase())}var di=new Set(["textarea","xmp"]);function Wt(t){let n="",e=!1,i=0,s=r=>{let o=t.slice(i,r).replace(/<!--[\s\S]*?(?:-->|$)/g,"").replace(/<[/!?][^>]*>?/g,"");n+=Bt(o)};for(let r of mt(t))r.start<i||(s(r.start),i=r.end,r.name==="script"&&Xt(A(r,"type"))&&(e=!0),r.name==="template"?i=ci(t,i):r.content&&(di.has(r.name)&&(n+=Bt(t.slice(r.content.start,r.content.end))),i=r.content.closeEnd));return s(t.length),{text:n,scripted:e}}function ci(t,n){let e=/<(\/?)template\b[^>]*>/gi;e.lastIndex=n;let i=1;for(let s=e.exec(t);s;s=e.exec(t))if(i+=s[1]?-1:1,i===0)return e.lastIndex;return t.length}function*mt(t){let n=0;for(;n<t.length;){let e=t.indexOf("<",n);if(e<0)return;let i=t[e+1]??"";if(t.startsWith("<!--",e)){let r=t.indexOf("-->",e+4);n=r<0?t.length:r+3;continue}if(i==="!"||i==="?"||i==="/"&&/[A-Za-z]/.test(t[e+2]??"")){let r=t.indexOf(">",e+2);n=r<0?t.length:r+1;continue}if(!/[A-Za-z]/.test(i)){n=e+1;continue}let s=oi(t,e);if(!s)return;if(n=s.end,ti.has(s.name)){let r=new RegExp(`</${s.name}(?=[\\t\\n\\f\\r />])`,"ig");r.lastIndex=s.end;let o=r.exec(t),a=o?o.index:t.length,d=o?t.indexOf(">",a):-1,c=d<0?t.length:d+1;yield{...s,content:{start:s.end,end:a,closeEnd:c}},n=c;continue}yield s}}function A(t,n){let e=t.attributes.find(i=>i.name===n);return e?e.value:void 0}function K(t,n,e=!1){let i=n.map(s=>s.value===null?` ${s.name}`:` ${s.name}="${qt(s.value)}"`);return`<${t}${i.join("")}${e?" />":">"}`}function ft(t,n){let e=-1;for(let s of mt(t)){if(s.name==="head")return t.slice(0,s.end)+n+t.slice(s.end);if(s.name==="html"){e=s.end;continue}break}if(e>=0)return t.slice(0,e)+n+t.slice(e);let i=t.match(/^\s*<!doctype[^>]*>/i);return i?i[0]+n+t.slice(i[0].length):n+t}var li=/^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/,$=class extends Error{constructor(n){super(n),this.name="DesignDocPathError"}};function L(t){if(typeof t!="string")throw new $("path must be a string");let n=t.trim().replace(/\\/g,"/");for(;n.startsWith("./");)n=n.slice(2);if(!n)throw new $("path is required");if(n.startsWith("/"))throw new $("path must be relative to the design doc");if(n.length>160)throw new $("path must be at most 160 characters");let e=n.split("/");if(e.length>10)throw new $("path must be at most 10 levels deep");for(let i of e){if(i===".."||i===".")throw new $('path must not contain "." or ".." segments');if(!li.test(i)||i.endsWith(" ")||i.endsWith("."))throw new $(`invalid path segment ${JSON.stringify(i)}: use letters, digits, ".", "_", "-" or spaces, starting with a letter or digit`)}return e.join("/")}function Gt(t){let n=t.split("/").pop()??t,e=n.lastIndexOf(".");return e<=0?"":n.slice(e+1).toLowerCase()}var ui={md:"markdown",markdown:"markdown",mdx:"markdown",html:"html",htm:"html",mmd:"mermaid",mermaid:"mermaid",svg:"svg",png:"image",jpg:"image",jpeg:"image",gif:"image",webp:"image",ico:"image",woff:"font",woff2:"font",ttf:"font",otf:"font",txt:"text"},Te={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",ico:"image/x-icon"},pi={woff:"font/woff",woff2:"font/woff2",ttf:"font/ttf",otf:"font/otf"},gi={json:"json",yaml:"yaml",yml:"yaml",toml:"toml",ts:"typescript",tsx:"tsx",js:"javascript",jsx:"jsx",mjs:"javascript",py:"python",go:"go",rs:"rust",java:"java",kt:"kotlin",swift:"swift",rb:"ruby",sql:"sql",sh:"bash",css:"css",graphql:"graphql",gql:"graphql",proto:"protobuf",xml:"xml",cls:"apex",apex:"apex"};function D(t){let n=Gt(t),e=ui[n];return e||(gi[n]?"code":"text")}function Q(t){return t==="image"||t==="font"}function tt(t){return Te[Gt(t)]??null}var hi={html:"text/html",htm:"text/html",css:"text/css",js:"text/javascript",mjs:"text/javascript",json:"application/json",svg:"image/svg+xml",xml:"application/xml",csv:"text/csv",md:"text/markdown",txt:"text/plain"};function yt(t){let n=Gt(t),e=Te[n]??pi[n];return e||`${hi[n]??"text/plain"};charset=utf-8`}var mi=/^[a-z][a-z0-9+.-]*:/i;function O(t,n){let e=n.trim();if(!e||e.startsWith("#")||e.startsWith("//")||mi.test(e))return null;let i=e.split(/[?#]/,1)[0],s=i;try{s=decodeURIComponent(i)}catch{}let r=s.startsWith("/")?[]:t.split("/").slice(0,-1);for(let o of s.split("/"))if(!(!o||o===".")){if(o===".."){if(!r.length)return null;r.pop();continue}r.push(o)}return r.length?r.join("/"):null}function et(t,n){let e=t.split("/"),i=n.split("/"),s=Math.min(e.length,i.length);for(let r=0;r<s;r+=1){let o=r===e.length-1,a=r===i.length-1;if(e[r]!==i[r])return o!==a?o?-1:1:e[r].localeCompare(i[r],void 0,{sensitivity:"base",numeric:!0})}return e.length-i.length}import{Buffer as Qe}from"node:buffer";import{readFileSync as tn,realpathSync as Ze,statSync as Ki}from"node:fs";import{join as zi,sep as Yi}from"node:path";var _e="dd-page",De="dd-files";var Ae=50,qr=256*1024,fi=1e3;var yi=500;var wi=new Set(["error","missing","blocked"]);function bi(t){return t&&typeof t=="object"&&!Array.isArray(t)?t:null}function Re(t,n){return typeof t=="string"?t.slice(0,n):null}function Ei(t){return typeof t=="number"&&Number.isFinite(t)?t:null}function xe(t){let n=bi(t),e=n?.kind,i=Re(n?.message,yi);if(!n||!wi.has(e)||!i)return null;let s=Re(n.source,fi),r=Ei(n.line);return{kind:e,message:i,...s?{source:s}:{},...r!==null&&r>0?{line:Math.floor(r)}:{}}}var bt="https://doc.invalid",B="zcc-kit",Ie=["site.css","site.js"],Pe=12*1024*1024,Kr=960*1024;function Se(t,n,e){let i=new Map(n.map(s=>[s.path,s.revision]));return!e&&t.revision!==(i.get(t.path)??null)||t.deps.some(s=>(i.get(s.path)??0)!==s.revision)?!0:t.missing.some(s=>i.has(s))}function Kt(t){return JSON.stringify(t).replace(/</g,"\\u003c")}function Et(t){return`${bt}/${t.split("/").map(encodeURIComponent).join("/")}`}function $e(t){let n=t.lastIndexOf("/");return n<0?`${bt}/`:`${Et(t.slice(0,n))}/`}import{Buffer as vi}from"node:buffer";var zt=/^(?:[a-z][a-z0-9+.-]*:)?\/\//i,Ti=/\.(?:mp4|m4v|webm|ogg|ogv|mov|mp3|m4a|wav|flac|aac)$/i,Ri=8,_i=40,Di={img:["src","srcset"],source:["src","srcset"],input:["src"],video:["poster"],image:["href","xlink:href"],feimage:["href","xlink:href"]},Ai=/\/\*[\s\S]*?\*\/|@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"([^"]*)"|'([^']*)')([^;]*);?|url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"(?:[^"\\\n]|\\[\s\S])*"|'(?:[^'\\\n]|\\[\s\S])*'/gi,xi=/(?:^|[;\n}])\s*import\s*(?:[\w$*{}\s,]+?\s*from\s*)?["'](\.{1,2}\/|\/)[^"']*["']/;function Jt(t){return t.replace(/<(\/script|!--)/gi,"\\x3C$1")}function Le(t){return t.replace(/<\/style/gi,"<\\/style")}function Ii(t){if(t.kind==="svg"&&t.encoding==="utf8")return`data:image/svg+xml;base64,${vi.from(t.content,"utf8").toString("base64")}`;if(t.encoding!=="base64")return null;if(t.kind==="image"){let n=tt(t.path);return n?`data:${n};base64,${t.content}`:null}return t.kind==="font"?`data:${yt(t.path)};base64,${t.content}`:null}function Pi(t,n){let e=n.trim();if(!e)return t;let i=[],s=e.match(/^layer(?:\(\s*([^)]*?)\s*\))?(?=\s|$)/i);if(s&&(i.push(s[1]?`@layer ${s[1]}`:"@layer"),e=e.slice(s[0].length).trim()),/^supports\(/i.test(e)){let r=0,o=8;for(;o<e.length;o+=1)if(e[o]==="(")r+=1;else if(e[o]===")"&&(r-=1)===0)break;i.push(`@supports ${e.slice(8,o+1)}`),e=e.slice(o+1).trim()}return e&&i.push(`@media ${e}`),`${i.map(r=>`${r} {
`).join("")}${t}
${i.map(()=>"}").join(`
`)}`}function Si(t){let n=[],e=0;for(;e<t.length;){for(;e<t.length&&/[\s,]/.test(t[e]);)e+=1;if(e>=t.length)break;let i=e;for(;i<t.length&&!/\s/.test(t[i]);)i+=1;let s=t.slice(e,i),r="";if(s.endsWith(","))s=s.replace(/,+$/,""),e=i;else{let o=i,a=0;for(;o<t.length&&(t[o]!==","||a>0);)t[o]==="("?a+=1:t[o]===")"&&(a-=1),o+=1;r=t.slice(i,o).trim(),e=o+1}n.push({url:s,descriptor:r})}return n}var Yt=class{constructor(n){this.input=n}input;files=new Map;assets=new Map;missing=new Set;warnings=new Set;assetBytes=0;overBudget=!1;read(n){if(this.files.has(n))return this.files.get(n);let e=null;try{e=this.input.read(n)}catch{e=null}return this.files.set(n,e),!e&&n!==this.input.entryPath&&this.missing.add(n),e}warn(n){this.warnings.size<_i&&this.warnings.add(n)}asset(n){if(this.assets.has(n))return this.assets.get(n);let e=this.read(n),i=e?Ii(e):null;if(i){let s=this.input.assetBudget??Pe;this.assetBytes+i.length>s?(this.overBudget||(this.warn(`Some images and fonts load on demand: the page inlines at most ${Math.round(s/(1024*1024))} MB of them.`),this.overBudget=!0),i=null):this.assetBytes+=i.length}return this.assets.set(n,i),i}resolveUrl(n,e){let i=O(n,e);if(!i)return null;let s=this.asset(i);if(s)return s;let r=e.indexOf("#");return Et(i)+(r>=0?e.slice(r):"")}css(n,e,i=[],s=[]){let r=n.replace(Ai,(o,...a)=>{if(o.startsWith("/*")||o.startsWith('"')||o.startsWith("'"))return o;if(o[0]==="@"){let u=a[0]??a[1]??a[2]??a[3]??a[4]??"",p=O(e,u);if(!p)return zt.test(u)&&this.warn(`External stylesheet ${u} does not load in previews; add the file to the doc.`),s.push(o.endsWith(";")?o:`${o};`),"";if(i.includes(p)||i.length>=Ri)return this.warn(`${e} imports ${p} in a cycle or too deeply; the import was skipped.`),"";let y=this.read(p);if(!y||y.encoding!=="utf8")return"";let v=this.css(y.content.replace(/@charset\s+["'][^"']*["']\s*;/gi,""),p,[...i,e],s);return Pi(v,a[5]??"")}let d=(a[6]??a[7]??a[8]??"").trim(),c=this.resolveUrl(e,d);return c?`url("${c}")`:o});return i.length||!s.length?r:`${s.join(`
`)}
${r}`}srcset(n){return Si(n).map(({url:e,descriptor:i})=>`${this.resolveUrl(this.input.entryPath,e)??e}${i?` ${i}`:""}`).join(", ")}stylesheet(n,e){let i=O(this.input.entryPath,e);if(!i)return zt.test(e)&&this.warn(`External stylesheet ${e} does not load in previews; add the file to the doc.`),null;let s=this.read(i);if(!s||s.encoding!=="utf8")return"";let r=n.attributes.filter(a=>["media","title","id","disabled"].includes(a.name)),o=this.css(s.content,i);return`${K("style",[{name:"data-dd-href",value:i},...r])}${Le(o)}</style>`}script(n,e){let i=(A(n,"type")??"").trim().toLowerCase();if(!Xt(i))return null;if(A(n,"nomodule")!==void 0)return"";let s=i==="module",r=[{name:"type",value:"text/x-dd-script"}];s&&r.push({name:"data-dd-type",value:"module"});let o=A(n,"src");o!==void 0&&A(n,"async")!==void 0?r.push({name:"data-dd-async",value:null}):o!==void 0&&!s&&A(n,"defer")!==void 0&&r.push({name:"data-dd-defer",value:null});let a=n.attributes.filter(u=>u.name.startsWith("data-")&&!u.name.startsWith("data-dd-")),d=e,c=this.input.entryPath;if(o!==void 0){let u=o?O(this.input.entryPath,o):null;if(!u)return o&&zt.test(o)&&this.warn(`External script ${o} is blocked in previews; add the file to the doc.`),null;r.push({name:"data-dd-src",value:u});let p=this.read(u);if(!p||p.encoding!=="utf8")return`${K("script",[...r,{name:"data-dd-missing",value:null},...a])}</script>`;d=Jt(p.content),c=u}return s&&xi.test(d)&&this.warn(`${c} imports other modules; previews run each script on its own, so bundle modules into one file.`),`${K("script",[...r,...a])}${d}</script>`}refresh(n){let e=(A(n,"content")??"").match(/^\s*(\d+(?:\.\d+)?)?\s*[;,]?\s*(?:url\s*=\s*)?(['"]?)(.*?)\2\s*$/i),i=e?.[3]?O(this.input.entryPath,e[3]):null;if(!i)return null;let s=e[3].indexOf("#"),r=Et(i)+(s>=0?e[3].slice(s):"");return K("meta",[{name:"name",value:"dd-refresh"},{name:"content",value:`${e[1]??"0"};${r}`}])}attributes(n){let e=Di[n.name]??[],i=!1,s=n.attributes.map(o=>{if(o.value===null)return o;let a=null;return o.name==="style"&&/url\(/i.test(o.value)?a=this.css(o.value,this.input.entryPath):e.includes(o.name)&&(a=o.name==="srcset"?this.srcset(o.value):this.resolveUrl(this.input.entryPath,o.value)),a===null||a===o.value?o:(i=!0,{name:o.name,value:a})}),r=A(n,"src");return(n.name==="video"||n.name==="audio"||n.name==="source")&&r&&Ti.test(r.split(/[?#]/,1)[0])&&this.warn("Audio and video do not play in previews."),i?K(n.name,s,n.selfClosing):null}run(){let{html:n,entryPath:e}=this.input,i="",s=0,r=!1,o=(d,c,u)=>{u!==null&&(i+=n.slice(s,d)+u,s=c)};for(let d of mt(n))if(d.name==="base")o(d.start,d.end,"");else if(d.name==="link"){let c=(A(d,"rel")??"").toLowerCase().split(/\s+/).filter(Boolean),u=A(d,"href");if(c.includes("stylesheet")&&!c.includes("alternate")&&(r=!0),!u)continue;if(c.includes("stylesheet")&&!c.includes("alternate"))o(d.start,d.end,this.stylesheet(d,u));else if(c.some(p=>p==="icon"||p==="apple-touch-icon"||p==="mask-icon")){let p=O(e,u),y=p?this.asset(p):null;if(y){let v=d.attributes.map(g=>g.name==="href"?{name:"href",value:y}:g);o(d.start,d.end,K("link",v))}}else c.some(p=>["preload","modulepreload","prefetch","prerender"].includes(p))&&O(e,u)&&o(d.start,d.end,"")}else if(d.name==="style"&&d.content){r=!0;let c=this.css(n.slice(d.content.start,d.content.end),e);o(d.start,d.content.closeEnd,`${n.slice(d.start,d.end)}${Le(c)}</style>`)}else d.name==="script"&&d.content?o(d.start,d.content.closeEnd,this.script(d,n.slice(d.content.start,d.content.end))):d.name==="iframe"?O(e,A(d,"src")??"")&&this.warn("Pages embedded with <iframe> do not render in previews; link to them instead."):d.name==="meta"&&(A(d,"http-equiv")??"").toLowerCase()==="refresh"?o(d.start,d.end,this.refresh(d)):d.content||o(d.start,d.end,this.attributes(d));i+=n.slice(s),i=ft(i,`<base href="${qt($e(e))}">`);let a=[...this.files].filter(d=>d[1]!==null).map(([d,c])=>({path:d,revision:c.revision})).sort((d,c)=>d.path.localeCompare(c.path));return{html:i,deps:a,missing:[...this.missing].sort(),warnings:[...this.warnings],styled:r}}};function ke(t){return new Yt(t).run()}import{randomBytes as Ui}from"node:crypto";var Ce=[`CREATE TABLE docs (
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
  CREATE INDEX doc_comments_by_parent ON doc_comments (doc_id, parent_id);`];var _t="Agent",Dt="CLI agent",l=class extends Error{constructor(e,i){super(i);this.code=e;this.name="DesignDocError"}code},Qt={assistant:1,reviewer:2,editor:3,author:4},Be=`d.*,
  (SELECT COUNT(*) FROM doc_files f WHERE f.doc_id = d.id) AS file_count,
  (SELECT COUNT(*) FROM doc_comments c WHERE c.doc_id = d.id AND c.status = 'open' AND c.parent_id IS NULL) AS open_comments`,Rt=class{constructor(n,e={}){this.db=n;this.now=e.now??Date.now,this.randomId=e.randomId??(i=>`${i}${Ui(6).toString("hex")}`),this.maxHistoryBytes=e.maxHistoryBytes??50331648,n.migrate(Ce)}db;now;randomId;maxHistoryBytes;list(n={}){let e=[],i=[];n.projectId!==void 0&&(n.projectId===null?e.push("d.project_id IS NULL"):(e.push("(d.project_id = ? OR d.project_id IS NULL)"),i.push(n.projectId)));let s=n.status??"all";if(s==="active")e.push("d.status <> 'archived'");else if(s!=="all"){if(!x(s))throw new l("invalid",`unknown status ${JSON.stringify(s)}`);e.push("d.status = ?"),i.push(s)}let r=typeof n.query=="string"?n.query.trim():"";if(r){let c=`%${ze(r)}%`,u=n.contents===!1?"":` OR EXISTS (SELECT 1 FROM doc_files f WHERE f.doc_id = d.id AND f.encoding = 'utf8'
          AND f.content LIKE ? ESCAPE '\\')`;e.push(`(d.title LIKE ? ESCAPE '\\' OR d.summary LIKE ? ESCAPE '\\'
        OR d.slug LIKE ? ESCAPE '\\' OR d.tags LIKE ? ESCAPE '\\'${u})`),i.push(c,c,c,c),u&&i.push(c)}let o=Ke(n.limit,50,200),a=`SELECT ${Be} FROM docs d
      ${e.length?`WHERE ${e.join(" AND ")}`:""}
      ORDER BY d.updated_at DESC, d.id LIMIT ?`;return this.db.prepare(a).all(...i,o).map(nt)}find(n){let e=this.findRow(n);return e?nt(e):null}summary(n){return nt(this.requireRow(n))}get(n){let e=this.requireRow(n),i=this.db.prepare("SELECT doc_id, path, encoding, size, revision, updated_at, updated_by FROM doc_files WHERE doc_id = ?").all(e.id).map(it).sort((o,a)=>et(o.path,a.path)),s=Je(this.db.prepare("SELECT * FROM doc_comments WHERE doc_id = ? ORDER BY created_at, rowid").all(e.id)),r=this.db.prepare("SELECT thread_id, title, role, last_activity_at FROM doc_threads WHERE doc_id = ? ORDER BY last_activity_at DESC").all(e.id).map(Gi);return{...nt(e),files:i,comments:s,threads:r}}create(n,e){let i=Xe(n.title),s=We(n.summary??""),r=Ge(n.tags??[]),o=n.status??"draft";if(!x(o))throw new l("invalid",`unknown status ${JSON.stringify(o)}`);let a,d;if(n.files&&n.files.length>0)a=n.files;else{let f=ye(n.template??fe);if(!f)throw new l("invalid",`unknown template ${JSON.stringify(n.template)}`);a=we(f,{title:i,summary:s}),d=f.entryPath}if(a.length>500)throw new l("limit",`a design doc holds at most ${500} files`);let c=a.map(f=>qe(f.path,f.content,f.encoding)),u=new Set;for(let f of c){let T=f.path.toLowerCase();if(u.has(T))throw new l("invalid",`duplicate file path ${f.path}`);u.add(T)}if(c.reduce((f,T)=>f+T.size,0)>25165824)throw new l("limit",`a design doc holds at most ${S(25165824)}`);let y=n.entryPath?C(n.entryPath):d??c.find(f=>f.path.toLowerCase()==="readme.md")?.path??c.find(f=>f.path.toLowerCase()==="index.html")?.path??c.find(f=>D(f.path)==="markdown")?.path??c[0].path;if(!c.some(f=>f.path===y))throw new l("invalid",`entryPath ${y} is not one of the doc's files`);let v=this.randomId("dd_"),g=this.now(),b=JSON.stringify(e);return this.db.transaction(()=>{let f=this.uniqueSlug(Bi(i));this.db.prepare(`INSERT INTO docs (id, slug, title, summary, status, project_id, tags, entry_path, revision,
            created_at, updated_at, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`).run(v,f,i,s,o,n.projectId??null,JSON.stringify(r),y,g,g,b,b);for(let T of c)this.insertFile(v,T,1,g,b),this.recordRevision(v,T.path,1,"create",T,b,g,{note:"Created"});e.threadId&&this.linkThreadRow(v,e.threadId,e.label,"author",g)}),this.get(v)}update(n,e,i){let s=this.requireRow(n),r=[],o=[];if(e.title!==void 0&&(r.push("title = ?"),o.push(Xe(e.title))),e.summary!==void 0&&(r.push("summary = ?"),o.push(We(e.summary))),e.status!==void 0){if(!x(e.status))throw new l("invalid",`unknown status ${JSON.stringify(e.status)}`);r.push("status = ?"),o.push(e.status)}if(e.tags!==void 0&&(r.push("tags = ?"),o.push(JSON.stringify(Ge(e.tags)))),e.entryPath!==void 0){let a=C(e.entryPath);if(!this.fileRow(s.id,a))throw new l("invalid",`entryPath ${a} is not one of the doc's files`);r.push("entry_path = ?"),o.push(a)}return e.projectId!==void 0&&(r.push("project_id = ?"),o.push(e.projectId)),r.length===0?nt(this.requireRow(s.id)):(this.db.transaction(()=>{this.db.prepare(`UPDATE docs SET ${r.join(", ")} WHERE id = ?`).run(...o,s.id),this.touch(s.id,i)}),nt(this.requireRow(s.id)))}remove(n){let e=this.requireRow(n);this.db.transaction(()=>{for(let i of["doc_files","doc_revisions","doc_comments","doc_threads"])this.db.prepare(`DELETE FROM ${i} WHERE doc_id = ?`).run(e.id);this.db.prepare("DELETE FROM docs WHERE id = ?").run(e.id)})}readFile(n,e){let i=this.requireRow(n),s=C(e),r=this.fileRow(i.id,s);if(!r)throw this.missingFile(i.id,s);return{...it(r),content:r.content,encoding:r.encoding==="base64"?"base64":"utf8"}}readAllFiles(n){let e=this.requireRow(n);return this.db.prepare("SELECT * FROM doc_files WHERE doc_id = ?").all(e.id).map(i=>({...it(i),content:i.content,encoding:i.encoding==="base64"?"base64":"utf8"})).sort((i,s)=>et(i.path,s.path))}writeFile(n,e,i){let s=this.requireRow(n),r=qe(e.path,e.content,e.encoding),o=Zt(e.note);return this.db.transaction(()=>{let a=this.fileRow(s.id,r.path);vt(r.path,a,e.baseRevision),a||this.assertCanAdd(s.id,r.path),this.assertDocBudget(s.id,r.size-(a?.size??0));let d=this.now(),c=JSON.stringify(i),u;if(a){if(a.content===r.content&&a.encoding===r.encoding)return{...it(a),docId:s.id,created:!1};u=a.revision+1,this.db.prepare(`UPDATE doc_files SET content = ?, encoding = ?, size = ?, revision = ?, updated_at = ?, updated_by = ?
              WHERE doc_id = ? AND path = ?`).run(r.content,r.encoding,r.size,u,d,c,s.id,r.path)}else u=this.nextRevisionFor(s.id,r.path),this.insertFile(s.id,r,u,d,c);return this.recordRevision(s.id,r.path,u,a?"write":"create",r,c,d,{note:o}),this.touch(s.id,i,d),i.threadId&&this.linkThreadRow(s.id,i.threadId,i.label,"editor",d),{...it(this.fileRow(s.id,r.path)),docId:s.id,created:!a}})}writeFiles(n,e,i){let s=this.requireRow(n);return this.db.transaction(()=>e.map(r=>this.writeFile(s.id,r,i)))}editFile(n,e,i){let s=this.requireRow(n),r=C(e.path);if(!Array.isArray(e.edits)||e.edits.length===0)throw new l("invalid","edits must be a non-empty array");if(e.edits.length>50)throw new l("limit",`at most ${50} edits per call`);return this.db.transaction(()=>{let o=this.fileRow(s.id,r);if(!o)throw this.missingFile(s.id,r);if(o.encoding==="base64")throw new l("invalid",`${r} is a binary file; write it whole instead of editing`);vt(r,o,e.baseRevision);let a=qi(o.content,e.edits,r);return this.writeFile(s.id,{path:r,content:a,baseRevision:o.revision,note:e.note},i)})}deleteFile(n,e,i,s={}){let r=this.requireRow(n),o=C(e);this.db.transaction(()=>{let a=this.fileRow(r.id,o);if(!a)throw this.missingFile(r.id,o);if(vt(o,a,s.baseRevision),this.fileCount(r.id)<=1)throw new l("invalid","a design doc must keep at least one file");let c=this.now(),u=JSON.stringify(i);if(this.db.prepare("DELETE FROM doc_files WHERE doc_id = ? AND path = ?").run(r.id,o),this.recordRevision(r.id,o,a.revision+1,"delete",a,u,c,{note:Zt(s.note)}),r.entry_path===o){let p=this.firstFilePath(r.id);this.db.prepare("UPDATE docs SET entry_path = ? WHERE id = ?").run(p,r.id)}this.touch(r.id,i,c),i.threadId&&this.linkThreadRow(r.id,i.threadId,i.label,"editor",c)})}renameFile(n,e,i,s,r={}){let o=this.requireRow(n),a=C(e),d=C(i);if(a===d)throw new l("invalid","renameTo must differ from path");return this.db.transaction(()=>{let c=this.fileRow(o.id,a);if(!c)throw this.missingFile(o.id,a);if(vt(a,c,r.baseRevision),Q(D(a))!==Q(D(d)))throw new l("invalid",`cannot rename ${a} to ${d}: the file type would change encoding`);let u=this.caseInsensitiveClash(o.id,d,a);if(u)throw new l("conflict",`${u} already exists in this design doc`);let p=this.now(),y=JSON.stringify(s),v=Zt(r.note),g=c.revision+1;this.db.prepare("DELETE FROM doc_files WHERE doc_id = ? AND path = ?").run(o.id,a),this.recordRevision(o.id,a,g,"delete",c,y,p,{note:v??`Renamed to ${d}`});let b=this.nextRevisionFor(o.id,d),f={path:d,content:c.content,encoding:c.encoding,size:c.size};return this.insertFile(o.id,f,b,p,y),this.recordRevision(o.id,d,b,"rename",f,y,p,{note:v,renamedFrom:a}),this.db.prepare("UPDATE doc_comments SET path = ? WHERE doc_id = ? AND path = ?").run(d,o.id,a),o.entry_path===a&&this.db.prepare("UPDATE docs SET entry_path = ? WHERE id = ?").run(d,o.id),this.touch(o.id,s,p),s.threadId&&this.linkThreadRow(o.id,s.threadId,s.label,"editor",p),{...it(this.fileRow(o.id,d)),docId:o.id,created:!0}})}history(n,e={}){let i=this.requireRow(n),s=Ke(e.limit,50,100),r="id, doc_id, path, revision, op, size, note, renamed_from, actor, created_at";return(e.path?this.db.prepare(`SELECT ${r} FROM doc_revisions WHERE doc_id = ? AND path = ? ORDER BY id DESC LIMIT ?`).all(i.id,C(e.path),s):this.db.prepare(`SELECT ${r} FROM doc_revisions WHERE doc_id = ? ORDER BY id DESC LIMIT ?`).all(i.id,s)).map(Ye)}revisionContent(n,e){let i=this.requireRow(n),s=this.revisionRow(i.id,e);return{...Ye(s),content:s.content,encoding:s.encoding==="base64"?"base64":"utf8"}}restoreRevision(n,e,i,s={}){let r=this.requireRow(n),o=this.revisionRow(r.id,e);return this.writeFile(r.id,{path:o.path,content:o.content,encoding:o.encoding==="base64"?"base64":"utf8",baseRevision:s.baseRevision,note:`Restored revision ${o.revision}`},i)}addComment(n,e,i){let s=this.requireRow(n),r=Vt(e.body),o=e.path?C(e.path):null;if(o&&!this.fileRow(s.id,o))throw this.missingFile(s.id,o);let a=typeof e.quote=="string"&&e.quote.trim()?e.quote.trim().slice(0,500):null,d=this.randomId("c_"),c=this.now();return this.db.transaction(()=>{this.insertComment(s.id,{id:d,parentId:null,path:o,quote:a,body:r},i,c),this.touchReview(s.id),i.threadId&&this.linkThreadRow(s.id,i.threadId,i.label,"reviewer",c)}),this.commentById(s.id,d)}addReply(n,e,i,s){let r=this.requireRow(n),o=Vt(i),a=this.now(),d="";return this.db.transaction(()=>{d=this.rootComment(r,e).id,this.insertComment(r.id,{id:this.randomId("c_"),parentId:d,path:null,quote:null,body:o},s,a),this.touchReview(r.id),s.threadId&&this.linkThreadRow(r.id,s.threadId,s.label,"reviewer",a)}),this.commentById(r.id,d)}setCommentStatus(n,e,i,s,r){let o=this.requireRow(n);if(i!=="open"&&i!=="resolved")throw new l("invalid",`unknown comment status ${JSON.stringify(i)}`);let a=typeof r=="string"&&r.trim()?Vt(r):null,d=this.now(),c="";return this.db.transaction(()=>{c=this.rootComment(o,e).id,this.db.prepare("UPDATE doc_comments SET status = ?, resolved_at = ? WHERE doc_id = ? AND id = ?").run(i,i==="resolved"?d:null,o.id,c),a&&this.insertComment(o.id,{id:this.randomId("c_"),parentId:c,path:null,quote:null,body:a},s,d),this.touchReview(o.id),s.threadId&&this.linkThreadRow(o.id,s.threadId,s.label,"reviewer",d)}),this.commentById(o.id,c)}deleteComment(n,e,i){let s=this.requireRow(n),r=String(e??"");this.db.transaction(()=>{if(this.db.prepare("DELETE FROM doc_comments WHERE doc_id = ? AND id = ?").run(s.id,r).changes===0)throw new l("not_found",`comment ${r} not found in ${s.slug}`);this.db.prepare("DELETE FROM doc_comments WHERE doc_id = ? AND parent_id = ?").run(s.id,r),this.touchReview(s.id)})}linkThread(n,e,i,s){let r=this.requireRow(n);this.db.transaction(()=>this.linkThreadRow(r.id,e,i,s,this.now()))}unlinkThread(n,e){let i=this.requireRow(n);this.db.prepare("DELETE FROM doc_threads WHERE doc_id = ? AND thread_id = ?").run(i.id,e)}touchThread(n,e){let i=this.docsForThread(n);if(i.length===0)return i;let s=this.now(),r=e?.trim().slice(0,140)??"";return this.db.prepare("UPDATE doc_threads SET last_activity_at = ?, title = CASE WHEN ? <> '' THEN ? ELSE title END WHERE thread_id = ?").run(s,r,r,n),i}forgetThread(n){let e=this.docsForThread(n);return e.length&&this.db.prepare("DELETE FROM doc_threads WHERE thread_id = ?").run(n),e}docsForThread(n){return this.db.prepare("SELECT doc_id FROM doc_threads WHERE thread_id = ?").all(n).map(e=>e.doc_id)}findRow(n){if(typeof n!="string"||!n.trim())return null;let e=n.trim();return this.db.prepare(`SELECT ${Be} FROM docs d WHERE d.id = ? OR d.slug = ? LIMIT 1`).get(e,e.toLowerCase())??null}requireRow(n){let e=this.findRow(n);if(!e)throw new l("not_found",`design doc ${JSON.stringify(n)} not found; list docs to get a valid id or slug`);return e}fileRow(n,e){return this.db.prepare("SELECT * FROM doc_files WHERE doc_id = ? AND path = ?").get(n,e)??null}fileCount(n){return this.db.prepare("SELECT COUNT(*) AS n FROM doc_files WHERE doc_id = ?").get(n).n}firstFilePath(n){let e=this.db.prepare("SELECT path FROM doc_files WHERE doc_id = ?").all(n).map(i=>i.path).sort(et);return e.find(i=>i.toLowerCase()==="readme.md")??e.find(i=>D(i)==="markdown")??e[0]}missingFile(n,e){let i=this.db.prepare("SELECT path FROM doc_files WHERE doc_id = ? ORDER BY path LIMIT 40").all(n).map(s=>s.path);return new l("not_found",`${e} not found; files: ${i.join(", ")||"(none)"}`)}caseInsensitiveClash(n,e,i){return this.db.prepare("SELECT path FROM doc_files WHERE doc_id = ? AND lower(path) = lower(?) AND path <> ? LIMIT 1").get(n,e,i??"")?.path??null}assertCanAdd(n,e){let i=this.caseInsensitiveClash(n,e);if(i)throw new l("conflict",`${i} already exists with different letter case`);if(this.fileCount(n)>=500)throw new l("limit",`a design doc holds at most ${500} files`)}assertDocBudget(n,e){if(e<=0)return;if(this.db.prepare("SELECT COALESCE(SUM(size), 0) AS n FROM doc_files WHERE doc_id = ?").get(n).n+e>25165824)throw new l("limit",`a design doc holds at most ${S(25165824)} of files`)}nextRevisionFor(n,e){return(this.db.prepare("SELECT MAX(revision) AS n FROM doc_revisions WHERE doc_id = ? AND path = ?").get(n,e).n??0)+1}insertFile(n,e,i,s,r){this.db.prepare(`INSERT INTO doc_files (doc_id, path, content, encoding, size, revision, updated_at, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(n,e.path,e.content,e.encoding,e.size,i,s,r)}recordRevision(n,e,i,s,r,o,a,d={}){this.db.prepare(`INSERT INTO doc_revisions (doc_id, path, revision, op, content, encoding, size, note, renamed_from, actor, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(n,e,i,s,r.content,r.encoding,r.size,d.note??null,d.renamedFrom??null,o,a);let c=r.encoding==="base64"?3:r.size>262144?5:25;this.db.prepare(`DELETE FROM doc_revisions WHERE doc_id = ? AND path = ? AND id NOT IN (
          SELECT id FROM doc_revisions WHERE doc_id = ? AND path = ? ORDER BY id DESC LIMIT ?)`).run(n,e,n,e,c),this.pruneHistoryBytes(n)}pruneHistoryBytes(n){let e=this.db.prepare("SELECT COALESCE(SUM(size), 0) AS n FROM doc_revisions WHERE doc_id = ?").get(n).n;if(e<=this.maxHistoryBytes)return;let i=this.db.prepare(`SELECT id, size FROM doc_revisions r WHERE doc_id = ? AND id <> (
          SELECT MAX(id) FROM doc_revisions WHERE doc_id = r.doc_id AND path = r.path) ORDER BY id ASC`).all(n),s=e-this.maxHistoryBytes,r=this.db.prepare("DELETE FROM doc_revisions WHERE id = ?");for(let o of i){if(s<=0)break;r.run(o.id),s-=o.size}}touch(n,e,i=this.now()){this.db.prepare("UPDATE docs SET revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ?").run(i,JSON.stringify(e),n)}touchReview(n){this.db.prepare("UPDATE docs SET revision = revision + 1 WHERE id = ?").run(n)}linkThreadRow(n,e,i,s,r){let o=this.db.prepare("SELECT role, title FROM doc_threads WHERE doc_id = ? AND thread_id = ?").get(n,e),a=o&&(Qt[o.role]??0)>=Qt[s]?o.role:s,d=i.trim(),c=(d===_t?"":d)||o?.title||d;this.db.prepare(`INSERT INTO doc_threads (doc_id, thread_id, title, role, last_activity_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (doc_id, thread_id) DO UPDATE SET title = excluded.title, role = excluded.role,
          last_activity_at = excluded.last_activity_at`).run(n,e,c.slice(0,140),a,r),this.db.prepare(`DELETE FROM doc_threads WHERE doc_id = ? AND thread_id NOT IN (
          SELECT thread_id FROM doc_threads WHERE doc_id = ? ORDER BY last_activity_at DESC LIMIT ?)`).run(n,n,50)}revisionRow(n,e){let i=Number(e),s=Number.isInteger(i)?this.db.prepare("SELECT * FROM doc_revisions WHERE doc_id = ? AND id = ?").get(n,i):void 0;if(!s)throw new l("not_found",`revision ${String(e)} not found`);return s}commentById(n,e){let i=this.db.prepare("SELECT * FROM doc_comments WHERE doc_id = ? AND (id = ? OR parent_id = ?) ORDER BY created_at, rowid").all(n,e,e);return Je(i)[0]}rootComment(n,e){let i=String(e??""),s=this.db.prepare("SELECT * FROM doc_comments WHERE doc_id = ? AND id = ?").get(n.id,i);if(!s)throw new l("not_found",`comment ${i} not found in ${n.slug}`);if(s.parent_id)throw new l("invalid",`${i} is a reply; use its comment ${s.parent_id} instead`);return s}insertComment(n,e,i,s){if(this.db.prepare("SELECT COUNT(*) AS n FROM doc_comments WHERE doc_id = ?").get(n).n>=500)throw new l("limit",`a design doc holds at most ${500} comments and replies; delete resolved ones first`);this.db.prepare(`INSERT INTO doc_comments (id, doc_id, parent_id, path, quote, body, author, status, created_at, resolved_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, NULL)`).run(e.id,n,e.parentId,e.path,e.quote,e.body,JSON.stringify(i),s)}uniqueSlug(n){let e=new Set(this.db.prepare("SELECT slug FROM docs WHERE slug = ? OR slug LIKE ? ESCAPE '\\'").all(n,`${ze(n)}-%`).map(i=>i.slug));if(!e.has(n))return n;for(let i=2;;i+=1){let s=`${n}-${i}`;if(!e.has(s))return s}}};function Bi(t){return t.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,48).replace(/-+$/g,"")||"design-doc"}function qi(t,n,e){let i=t;return n.forEach((s,r)=>{let o=n.length>1?` (edit ${r+1})`:"";if(!s||typeof s.oldText!="string"||typeof s.newText!="string")throw new l("invalid",`each edit needs string oldText and newText${o}`);if(!s.oldText)throw new l("invalid",`oldText must not be empty${o}`);if(s.oldText===s.newText)throw new l("invalid",`oldText and newText are identical${o}`);let a=Xi(i,s.oldText);if(a===0)throw new l("conflict",`oldText not found in ${e}${o}; re-read the file and match its text exactly, including whitespace`);if(a>1&&!s.replaceAll)throw new l("conflict",`oldText matches ${a} places in ${e}${o}; include more surrounding text or set replaceAll`);i=s.replaceAll?i.split(s.oldText).join(s.newText):i.replace(s.oldText,()=>s.newText)}),i}function Xi(t,n){let e=0,i=t.indexOf(n);for(;i!==-1;)e+=1,i=t.indexOf(n,i+n.length);return e}function C(t){try{return L(t)}catch(n){throw n instanceof $?new l("invalid",n.message):n}}function qe(t,n,e){let i=C(t);if(typeof n!="string")throw new l("invalid",`content for ${i} must be a string`);let s=Q(D(i)),r=e??(s?"base64":"utf8");if(s&&r!=="base64")throw new l("invalid",`${i} is a binary file; send its bytes base64-encoded`);if(!s&&r!=="utf8")throw new l("invalid",`${i} is a text file; send it as UTF-8 text`);if(r==="base64"){let a=n.replace(/\s+/g,"");if(!/^[A-Za-z0-9+/]*={0,2}$/.test(a)||a.length%4!==0)throw new l("invalid",`content for ${i} is not valid base64`);let d=Buffer.from(a,"base64").length;if(d>2097152)throw new l("limit",`${i} exceeds the ${S(2097152)} binary file limit`);return{path:i,content:a,encoding:"base64",size:d}}let o=Buffer.byteLength(n,"utf8");if(o>2097152)throw new l("limit",`${i} exceeds the ${S(2097152)} file limit; split it into several files`);return{path:i,content:n,encoding:"utf8",size:o}}function vt(t,n,e){if(e==null)return;if(!Number.isInteger(e)||e<0)throw new l("invalid","baseRevision must be a non-negative integer");let i=n?.revision??0;if(i!==e)throw new l("conflict",n?`${t} changed since revision ${e} (now ${i}, last edited by ${N(Y(n.updated_by))}); re-read it and reapply your change`:`${t} does not exist (expected revision ${e}); re-read the doc`)}function Xe(t){let n=typeof t=="string"?t.replace(/\s+/g," ").trim():"";if(!n)throw new l("invalid","title is required");if(n.length>140)throw new l("invalid",`title must be at most ${140} characters`);return n}function We(t){let n=typeof t=="string"?t.trim():"";if(n.length>600)throw new l("invalid",`summary must be at most ${600} characters`);return n}function Ge(t){if(!Array.isArray(t))throw new l("invalid","tags must be an array of strings");let n=[];for(let e of t){if(typeof e!="string")throw new l("invalid","tags must be an array of strings");let i=e.trim().toLowerCase().replace(/\s+/g,"-");if(i){if(i.length>32)throw new l("invalid",`tag ${JSON.stringify(i)} is longer than ${32} characters`);n.includes(i)||n.push(i)}}if(n.length>12)throw new l("invalid",`at most ${12} tags`);return n}function Zt(t){if(typeof t!="string")return null;let n=t.replace(/\s+/g," ").trim();return n?n.slice(0,200):null}function Ke(t,n,e){let i=typeof t=="number"?Math.floor(t):Number.NaN;return!Number.isFinite(i)||i<=0?n:Math.min(i,e)}function ze(t){return t.replace(/[\\%_]/g,n=>`\\${n}`)}function Y(t){try{let n=JSON.parse(t);return{kind:n.kind==="agent"?"agent":"user",label:typeof n.label=="string"&&n.label?n.label:"Unknown",threadId:typeof n.threadId=="string"?n.threadId:null}}catch{return{kind:"user",label:"Unknown",threadId:null}}}function Wi(t){try{let n=JSON.parse(t);return Array.isArray(n)?n.filter(e=>typeof e=="string"):[]}catch{return[]}}function nt(t){return{id:t.id,slug:t.slug,title:t.title,summary:t.summary,status:x(t.status)?t.status:"draft",projectId:t.project_id,tags:Wi(t.tags),entryPath:t.entry_path,fileCount:Number(t.file_count??0),openComments:Number(t.open_comments??0),revision:t.revision,createdAt:t.created_at,updatedAt:t.updated_at,createdBy:Y(t.created_by),updatedBy:Y(t.updated_by)}}function it(t){return{path:t.path,kind:D(t.path),size:t.size,revision:t.revision,updatedAt:t.updated_at,updatedBy:Y(t.updated_by)}}function Ye(t){return{id:t.id,path:t.path,revision:t.revision,op:["create","write","delete","rename"].includes(t.op)?t.op:"write",size:t.size,note:t.note,renamedFrom:t.renamed_from,actor:Y(t.actor),createdAt:t.created_at}}function Je(t){let n=new Map;for(let e of t)e.parent_id||n.set(e.id,{id:e.id,docId:e.doc_id,path:e.path,quote:e.quote,body:e.body,author:Y(e.author),status:e.status==="resolved"?"resolved":"open",createdAt:e.created_at,resolvedAt:e.resolved_at,replies:[]});for(let e of t)e.parent_id&&n.get(e.parent_id)?.replies.push({id:e.id,body:e.body,author:Y(e.author),createdAt:e.created_at});return[...n.values()]}function Vt(t){let n=typeof t=="string"?t.trim():"";if(!n)throw new l("invalid","comment body is required");if(n.length>8e3)throw new l("limit",`comment body must be at most ${8e3} characters`);return n}function Gi(t){let n=t.role;return{threadId:t.thread_id,title:t.title,role:n in Qt?n:"assistant",lastActivityAt:t.last_activity_at}}var q=()=>null,Ji=200,Zi=8*1024*1024;function en(t){let n=new Map,e,i=s=>{let r;try{r=L(s)}catch{return null}if(e===void 0)try{e=Ze(t)}catch{e=null}if(!e)return null;try{let o=Ze(zi(e,r));if(!o.startsWith(e+Yi))return null;let a=Ki(o);if(!a.isFile()||a.size>2097152)return null;let d=D(r),c=Q(d),u=tn(o,c?"base64":"utf8");return{path:`${B}/${r}`,kind:d,content:u,encoding:c?"base64":"utf8",revision:0}}catch{return null}};return s=>{if(n.has(s))return n.get(s);let r=i(s);return n.size<Ji&&n.set(s,r),r}}function At(t,n,e){return i=>{try{let s=t.readFile(n,i);return{path:s.path,kind:s.kind,content:s.content,encoding:s.encoding,revision:s.revision}}catch(s){if(!(s instanceof l)||s.code!=="not_found"&&s.code!=="invalid")throw s}return i.startsWith(`${B}/`)?e(i.slice(B.length+1)):null}}function nn(t){try{return L(t)}catch(n){throw new l("invalid",n.message)}}function rt(t,n,e){let i=t.summary(e.doc),s=nn(e.path??i.entryPath);if(D(s)!=="html")throw new l("invalid",`${s} is not an HTML page`);if(e.draft!==void 0&&Qe.byteLength(e.draft,"utf8")>2097152)throw new l("limit",`the draft of ${s} is larger than a doc file may be`);let r=At(t,i.id,n),o=r(s);if(e.draft===void 0&&(!o||o.revision===0))throw new l("not_found",`${s} not found in ${i.slug}`);let a=e.draft??o.content,d=ke({entryPath:s,html:a,read:r});return{docId:i.id,path:s,revision:o&&o.revision>0?o.revision:null,...d}}function Vi(t,n,e=Zi){let i=new Set([n.path,...n.deps.map(a=>a.path)]),s=t.filter(a=>!i.has(a.path)).sort((a,d)=>+(a.encoding==="base64")-+(d.encoding==="base64")||et(a.path,d.path)),r={},o=0;for(let a of s){let d=a.content.length+a.path.length;o+d>e||(o+=d,r[a.path]={kind:a.kind,encoding:a.encoding,content:a.content})}return r}function Qi(t,n,e,i){let s=rt(t,n,{doc:e.doc,path:e.path}),r=t.readAllFiles(s.docId),o={mode:"standalone",docId:s.docId,path:s.path,endpoint:i.endpoint,files:r.map(c=>c.path),missing:s.missing,warnings:s.warnings},a=Vi(r,s,i.packBudget),d=`<script type="application/json" id="${_e}">${Kt(o)}</script><script type="application/json" id="${De}">${Kt(a)}</script><script>${Jt(i.runtime)}</script>`;return ft(s.html,d)}var tr=["sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox","default-src 'none'","script-src 'unsafe-inline' blob:","style-src 'unsafe-inline'","img-src data: blob: https:","font-src data:","connect-src https:","form-action 'none'",`base-uri ${bt}`,"frame-ancestors 'none'"].join("; "),rn="sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'none'",ee={"cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer","cross-origin-resource-policy":"same-origin"};function Ve(t){let n=t instanceof l?t.code:null,e=n==="not_found"?404:n==="invalid"||n==="limit"?400:500,i=n?t.message:"The page could not be rendered.";return{status:e,body:`${i}
`,headers:{...ee,"content-type":"text/plain; charset=utf-8","content-security-policy":rn}}}function sn(t,n){let e=t.query[n];return typeof e=="string"&&e?e:void 0}function te(t,n){let e=sn(t,n);if(!e)throw new l("invalid",`${n} is required`);return e}function er(t){let n=D(t);return n==="image"?tt(t)??"application/octet-stream":n==="font"?yt(t):n==="svg"?"image/svg+xml":"text/plain; charset=utf-8"}function on(t){let n=(e,i)=>({status:200,body:Qi(t.store,t.kit,{doc:e,path:i},{endpoint:t.endpoint,runtime:t.runtime()}),headers:{...ee,"content-type":"text/html; charset=utf-8","content-security-policy":tr}});return{page(e){try{return n(te(e,"doc"),sn(e,"path"))}catch(i){return Ve(i)}},file(e){try{let i=te(e,"doc"),s=nn(te(e,"path"));if(D(s)==="html")return n(i,s);let r=t.store.summary(i),o=At(t.store,r.id,t.kit)(s);if(!o)throw new l("not_found",`${s} not found in ${r.slug}`);return{status:200,body:o.encoding==="base64"?new Uint8Array(Qe.from(o.content,"base64")):o.content,headers:{...ee,"content-type":er(s),"content-security-policy":rn}}}catch(i){return Ve(i)}}}}function an(t){return`/api/v1/plugins/${encodeURIComponent(t)}/http`}function dn(t,n,e,i){let s=new URL(`${n}/page`,t);return s.searchParams.set("doc",e),s.searchParams.set("path",i),s.href}function cn(t=process.env){let n=t.ZCC_SERVER_URL?.trim();return n?n.replace(/\/+$/,""):`http://127.0.0.1:${t.ZCC_SERVER_PORT&&/^\d+$/.test(t.ZCC_SERVER_PORT)?t.ZCC_SERVER_PORT:"8780"}`}function ln(t,n=()=>{}){let e=null;return()=>{if(e!==null)return e;let i;try{i=tn(t,"utf8")}catch(s){return n(`page runtime unavailable: ${s.message}`),""}return e=i,i}}function ie(t,n){return{projectName:t.projectName?.(n.projectId)??null}}function w(t){return t&&typeof t=="object"&&!Array.isArray(t)?t:{}}function m(t,n){let e=t[n];if(typeof e!="string"||!e.trim())throw new l("invalid",`${n} is required`);return e}function h(t,n){let e=t[n];if(e!=null){if(typeof e!="string")throw new l("invalid",`${n} must be a string`);return e}}function X(t,n){let e=t.store.find(n);if(!e)return n;if(e.id!==n.trim()&&t.projectId&&e.projectId&&e.projectId!==t.projectId){let s=t.projectName?.(e.projectId)??e.projectId;throw new l("invalid",`"${n.trim()}" is a design doc in project ${s} (${e.id}), not this one. Pass its id to use it from here, or call design_doc_list to find this project's doc.`)}return e.id}function re(t,n){let e=t[n];if(e==null||e==="")return;let i=typeof e=="string"?Number(e):e;if(typeof i!="number"||!Number.isInteger(i))throw new l("invalid",`${n} must be an integer`);return i}function pn(t,n){let e=t[n];if(e!=null){if(typeof e=="string")return e.split(",").map(i=>i.trim()).filter(Boolean);if(!Array.isArray(e)||e.some(i=>typeof i!="string"))throw new l("invalid",`${n} must be an array of strings`);return e}}function gn(t,n){let e=h(t,n);if(e!==void 0){if(!x(e))throw new l("invalid",`${n} must be one of ${H.join(", ")}`);return e}}function xt(t,n){let e=w(n),i=h(e,"scope")??"project";if(i!=="project"&&i!=="all")throw new l("invalid","scope must be project or all");let s=h(e,"status")??"active";if(s!=="active"&&s!=="all"&&!x(s))throw new l("invalid",`status must be active, all, or one of ${H.join(", ")}`);let r=t.store.list({projectId:i==="project"&&t.projectId?t.projectId:void 0,query:h(e,"query"),status:s,limit:re(e,"limit")});return`${i==="project"&&t.projectId?"Design docs for this project (plus global docs), newest first:":"Design docs across all projects, newest first:"}
${be(r)}`}var nr=5;function un(t,n,e){if(D(e)!=="html")return[];let i=[];try{let r=Ft(rt(t.store,t.kit??q,{doc:n.id,path:e}));r&&i.push(r)}catch{}let s=t.reports?.current(n.id,n.files).find(r=>r.path===e);return s&&i.push(Ut(s,n.comments)),i}function ir(t,n){let e=(t.reports?.current(n.id,n.files)??[]).filter(r=>r.path!==n.entryPath&&Ht(r,n.comments).length);if(!e.length)return null;let i=e.slice(0,nr).map(r=>Ut(r,n.comments)),s=e.length-i.length;return["## Page problems",...i,s?`(${s} more page(s) had problems; read them by path.)`:""].filter(Boolean).join(`

`)}var rr=new Set(["image/png","image/jpeg","image/gif","image/webp"]);function It(t,n){let e=w(n),i=X(t,m(e,"doc")),s=h(e,"path"),r=t.store.get(i);if(s){let d=t.store.readFile(r.id,s),c=`${W(d)}

To change it, call design_doc_write with doc="${r.id}", path="${d.path}", baseRevision=${d.revision}.`,u=d.encoding==="base64"?tt(d.path):null;return u&&rr.has(u)?{content:[{type:"text",text:c},{type:"image",data:d.content,mimeType:u}]}:[c,...un(t,r,d.path)].join(`

`)}if(e.includeAll===!0||e.includeAll==="true")return`${gt(r,t.store.readAllFiles(r.id),ie(t,r))}

${ht(r)}`;let o=r.files.some(d=>d.path===r.entryPath),a=o?W(t.store.readFile(r.id,r.entryPath)):"";return[Z(r,ie(t,r)),a?`## Entry file
${a}`:"",...o?un(t,r,r.entryPath):[],ir(t,r)??"",'Read other files with design_doc_read path="\u2026", or everything at once with includeAll=true.',ht(r)].filter(Boolean).join(`

`)}function Pt(t,n,e){let i=w(n),s=h(i,"template");if(s&&!k.some(d=>d.id===s))throw new l("invalid",`template must be one of ${k.map(d=>d.id).join(", ")}`);let r=i.files;if(r!==void 0&&!Array.isArray(r))throw new l("invalid","files must be an array");let o=i.global===!0||i.global==="true",a=t.store.create({title:m(i,"title"),summary:h(i,"summary"),tags:pn(i,"tags"),status:gn(i,"status"),template:s,files:r?.map((d,c)=>{let u=w(d);if(typeof u.path!="string"||typeof u.content!="string")throw new l("invalid",`files[${c}] needs string path and content`);let p=u.encoding==="base64"?"base64":void 0;return{path:u.path,content:u.content,encoding:p}}),entryPath:h(i,"entryPath"),projectId:o?null:t.projectId??null},e);return t.changed(a.id),`Created design doc ${a.id} ("${a.title}").

${Z(a,ie(t,a))}

${ht(a)}`}function J(t,n,e){let i=w(n),s=X(t,m(i,"doc")),r=m(i,"path"),o=re(i,"baseRevision"),a=h(i,"note"),d=h(i,"content"),c=h(i,"renameTo"),u=i.delete===!0||i.delete==="true",p=i.edits??void 0;if([d!==void 0,p!==void 0,u,c!==void 0].filter(Boolean).length!==1)throw new l("invalid","pass exactly one of content, edits, delete or renameTo");let v=t.store.summary(s);if(u)return t.store.deleteFile(v.id,r,e,{baseRevision:o,note:a}),t.changed(v.id),`Deleted ${r} from ${v.id}. It stays in history and can be restored from the Design Docs panel.`;if(c!==void 0){let T=t.store.renameFile(v.id,r,c,e,{baseRevision:o,note:a});return t.changed(T.docId),`Renamed ${r} to ${T.path} (rev ${T.revision}).`}let g;if(p!==void 0){if(!Array.isArray(p))throw new l("invalid","edits must be an array");g=t.store.editFile(v.id,{path:r,edits:p,baseRevision:o,note:a},e)}else{let T=i.encoding==="base64"?"base64":void 0;g=t.store.writeFile(v.id,{path:r,content:d,encoding:T,baseRevision:o,note:a},e)}return t.changed(g.docId),[`${g.created?"Created":"Updated"} ${g.path} in ${g.docId} \u2192 revision ${g.revision}. Use baseRevision=${g.revision} for your next change to this file. The user sees updates live in the Design Docs panel.`,...sr(t,g.docId,g.path)].join(`

`)}function sr(t,n,e){if(D(e)!=="html")return[];let i=[];try{let s=Ft(rt(t.store,t.kit??q,{doc:n,path:e}));s&&i.push(s),Wt(t.store.readFile(n,e).content).scripted&&i.push("Its scripts run when the page is open in the Design Docs panel; read the page again after that to see any script errors.")}catch{}return i}function St(t,n,e){let i=w(n),s=X(t,m(i,"doc")),r=t.store.update(s,{title:h(i,"title"),summary:h(i,"summary"),status:gn(i,"status"),tags:pn(i,"tags"),entryPath:h(i,"entryPath")},e);return t.changed(r.id),`Updated ${r.id}: "${r.title}" \xB7 ${r.status} \xB7 tags: ${r.tags.join(", ")||"none"} \xB7 entry: ${r.entryPath}`}function st(t,n,e){let i=w(n),s=X(t,m(i,"doc")),r={resolve:h(i,"resolve"),reopen:h(i,"reopen"),replyTo:h(i,"replyTo")},o=Object.entries(r).filter(([,p])=>p?.trim());if(o.length>1)throw new l("invalid",`pass only one of resolve, reopen or replyTo (got ${o.map(([p])=>p).join(" and ")})`);let[a,d]=o[0]??[];if(a&&(i.path!==void 0||i.quote!==void 0))throw new l("invalid",`path and quote anchor a new comment; ${a} keeps the comment's own anchor`);if(a==="replyTo"){let p=t.store.addReply(s,d,m(i,"body"),e);return t.changed(p.docId),`Replied to comment ${p.id}.
${dt(p)}`}if(a){let p=h(i,"body"),y=t.store.setCommentStatus(s,d,a==="resolve"?"resolved":"open",e,p);return t.changed(y.docId),`${a==="resolve"?"Resolved":"Reopened"} comment ${y.id}${p?.trim()?" and added your reply":""}.
${dt(y)}`}let c=t.store.addComment(s,{body:m(i,"body"),path:h(i,"path"),quote:h(i,"quote")},e);t.changed(c.docId);let u=c.quote?or(t.store,c):null;return`Added comment ${c.id}.
${dt(c)}${u?`

${u}`:""}`}function ne(t){return t.replace(/!?\[([^\]]*)\]\([^)]*\)/g,"$1").replace(/[*_`~#>|]/g,"").replace(/\s+/g," ").trim().toLowerCase()}function or(t,n){if(!n.path)return"Note: the quote has no path, so the panel cannot highlight it. Pass path with quote next time.";let e=t.readFile(n.docId,n.path);if(e.encoding!=="utf8")return null;let i=ne(n.quote);if(e.kind==="html"){let s=Wt(e.content);return ne(s.text).includes(i)?null:s.scripted?`Note: the quote is not in the HTML of ${n.path}. The panel highlights it if the page's scripts show that text; otherwise quote the text as the page shows it.`:`Note: the quote does not appear on ${n.path}, so the panel cannot highlight it. Quote the text as the page shows it, not its HTML.`}return ne(e.content).includes(i)?null:`Note: the quote does not appear in ${n.path}, so the panel cannot highlight it. Quote the passage exactly as written.`}function hn(t,n){let e=w(n),i=X(t,m(e,"doc"));return Ee(t.store.history(i,{path:h(e,"path"),limit:re(e,"limit")}))}var mn=".nojekyll";function fn(t,n){let e=t.map(({path:r,content:o,encoding:a})=>({path:r,content:o,encoding:a})),i=new Set(t.map(r=>r.path));if(t.some(r=>r.encoding==="utf8"&&r.content.includes(`${B}/`)))for(let r of Ie){let o=`${B}/${r}`,a=i.has(o)?null:n(r);a&&e.push({path:o,content:a.content,encoding:a.encoding})}return t.some(r=>r.kind==="html")&&!i.has(mn)&&e.push({path:mn,content:"",encoding:"utf8"}),e}function yn(t){let n=t.split("/");return n.some(e=>e.startsWith("."))?"hidden":n.includes("node_modules")?"dependencies":n[0]===B?"the site kit; Design Docs serves it and export copies it":null}async function se(t,n,e){let i=[],s=0,r=!1,o=async()=>{for(;!r&&s<t.length;){let a=s;s+=1;try{i[a]=await e(t[a])}catch(d){throw r=!0,d}}};return await Promise.all(Array.from({length:Math.min(n,t.length)},o)),i}var cr="design-docs",$t=[{name:"list",summary:"List design docs",usage:"list [--query <text>] [--status active|all|<status>] [--all-projects] [--json]"},{name:"show",summary:"Show a doc manifest and its entry file",usage:"show <doc> [--all] [--json]"},{name:"read",summary:"Print one text file raw",usage:"read <doc> <path>"},{name:"create",summary:"Create a design doc",usage:`create --title <title> [--summary <text>] [--template ${k.map(t=>t.id).join("|")}] [--status <status>] [--tags a,b] [--global]`},{name:"write",summary:"Write a whole file (creates it if missing)",usage:"write <doc> <path> (--file <local-path> | --content <text>) [--base-revision <n>] [--note <text>]"},{name:"edit",summary:"Exact-match replace inside a file",usage:"edit <doc> <path> --old <text> --new <text> [--replace-all] [--base-revision <n>] [--note <text>]"},{name:"rm",summary:"Delete a file (kept in history)",usage:"rm <doc> <path> [--base-revision <n>] [--note <text>]"},{name:"mv",summary:"Rename a file",usage:"mv <doc> <from> <to> [--base-revision <n>] [--note <text>]"},{name:"update",summary:"Change title, summary, status, tags or entry file",usage:"update <doc> [--title <t>] [--summary <s>] [--status <status>] [--tags a,b] [--entry <path>]"},{name:"comment",summary:"Add a review comment",usage:"comment <doc> <body> [--path <file>] [--quote <text>]"},{name:"reply",summary:"Reply to a comment",usage:"reply <doc> <comment-id> <body>"},{name:"resolve",summary:"Resolve a comment",usage:"resolve <doc> <comment-id> [--note <reply>]"},{name:"reopen",summary:"Reopen a resolved comment",usage:"reopen <doc> <comment-id> [--note <reply>]"},{name:"history",summary:"Show revision history",usage:"history <doc> [--path <file>] [--limit <n>]"},{name:"import",summary:"Bring local files (a site folder) into a doc, or into a new one with --title",usage:"import (<doc> | --title <title>) <file>... [--base <folder>] [--entry <path>] [--note <text>] [--global]"},{name:"export",summary:"Write the doc as a static site (--out), or print it as one bundle",usage:"export <doc> (--out <folder> | [--json])"},{name:"preview",summary:"Print the URL of an HTML page rendered like the published site",usage:"preview <doc> [<page.html>]"}],lr=new Set(["json","all","all-projects","global","replace-all","help"]);function ur(t){let n=[],e={};for(let i=0;i<t.length;i+=1){let s=t[i];if(s==="--"){n.push(...t.slice(i+1));break}if(s.startsWith("--")){let r=s.slice(2),o=r.indexOf("=");if(o!==-1)e[r.slice(0,o)]=r.slice(o+1);else if(lr.has(r))e[r]=!0;else{let a=t[i+1];if(a===void 0)throw new l("invalid",`--${r} needs a value`);e[r]=a,i+=1}}else s==="-h"?e.help=!0:n.push(s)}return{positional:n,flags:e}}function oe(){let t=Math.max(...$t.map(n=>n.name.length));return["zcc design-docs \u2014 design documents your agents can read and edit","","Commands:",...$t.map(n=>`  ${n.name.padEnd(t)}  ${n.summary}`),"","Usage:",...$t.map(n=>`  zcc design-docs ${n.usage}`),"","<doc> is a design doc id (dd_\u2026) or slug.","Publish a site: zcc design-docs export <doc> --out docs, commit it, then serve that folder with GitHub Pages."].join(`
`)}var pr={kind:"user",label:"CLI",threadId:null},wn=9e5,bn=8;function E(t,n){let e=t[n];return typeof e=="string"?e:void 0}function R(t,n,e){let i=t[n];if(!i)throw new l("invalid",`missing <${e}>; see zcc design-docs help`);return i}async function gr(t,n,e){try{let i=await hr(t,n,e);return{exitCode:0,stdout:i.endsWith(`
`)?i:`${i}
`}}catch(i){let s=i instanceof Error?i.message:String(i);return{exitCode:i instanceof l&&i.code==="invalid"?2:1,stderr:`${s}
`}}}async function hr(t,n,e){let[i,...s]=n;if(!i||i==="help"||i==="--help"||i==="-h")return oe();let{positional:r,flags:o}=ur(s);if(o.help)return oe();let[a]=await Promise.all([t.caller(e),t.projects?.refresh()]),d=g=>t.projects?.name(g)??null,c={store:t.store,changed:t.changed,projectId:a.projectId,projectName:d,kit:t.kit,reports:t.reports},u=g=>X(c,R(r,g,"doc")),p=E(o,"base-revision"),y=E(o,"note"),v=o.json===!0;switch(i){case"list":{let g=o["all-projects"]===!0?"all":"project";if(v){let b=t.store.list({projectId:g==="project"&&a.projectId?a.projectId:void 0,query:E(o,"query"),status:E(o,"status")??"active"});return JSON.stringify(b,null,2)}return xt(c,{query:E(o,"query"),status:E(o,"status"),scope:g})}case"show":{if(v)return JSON.stringify(t.store.get(u(0)),null,2);let g=It(c,{doc:R(r,0,"doc"),includeAll:o.all===!0});return typeof g=="string"?g:g.content.map(b=>"text"in b?b.text:"").join(`
`)}case"read":{let g=t.store.readFile(u(0),R(r,1,"path"));if(g.encoding!=="utf8")throw new l("invalid",`${g.path} is a binary file; open it in the Design Docs panel or read it with the design_doc_read tool`);return g.content}case"create":return Pt(c,{title:E(o,"title")??r.join(" "),summary:E(o,"summary"),template:E(o,"template"),tags:E(o,"tags"),status:E(o,"status"),global:o.global===!0},a.actor);case"write":{let g=R(r,1,"path"),b=E(o,"file"),f=E(o,"content");if(b!==void 0&&f!==void 0)throw new l("invalid","pass either --file or --content, not both");if(b!==void 0){if(!a.files)throw new l("invalid","--file reads only inside a registered project; run it from the project folder or pass --content");let T=await t.readLocalFile({files:a.files,path:b,cwd:e.cwd});if(T.encoding!=="utf8")throw new l("invalid",`${b} is not a text file; bring images and fonts in with zcc design-docs import`);f=T.content}if(f===void 0)throw new l("invalid","write needs --file <path> or --content <text>");return J(c,{doc:R(r,0,"doc"),path:g,content:f,baseRevision:p,note:y},a.actor)}case"edit":{let g=E(o,"old"),b=E(o,"new");if(g===void 0||b===void 0)throw new l("invalid","edit needs --old <text> and --new <text>");return J(c,{doc:R(r,0,"doc"),path:R(r,1,"path"),edits:[{oldText:g,newText:b,replaceAll:o["replace-all"]===!0}],baseRevision:p,note:y},a.actor)}case"rm":return J(c,{doc:R(r,0,"doc"),path:R(r,1,"path"),delete:!0,baseRevision:p,note:y},a.actor);case"mv":return J(c,{doc:R(r,0,"doc"),path:R(r,1,"from"),renameTo:R(r,2,"to"),baseRevision:p,note:y},a.actor);case"update":return St(c,{doc:R(r,0,"doc"),title:E(o,"title"),summary:E(o,"summary"),status:E(o,"status"),tags:E(o,"tags"),entryPath:E(o,"entry")},a.actor);case"comment":return st(c,{doc:R(r,0,"doc"),body:r.slice(1).join(" ")||E(o,"body"),path:E(o,"path"),quote:E(o,"quote")},a.actor);case"reply":return st(c,{doc:R(r,0,"doc"),replyTo:R(r,1,"comment-id"),body:r.slice(2).join(" ")||E(o,"body")},a.actor);case"resolve":case"reopen":return st(c,{doc:R(r,0,"doc"),[i]:R(r,1,"comment-id"),body:y},a.actor);case"history":return hn(c,{doc:R(r,0,"doc"),path:E(o,"path"),limit:E(o,"limit")});case"import":return mr(t,c,a,r,o,e);case"export":{if(o.out!==void 0)return fr(t,a,u(0),o,e);let g=t.store.get(u(0)),b=t.store.readAllFiles(g.id);if(v){let f=JSON.stringify({...g,files:b},null,2);if(f.length>wn)throw new l("limit",`${g.id} is too large for --json here; export it without --json for a bounded bundle`);return f}return gt(g,b,{maxChars:wn,projectName:d(g.projectId)})}case"preview":{if(!t.pageUrl)throw new l("invalid","previews are not available here");let g=t.store.summary(u(0)),b=t.store.readFile(g.id,r[1]??g.entryPath);if(b.kind!=="html")throw new l("invalid",`${b.path} is not an HTML page; pass one, e.g. zcc design-docs preview ${g.slug} index.html`);let f=t.pageUrl(g.id,b.path);return[f,"","Open it in any browser on this machine; reload to see later edits. Pages run sandboxed, as on a static host.",`From a thread, show it in the app's browser panel: zcc browser create --url '${f}' --reveal (plus --host/--instance/--generation/--thread from zcc browser instances).`].join(`
`)}default:throw new l("invalid",`unknown command "${i}"

${oe()}`)}}function En(t,n){if(!t.files)throw new l("invalid",`${n} works only inside a registered project; run it from the project folder`);return t.files}function kt(t,n,e){return Lt(e&&lt(e,t.root)?e:t.root,n)}function vn(t){return t instanceof Error?t.message:String(t)}async function mr(t,n,e,i,s,r){let o=E(s,"title"),a=o===void 0?t.store.summary(X(n,R(i,0,"doc"))):null,d=a?i.slice(1):i;if(d.length===0)throw new l("invalid","import needs the files to bring in, e.g. zcc design-docs import <doc> $(git ls-files site) --base site");if(d.length>500)throw new l("limit",`a design doc holds at most ${500} files; import fewer`);let c=En(e,"import"),u=kt(c,E(s,"base")??".",r.cwd);if(!lt(u,c.root))throw new l("invalid",`--base must be inside the project folder ${c.root}`);let p=new Map,y=[];for(let _ of d){let j=kt(c,_,r.cwd);if(j===Lt(u)||!lt(j,u))throw new l("invalid",`${_} is not inside ${u}; pass --base <folder> that holds every file`);let F=dr(u,j).split(ae).join("/"),ut=yn(F);ut?y.push(`${F} (${ut})`):p.set(F,j)}if(p.size===0)throw new l("invalid",`nothing to import; skipped ${y.join(", ")}`);let v=0,g=await se([...p],bn,async([_,j])=>{let F;try{F=await t.readLocalFile({files:c,path:j})}catch(ut){throw new Error(`cannot read ${_}: ${vn(ut)}`)}if(v+=F.sizeBytes,v>25165824)throw new l("limit",`these files add up to more than a design doc holds (${S(25165824)})`);return{path:_,content:F.content,encoding:F.encoding}}),b=E(s,"note")??"Imported",f=E(s,"entry"),T=y.length>0?[`Skipped ${y.length}: ${y.join(", ")}`]:[];if(!a){let _=t.store.create({title:o,summary:E(s,"summary"),projectId:s.global===!0?null:e.projectId,files:g,entryPath:f??g.find(j=>j.path.toLowerCase()==="index.html")?.path},e.actor);return t.changed(_.id),[`Created design doc ${_.id} ("${_.title}") from ${g.length} files; it opens on ${_.entryPath}.`,...T,`Preview: zcc design-docs preview ${_.slug}`].join(`
`)}let Mt=t.store.writeFiles(a.id,g.map(_=>({..._,note:b})),e.actor);f!==void 0&&t.store.update(a.id,{entryPath:f},e.actor),t.changed(a.id);let le=Mt.filter(_=>_.created).length,jt=t.store.summary(a.id);return[`Imported ${Mt.length} files into ${jt.slug} (${jt.id}): ${le} new, ${Mt.length-le} updated or unchanged. It opens on ${jt.entryPath}.`,...T].join(`
`)}async function fr(t,n,e,i,s){let r=E(i,"out");if(!r)throw new l("invalid","--out needs the folder to write the site into");if(!t.writeLocalFile)throw new l("invalid","export --out is not available here");let o=En(n,"export --out"),a=kt(o,r,s.cwd);if(!lt(a,o.root))throw new l("invalid",`--out must be inside the project folder ${o.root}`);let d=t.store.summary(e),c=t.store.readAllFiles(d.id),u=fn(c,t.kit??q),p=t.writeLocalFile;await se(u,bn,async g=>{try{await p({files:o,path:ar(a,g.path),content:g.content,encoding:g.encoding})}catch(b){throw new Error(`cannot write ${g.path}: ${vn(b)}`)}});let y=u.slice(c.length).map(g=>g.path),v=c.some(g=>g.kind==="html");return[`Exported ${d.slug} to ${a}: ${c.length} doc files${y.length>0?`, plus ${y.join(", ")}`:""}.`,"Files already there that the doc does not have were left in place.",...v?[`It opens on ${d.entryPath}${d.entryPath==="index.html"?"":"; a static host serves index.html first, so add one or link to it"}.`,"GitHub Pages: commit the folder, then in the repository settings under Pages, deploy from a branch and pick it (it must be the root or /docs)."]:[]].join(`
`)}function Tn(t,n){t.cli.register({name:cr,summary:"Read and edit design docs (specs, RFCs, ADRs) shared with your agents",commands:$t.map(e=>({...e})),run:(e,i)=>gr(n,e,i)})}function lt(t,n){let e=Lt(n),i=Lt(t);return i===e||i.startsWith(e.endsWith(ae)?e:e+ae)}function yr(t,n){if(n)return t.filter(e=>e.path&&lt(n,e.path)).sort((e,i)=>i.path.length-e.path.length)[0]}function Rn(t,n){return async e=>{let i=e.threadId?await t.threads.get({threadId:e.threadId}).catch(()=>null):null,s=await t.projects.list().catch(()=>[]);if(i){let a=(i.environmentId?await t.environments.get({environmentId:i.environmentId}).catch(()=>null):null)?.path??s.find(d=>d.id===i.projectId)?.path??null;return{actor:await n(i.id),projectId:i.projectId,files:a?{hostId:i.hostId,root:a}:null}}let r=yr(s,e.cwd);return{actor:e.threadId?{kind:"agent",label:Dt,threadId:null}:pr,projectId:e.projectId??r?.id??null,files:r?.path?{root:r.path}:null}}}function _n(t){return async({files:n,path:e,cwd:i})=>{let s=await t.files.read({...n.hostId?{hostId:n.hostId}:{},path:kt(n,e,i),rootPath:n.root});return{content:s.content,encoding:s.contentEncoding,sizeBytes:s.sizeBytes}}}function Dn(t){return async({files:n,path:e,content:i,encoding:s})=>{await t.files.write({...n.hostId?{hostId:n.hostId}:{},path:e,rootPath:n.root,content:i,contentEncoding:s,createParents:!0})}}var wr=4e3,An=12,br=10,xn=24e3,In=["## Design docs","The user keeps design documents (specs, RFCs, ADRs, product docs) in the Design Docs plugin. Each doc is a small set of files \u2014 markdown, mermaid `.mmd` diagrams, self-contained `.html` mockups, code samples \u2014 rendered as formatted pages the user reviews.","- Use the `design_doc_*` tools (or `zcc design-docs \u2026` from a shell) to list, read, create and edit them. Read a doc before changing it; prefer `edits` over rewriting whole files and pass `baseRevision`.","- Treat open comments as review feedback: address them, then resolve each with a short `body` saying what changed. Answer a question in its thread with `replyTo` instead of opening a new comment.","- When the user asks for a design, spec, RFC or plan worth keeping, offer to write it as a design doc instead of only replying in chat.",`- To show a doc in your reply, write its card on its own line: ${pt("<id>")}`].join(`
`);function Er(t,n){let e=t.list({projectId:n||void 0,status:"active",limit:An+1});if(e.length===0)return`${In}

There are no design docs for this project yet.`;let i=[In,"","Design docs for this project (newest first):"],s=i.join(`
`).length,r=0;for(let o of e.slice(0,An)){let a=o.openComments?` \xB7 ${o.openComments} open comment${o.openComments===1?"":"s"}`:"",d=o.summary?` \u2014 ${G(o.summary,110)}`:"",c=`- ${o.id} "${G(o.title,80)}" (${at[o.status]}${a})${d}`;if(s+c.length+80>wr)break;i.push(c),s+=c.length+1,r+=1}return e.length>r&&i.push("- \u2026 more: call design_doc_list"),i.join(`
`)}function Pn(t,n,e=()=>{},i){t.agents.contributeInstructions(s=>{try{return Er(n,s.projectId||null)}catch(r){return e(`design docs instructions failed: ${r instanceof Error?r.message:String(r)}`),null}}),t.ui.registerMentionProvider({id:"design-doc",label:"Design docs",search(s){let r=typeof s=="string"?s:s.query,o=typeof s=="string"?void 0:s.projectId;return n.list({projectId:o||void 0,query:r,contents:!1,status:"active",limit:br}).map(a=>({id:a.id,label:`${a.title} \xB7 ${at[a.status]}`}))},async resolve(s){await i?.refresh();let r=n.get(s),o=r.files.some(d=>d.path===r.entryPath)?n.readFile(r.id,r.entryPath):null,a=o?o.content.length>xn&&o.encoding==="utf8"?`${W({...o,content:o.content.slice(0,xn)})}
(truncated \u2014 read the rest with design_doc_read)`:W(o):"";return{context:[`The user referenced design doc ${r.id}. Its current state:`,Z(r,{projectName:i?.name(r.projectId)??null}),a,`Read other files with design_doc_read doc="${r.id}" path="\u2026"; edit with design_doc_write.`].filter(Boolean).join(`

`)}}})}var vr=100,Tr=128*1024,Rr=50,_r=1e3;function M(t){throw new l("invalid",t)}function Ct(t,n,e,i){return Array.isArray(t)||M(`${n} must be an array`),t.length>e&&M(`${n} has more than ${e} entries`),t.map(i)}function de(t,n){return typeof t=="string"&&t.length<=_r?t:M(`${n} must be a doc path`)}function Sn(t){JSON.stringify(t).length>Tr&&M("render report is too large");let n;try{n=L(de(t.path,"path"))}catch(i){M(i.message)}let e=t.revision;return(typeof e!="number"||!Number.isSafeInteger(e)||e<1)&&M("revision must be a saved revision"),{path:n,revision:e,deps:Ct(t.deps,"deps",500,(i,s)=>{let r=i&&typeof i=="object"?i:{},o=r.revision;return(typeof o!="number"||!Number.isSafeInteger(o)||o<0)&&M(`deps[${s}] needs a revision`),{path:de(r.path,`deps[${s}].path`),revision:o}}),missing:Ct(t.missing,"missing",500,(i,s)=>de(i,`missing[${s}]`)),problems:Ct(t.problems,"problems",Ae,(i,s)=>xe(i)??M(`problems[${s}] is not a page problem`)),unanchored:Ct(t.unanchored,"unanchored",500,(i,s)=>typeof i=="string"&&i.length<=500?i:M(`unanchored[${s}] must be a quote`)).slice(0,Rr)}}var Nt=class{constructor(n=vr,e=Date.now){this.max=n;this.now=e}max;now;reports=new Map;record(n,e){let i=`${n}\0${e.path}`;for(this.reports.delete(i),this.reports.set(i,{...e,docId:n,at:this.now()});this.reports.size>this.max;)this.reports.delete(this.reports.keys().next().value)}current(n,e){let i=[];for(let[s,r]of this.reports)r.docId===n&&(Se(r,e,!1)?this.reports.delete(s):i.push(r));return i.sort((s,r)=>s.path.localeCompare(r.path))}};var Dr=[{id:"review",label:"Review",description:"Critical review with anchored comments",icon:"MessageSquareText",instruction:"Review this design doc critically, as a senior engineer would before approving it. Leave one review comment per issue with design_doc_comment (anchor it with path and an exact quote) covering gaps, risks, ambiguities, contradictions and missing alternatives. Do not rewrite the doc yourself. Finish with a short summary of the most important issues."},{id:"address",label:"Address comments",description:"Apply the open review feedback",icon:"CheckCheck",instruction:"Address every open review comment on this design doc: make the edits each one asks for (or explain why not), then resolve each comment with design_doc_comment resolve=<id> and a one-line body describing what changed."},{id:"complete",label:"Fill the gaps",description:"Complete empty or placeholder sections",icon:"WandSparkles",instruction:"Complete the sections of this design doc that are empty, placeholders (\u2026) or thin. Keep the author's intent and voice, ground statements in this project's code where relevant, and mark assumptions explicitly as **Assumption:**."},{id:"diagram",label:"Add diagrams",description:"Mermaid architecture, flow and sequence diagrams",icon:"Workflow",instruction:"Add mermaid diagrams that make this design easier to understand: architecture/components, the main data flow, and the key sequence(s). Put each larger diagram in diagrams/<name>.mmd and embed small ones inline as ```mermaid blocks where they help the narrative. Make sure every diagram parses."},{id:"ground",label:"Check against code",description:"Verify claims against this project's code",icon:"ScanSearch",instruction:"Check this design doc against the project's actual codebase. Correct inaccurate statements, name the real files, modules and APIs involved, and leave a comment wherever the design conflicts with how the code works today."},{id:"plan",label:"Implementation plan",description:"Milestones, tasks, risks and tests",icon:"ListChecks",instruction:"Turn this design into an implementation plan. Add a plan.md file with milestones, ordered tasks (each small enough for one pull request), dependencies, risks and a test strategy, grounded in this project's code. Link plan.md from the README."}];function $n(t){return Dr.find(n=>n.id===t)??null}var ce=4e3;function Ln(t){let n=t.path?` Focus on ${t.path}.`:"",e=[t.action?.instruction,t.prompt?.trim()].filter(Boolean).join(`

`);return[`You are working on the design doc "${t.doc.title}" (id ${t.doc.id}) in the Design Docs plugin.${n}`,e,`Start with design_doc_read doc="${t.doc.id}" to see its files and open comments. Make changes in the doc itself with design_doc_write (prefer small edits with baseRevision) and design_doc_comment, rather than pasting long content into chat. The user is watching the doc update live. When you finish, summarise what you changed and end with ::design-doc{id="${t.doc.id}"} on its own line.`].filter(Boolean).join(`

`)}var P={kind:"user",label:"You",threadId:null};function ot(t,n){let e=t[n];if(e!=null){if(typeof e!="number"||!Number.isInteger(e))throw new l("invalid",`${n} must be an integer`);return e}}function kn(t,n){let e=t[n];if(e!==void 0){if(!Array.isArray(e)||e.some(i=>typeof i!="string"))throw new l("invalid",`${n} must be an array of strings`);return e}}function Ar(t,n="Design doc from chat"){let e=t.split(`
`).map(r=>r.trim()).filter(Boolean),s=(e.find(r=>/^#{1,3}\s+\S/.test(r))??e[0]??"").replace(/^#+\s*|^[-*>]\s+/,"").replace(/[*_`[\]]/g,"").trim();return s?s.length>80?`${s.slice(0,79).trimEnd()}\u2026`:s:n}function xr(t){let{store:n,changed:e}=t,i=async s=>{if(!s)return;if(!(await t.sdk.projects.list()).some(o=>o.id===s))throw new l("invalid",`unknown project ${s}`)};return{templates:()=>k.map(({id:s,label:r,description:o,files:a})=>({id:s,label:r,description:o,files:a.map(d=>d.path)})),projects:async()=>(await t.sdk.projects.list()).map(({id:s,name:r})=>({id:s,name:r})),list:s=>{let r=w(s),o=h(r,"status")??"all";if(o!=="all"&&o!=="active"&&!x(o))throw new l("invalid","unknown status filter");let a=r.projectId;return n.list({projectId:typeof a=="string"&&a?a:void 0,query:h(r,"query"),status:o,limit:ot(r,"limit")??200})},get:s=>n.get(m(w(s),"doc")),create:async s=>{let r=w(s),o=h(r,"projectId"),a=h(r,"status");if(a!==void 0&&!x(a))throw new l("invalid","unknown status");await i(o);let d=n.create({title:m(r,"title"),summary:h(r,"summary"),template:h(r,"template"),tags:kn(r,"tags"),status:a,projectId:o||null},P);return e(d.id),d},update:async s=>{let r=w(s),o=h(r,"status");if(o!==void 0&&!x(o))throw new l("invalid","unknown status");let a=r.projectId;if(a!=null&&typeof a!="string")throw new l("invalid","projectId must be a string or null");await i(a);let d=n.update(m(r,"doc"),{title:h(r,"title"),summary:h(r,"summary"),status:o,tags:kn(r,"tags"),entryPath:h(r,"entryPath"),projectId:a===void 0?void 0:a||null},P);return e(d.id),d},remove:s=>{let r=n.summary(m(w(s),"doc"));return n.remove(r.id),e(r.id),{ok:!0}},renderPage:s=>{let r=w(s),o=r.draft;if(o!==void 0&&typeof o!="string")throw new l("invalid","draft must be a string");return rt(n,t.kit??q,{doc:m(r,"doc"),path:h(r,"path"),draft:o})},readPageFile:s=>{let r=w(s),o=n.summary(m(r,"doc")),a=m(r,"path"),d;try{d=L(a)}catch{return null}let c=At(n,o.id,t.kit??q)(d);return c?{kind:c.kind,encoding:c.encoding,content:c.content}:null},pageLink:s=>{let r=w(s),o=n.summary(m(r,"doc"));if(!t.pageUrl)throw new l("invalid","standalone pages are not served here");let a;try{a=L(h(r,"path")??o.entryPath)}catch(d){throw new l("invalid",d.message)}return{url:t.pageUrl(o.id,a)}},reportRender:s=>{let r=w(s),o=n.summary(m(r,"doc"));return t.reports?.record(o.id,Sn(r)),{ok:!0}},readFile:s=>{let r=w(s);return n.readFile(m(r,"doc"),m(r,"path"))},writeFile:s=>{let r=w(s),o=r.content;if(typeof o!="string")throw new l("invalid","content must be a string");let a=n.writeFile(m(r,"doc"),{path:m(r,"path"),content:o,encoding:r.encoding==="base64"?"base64":void 0,baseRevision:ot(r,"baseRevision"),note:h(r,"note")},P);return e(a.docId),a},editFile:s=>{let r=w(s);if(!Array.isArray(r.edits))throw new l("invalid","edits must be an array");let o=n.editFile(m(r,"doc"),{path:m(r,"path"),edits:r.edits,baseRevision:ot(r,"baseRevision"),note:h(r,"note")},P);return e(o.docId),o},deleteFile:s=>{let r=w(s),o=n.summary(m(r,"doc"));return n.deleteFile(o.id,m(r,"path"),P,{baseRevision:ot(r,"baseRevision")}),e(o.id),{ok:!0}},renameFile:s=>{let r=w(s),o=n.renameFile(m(r,"doc"),m(r,"from"),m(r,"to"),P);return e(o.docId),o},history:s=>{let r=w(s);return n.history(m(r,"doc"),{path:h(r,"path"),limit:ot(r,"limit")})},revision:s=>{let r=w(s);return n.revisionContent(m(r,"doc"),r.id)},restore:s=>{let r=w(s),o=n.restoreRevision(m(r,"doc"),r.id,P,{baseRevision:ot(r,"baseRevision")});return e(o.docId),o},addComment:s=>{let r=w(s),o=n.addComment(m(r,"doc"),{body:m(r,"body"),path:h(r,"path"),quote:h(r,"quote")},P);return e(o.docId),o},replyToComment:s=>{let r=w(s),o=n.addReply(m(r,"doc"),r.id,m(r,"body"),P);return e(o.docId),o},setCommentStatus:s=>{let r=w(s),o=m(r,"status"),a=n.setCommentStatus(m(r,"doc"),r.id,o,P);return e(a.docId),a},deleteComment:s=>{let r=w(s),o=n.summary(m(r,"doc"));return n.deleteComment(o.id,r.id,P),e(o.id),{ok:!0}},unlinkThread:s=>{let r=w(s),o=n.summary(m(r,"doc"));return n.unlinkThread(o.id,m(r,"threadId")),e(o.id),{ok:!0}},createFromMessage:async s=>{let r=w(s),o=m(r,"threadId"),a=m(r,"text"),d=await t.sdk.threads.get({threadId:o});if(!d)throw new Error(`Thread ${o} was not found.`);let c=n.create({title:h(r,"title")?.trim()||Ar(a),projectId:d.projectId??null,files:[{path:"README.md",content:a}]},P);return n.linkThread(c.id,o,d.title?.trim()||"Agent thread","assistant"),e(c.id),n.summary(c.id)},askAgent:async s=>{let r=w(s),o=n.summary(m(r,"doc")),a=h(r,"action"),d=a?$n(a):null;if(a&&!d)throw new l("invalid",`unknown agent action ${a}`);let c=h(r,"prompt")?.trim()??"";if(!d&&!c)throw new l("invalid","pick an action or write a request");if(c.length>ce)throw new l("invalid",`request must be at most ${ce} characters`);let u=o.projectId??(h(r,"projectId")||null);if(!u)throw new l("invalid","this doc is global; choose a project for the agent to run in");o.projectId||await i(u);let p=`${d?d.label:"Design doc"} \xB7 ${o.title}`.slice(0,120),y=h(r,"providerId"),v=await t.sdk.threads.spawn({projectId:u,prompt:Ln({doc:o,action:d,prompt:c,path:h(r,"path")}),title:p,...y?{providerId:y}:{},visibility:"visible",pluginMetadata:{designDocId:o.id,...d?{action:d.id}:{}}});return n.linkThread(o.id,v.id,p,d?.id==="review"?"reviewer":"assistant"),e(o.id),{threadId:v.id,projectId:u}}}}function Cn(t,n){for(let[e,i]of Object.entries(xr(n)))t.rpc.method(e,i)}function Nn(t,n={}){let e=n.ttlMs??3e4,i=n.now??Date.now,s=new Map,r=Number.NEGATIVE_INFINITY,o=null;return{name:a=>a?s.get(a)??null:null,refresh(){return o||(i()-r<e?Promise.resolve():(o=t().then(a=>{s=new Map(a.filter(d=>d.name).map(d=>[d.id,d.name]))},()=>{}).finally(()=>{r=i(),o=null}),o))}}}var Ot={type:"string",description:"Design doc id (dd_\u2026) or slug, as shown by design_doc_list or the instructions catalog."},On=k.map(t=>t.id);function Mn(t,n=200){let e=new Map;return async i=>{let s=e.get(i);if(s)return{kind:"agent",label:s,threadId:i};let r;try{r=await t(i)}catch{return{kind:"agent",label:_t,threadId:i}}if(!r)return{kind:"agent",label:Dt,threadId:null};let o=(r.title||r.titleFallback||"").trim();return o?(e.size>=n&&e.delete(e.keys().next().value),e.set(i,o),{kind:"agent",label:o,threadId:i}):{kind:"agent",label:_t,threadId:i}}}function jn(t,n){let e=async i=>(await n.projects?.refresh(),{store:n.store,changed:n.changed,projectId:i.projectId||null,projectName:s=>n.projects?.name(s)??null,kit:n.kit,reports:n.reports});t.agents.registerTool({name:"design_doc_list",description:"List design documents (specs, RFCs, ADRs, product docs) that the user keeps in the Design Docs plugin. Defaults to active docs of the current project plus global docs. Use query to search titles, summaries, tags and file contents.",parameters:{type:"object",properties:{query:{type:"string",description:"Free-text search."},status:{type:"string",enum:["active","all",...H],description:"active (default) hides archived docs."},scope:{type:"string",enum:["project","all"],description:"project (default) or every project."},limit:{type:"integer",minimum:1,maximum:200}},additionalProperties:!1},presentation:{label:{pending:"Listing design docs",completed:"Listed design docs"},icon:{glyph:"Search"}},execute:async(i,s)=>xt(await e(s),i)}),t.agents.registerTool({name:"design_doc_read",description:"Read a design doc. A design doc is a small project of files (markdown, mermaid .mmd diagrams, HTML mockups, code, images). Without path: returns the manifest (files with revisions, open review comments) and the entry file. With path: returns that file and its revision. includeAll=true returns every text file at once. For an HTML page it also says which files the page uses that the doc lacks, what previews block, and, from the last time the panel ran it, script errors and comments whose quote the page no longer shows. Always read before editing, and treat open comments as review feedback to address.",parameters:{type:"object",properties:{doc:Ot,path:{type:"string",description:"File path inside the doc, e.g. README.md or diagrams/flow.mmd."},includeAll:{type:"boolean",description:"Return all text files (bounded) instead of just the entry file."}},required:["doc"],additionalProperties:!1},presentation:{label:{pending:"Reading design doc",completed:"Read design doc"},icon:{glyph:"FileText"}},execute:async(i,s)=>It(await e(s),i)}),t.agents.registerTool({name:"design_doc_create",description:`Create a new design doc the user can review in the Design Docs panel. Pass files to write your own content, or a template to start from (${On.join(", ")}). The doc belongs to the current project unless global=true. Write rich GitHub-flavoured markdown: headings, tables, task lists, \`\`\`mermaid diagrams and $math$ all render. Put larger diagrams in .mmd files and UI mockups in self-contained .html files (inline CSS and JS; nothing loads from a CDN). For a web page or site that will publish to GitHub Pages, start from the report or html-design template, or link zcc-kit/site.css and zcc-kit/site.js (see the design-docs skill).`,parameters:{type:"object",properties:{title:{type:"string",description:'Human title, e.g. "Offline sync for mobile".'},summary:{type:"string",description:"One or two sentences shown in lists."},template:{type:"string",enum:On,description:"Starter files when files is omitted."},tags:{type:"array",items:{type:"string"}},status:{type:"string",enum:[...H]},global:{type:"boolean",description:"Make the doc visible to every project."},files:{type:"array",description:"Initial files. Include a README.md (a written doc) or an index.html (a site) as the entry point.",items:{type:"object",properties:{path:{type:"string"},content:{type:"string"},encoding:{type:"string",enum:["utf8","base64"],description:"base64 only for images and fonts."}},required:["path","content"],additionalProperties:!1}},entryPath:{type:"string",description:"File shown first when the doc opens; defaults to README.md, else index.html."}},required:["title"],additionalProperties:!1},presentation:{label:{pending:"Creating design doc",completed:"Created design doc"},icon:{glyph:"File"}},execute:async(i,s)=>Pt(await e(s),i,await n.actorFor(s.threadId))}),t.agents.registerTool({name:"design_doc_write",description:"Change one file in a design doc. Pass exactly one of: edits (exact-match find/replace, preferred for changes), content (whole file; creates the file if it does not exist), delete=true, or renameTo. Pass baseRevision (the revision you last read) so you never overwrite a concurrent edit by the user; on a conflict, re-read the file and reapply. Every write is kept in history and appears live in the panel. Writing an HTML page returns a page check: missing files and blocked resources to fix.",parameters:{type:"object",properties:{doc:Ot,path:{type:"string",description:"File path inside the doc. New folders are created implicitly."},edits:{type:"array",description:"Applied in order. oldText must match exactly once unless replaceAll is set.",items:{type:"object",properties:{oldText:{type:"string"},newText:{type:"string"},replaceAll:{type:"boolean"}},required:["oldText","newText"],additionalProperties:!1}},content:{type:"string",description:"Full new file content."},encoding:{type:"string",enum:["utf8","base64"],description:"base64 only for images and fonts."},delete:{type:"boolean"},renameTo:{type:"string"},baseRevision:{type:"integer",minimum:0,description:"Revision you read; 0 asserts the file is new."},note:{type:"string",description:"Short change note shown in history."}},required:["doc","path"],additionalProperties:!1},presentation:{label:{pending:"Editing design doc",completed:"Edited design doc"},icon:{glyph:"EditFile"}},execute:async(i,s)=>J(await e(s),i,await n.actorFor(s.threadId))}),t.agents.registerTool({name:"design_doc_update",description:"Update design doc metadata: title, summary, status (draft \u2192 review \u2192 approved \u2192 implemented, or archived), tags, or the entry file.",parameters:{type:"object",properties:{doc:Ot,title:{type:"string"},summary:{type:"string"},status:{type:"string",enum:[...H]},tags:{type:"array",items:{type:"string"},description:"Replaces the tag list."},entryPath:{type:"string",description:"File shown first when the doc opens."}},required:["doc"],additionalProperties:!1},presentation:{label:{pending:"Updating design doc",completed:"Updated design doc"},icon:{glyph:"EditFile"}},execute:async(i,s)=>St(await e(s),i,await n.actorFor(s.threadId))}),t.agents.registerTool({name:"design_doc_comment",description:"Leave a review comment on a design doc (optionally anchored to a file and an exact quoted passage), reply in an existing comment's thread (replyTo), or resolve / reopen one by id. Pass at most one of replyTo, resolve or reopen. Once your edits address a comment, resolve it with body saying what changed.",parameters:{type:"object",properties:{doc:Ot,body:{type:"string",description:"Comment text (markdown). Required for a new comment or replyTo; with resolve or reopen, posted as a reply."},path:{type:"string",description:"File a new comment is about."},quote:{type:"string",description:"Exact passage of that file a new comment refers to; the panel highlights it. For an HTML page, quote the text as the page shows it, not its markup."},replyTo:{type:"string",description:"Comment id to reply to (keeps its status)."},resolve:{type:"string",description:"Comment id to mark resolved."},reopen:{type:"string",description:"Comment id to reopen."}},required:["doc"],additionalProperties:!1},presentation:{label:{pending:"Commenting on design doc",completed:"Commented on design doc"},icon:{glyph:"ListTodo"}},execute:async(i,s)=>st(await e(s),i,await n.actorFor(s.threadId))})}var Hn=Ir(Pr(import.meta.url));function Sr(t){let n=new Rt(t.storage.database()),e=en(Fn(Hn,"kit")),i=an(t.pluginId),s=u=>t.realtime.publish(ue,{docId:u}),r=Mn(u=>t.sdk.threads.get({threadId:u})),o=Nn(()=>t.sdk.projects.list()),a=new Nt;jn(t,{store:n,changed:s,actorFor:r,projects:o,kit:e,reports:a}),Pn(t,n,u=>t.log.warn(u),o);let d=(u,p)=>dn(cn(),i,u,p);Tn(t,{store:n,changed:s,projects:o,caller:Rn(t.sdk,r),readLocalFile:_n(t.sdk),writeLocalFile:Dn(t.sdk),pageUrl:d,kit:e,reports:a}),Cn(t,{store:n,changed:s,sdk:t.sdk,kit:e,pageUrl:d,reports:a});let c=on({store:n,kit:e,endpoint:i,runtime:ln(Fn(Hn,"page-runtime.js"),u=>t.log.warn(u))});t.http.route("GET","/page",c.page),t.http.route("GET","/file",c.file),t.events.on("thread.idle",u=>{for(let p of n.touchThread(u.threadId,u.thread?.title??null))s(p)}),t.events.on("thread.deleted",async u=>{let p=await t.sdk.threads.get({threadId:u.threadId}).catch(()=>null);if(!(p&&!p.deletedAt))for(let y of n.forgetThread(u.threadId))s(y)}),t.log.info("design docs ready")}export{Sr as default};
