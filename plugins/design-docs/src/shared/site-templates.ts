/**
 * Starter pages for docs that become a site: they load the site kit from
 * `zcc-kit/`, which the panel serves and an export copies in.
 */

const HEAD = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{title}}</title>
<link rel="stylesheet" href="zcc-kit/site.css">
<script src="zcc-kit/site.js"></script>
</head>`;

export const REPORT_INDEX = `${HEAD}
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
`;

export const REPORT_WEEKLY_CSV = `week,Option A,Option B
W1,0.52,0.47
W2,0.55,0.49
W3,0.58,0.50
W4,0.61,0.54
W5,0.63,0.55
W6,0.66,0.58
W7,0.65,0.60
W8,0.69,0.61
`;

export const HTML_DESIGN_INDEX = `${HEAD}
<body>
<header class="site-header">
  <a class="brand" href="#context"><span class="brand-mark" aria-hidden="true">D</span><span class="brand-text"><strong>{{title}}</strong><span>Design doc</span></span></a>
  <nav><a href="#context">Context</a><a href="#goals">Goals</a><a href="#proposal">Proposal</a><a href="#alternatives">Alternatives</a><a href="#risks">Risks</a><a href="#rollout">Rollout</a><a href="#questions">Questions</a></nav>
  <div class="actions"><button class="button" data-kit-theme>Theme</button></div>
</header>
<main class="narrow">
  <section id="context">
    <p class="eyebrow">Design doc · <span class="pill">Draft</span></p>
    <h1>{{title}}</h1>
    <p class="lede">{{summary}}</p>
    <dl>
      <dt>Author</dt><dd>…</dd>
      <dt>Reviewers</dt><dd>…</dd>
      <dt>Updated</dt><dd>…</dd>
    </dl>
    <h2>Context</h2>
    <p>What problem are we solving, for whom, and why now? Link the evidence (incidents, metrics, user feedback) that motivates the change.</p>
    <div class="callout warning"><p><strong>Assumption:</strong> state what this design takes for granted, so reviewers can challenge it.</p></div>
  </section>

  <section id="goals">
    <h2>Goals and non-goals</h2>
    <div class="grid cols-2">
      <div class="card"><h3>Goals</h3><ul><li>…</li><li>…</li></ul></div>
      <div class="card"><h3>Non-goals</h3><ul><li>…</li><li>…</li></ul></div>
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
→ 201 { "id": "it_123" }</code></pre>
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
          <tr><td>Proposed</td><td>…</td><td>…</td><td><span class="status good">Chosen</span></td></tr>
          <tr><td>Alternative A</td><td>…</td><td>…</td><td><span class="status">Rejected</span></td></tr>
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
          <tr><td>…</td><td><span class="status critical">High</span></td><td>…</td></tr>
          <tr><td>…</td><td><span class="status warning">Medium</span></td><td>…</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <section id="rollout">
    <h2>Rollout</h2>
    <ol>
      <li><strong>Behind a flag.</strong> Internal users only; watch the error rate.</li>
      <li><strong>Gradual.</strong> 10% → 50% → 100%, with a rollback plan at each step.</li>
      <li><strong>Clean up.</strong> Remove the flag and the old path.</li>
    </ol>
    <p>How we know it worked:</p>
    <div class="meter" style="--value: 0%"><span>0%</span></div>
  </section>

  <section id="questions">
    <h2>Open questions</h2>
    <ol><li>…</li><li>…</li></ol>
  </section>
</main>
<footer class="site-footer"><p>Made with Design Docs.</p></footer>
</body>
</html>
`;
