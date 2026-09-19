(() => {
  const $ = id => document.getElementById(id);
  const T = DemoTimeline;
  const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const glyphs = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10H3Z"/>',
    pen: '<path d="M12 4H5a2 2 0 0 0-2 2v13h16v-7M17 3l4 4-10 10-5 1 1-5Z"/>',
    inbox: '<path d="M3 12 6 4h12l3 8v8H3Z M3 12h5l2 4h4l2-4h5"/>',
    bot: '<rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 7V3h-3M1 13h3m16 0h3M8 13h1m6 0h1M9 17h6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 3"/>',
    plugin: '<path d="M8 3h8v5a3 3 0 1 1 5 4h-5v8h-5a3 3 0 1 0-4-5H3V8h5Z"/>',
    docs: '<path d="M4 3h12l4 4v14H4ZM15 3v5h5M8 12h8m-8 4h6"/>',
    gus: '<rect x="6" y="6" width="12" height="14" rx="5"/><path d="M9 6 7 3m8 3 2-3M3 10h3m12 0h3M3 15h3m12 0h3M12 7v12"/>',
    check: '<path d="m5 12 4 4L20 5"/>',
    chevron: '<path d="m8 10 4 4 4-4"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
    settings: '<circle cx="12" cy="12" r="4"/><path d="m12 2 2 3 4-1 1 4 3 2-2 4 1 4-4 1-3 3-3-2-4 1-1-4-3-2 2-4-1-4 4-1Z"/>',
    send: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
    monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
    branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M6 7v10m0-4c8 0 12-1 12-6"/>',
    bolt: '<path d="m13 2-9 12h7l-1 8L21 9h-8Z"/>',
    moon: '<path d="M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12Z"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    star: '<path d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z"/>',
    link: '<path d="M14 3h7v7m0-7L10 14M11 5H4v16h16v-7"/>',
    refresh: '<path d="M20 8a8 8 0 1 0 1 7M20 3v5h-5"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  };
  const icon = (name, small = false) => `<svg class="icon${small ? ' small' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyphs[name] || glyphs.grid}</svg>`;
  const btn = (text, options = '') => `<button class="btn ${options.includes('primary') ? 'primary' : ''}" ${options.replace('primary', '')}>${text}</button>`;
  const badge = value => `<span class="status ${value.toLowerCase().replaceAll(' ', '-')}">${esc(value)}</span>`;
  const providerMark = () => '<span class="provider-mark">◎</span>';
  const initialTasks = () => [
    { title: 'Review the dashboard changes', detail: 'Atlas dashboard · Project', checked: false },
    { title: 'Check my sprint tickets', detail: 'GUS · Current sprint', checked: false },
    { title: 'Plan tomorrow’s priorities', detail: 'A little space to think', checked: false },
  ];
  let manualTasks = initialTasks(), exploring = false, running = false, sound = false, current = 0, lastWall = 0, lastContentKey = '', lastSideKey = '', lastOverlayKey = '';
  const audio = $('narration');

  function sidebar(s) {
    const pluginsNav = s.view === 'plugins';
    if (pluginsNav) return `<button class="nav-item" data-time="79">‹ &nbsp; Back to app</button><div class="projects-head">Plugins</div><div class="nav-item">${icon('grid')}Browse plugins</div><div class="nav-item selected">${icon('folder')}Installed plugins</div><div class="nav-item">${icon('plugin')}Plugin Guide</div><div class="projects-head">Skills</div><div class="nav-item">${icon('bolt')}Skills</div><div class="projects-head">MCP</div><div class="nav-item">${icon('plugin')}MCP</div><div class="sidebar-bottom">${icon('settings',true)}Settings</div>`;
    const activeAgents=(s.sent&&s.status!=='Idle'?1:0)+(s.cliLaunched&&!s.cliIdle?1:0);
    const active = s.view === 'gus' ? 'GUS' : s.view === 'focus' ? 'Focus Board' : s.view === 'board' || s.view === 'cli-terminal' || s.sent && s.view === 'thread' || s.view === 'preview' ? 'Agents' : s.view.includes('plugin') ? 'Plugins' : 'New Chat';
    const nav = [['New Chat','pen',23],['Inbox','inbox',79],['Agents','bot',46],['Scheduler','clock',46],['Plugins','plugin',119],['Docs','docs',73],['GUS','gus',85],['PR Monitor','branch',79],['Tasks','check',79]];
    // Match the real sidebar order. The keyboard/cursor path uses element targets.
    const items = nav.map(([label,glyph,at]) => `<button class="nav-item ${active === label ? 'selected' : ''}" data-time="${at}" data-cue="nav-${glyph}">${icon(glyph)}${label}${label === 'Inbox' ? '<span class="nav-badge blue">2</span>' : label === 'Agents' && activeAgents ? `<span class="nav-badge">${activeAgents}</span>` : ''}</button>`).join('');
    return `${items}${s.installed ? `<button class="nav-item ${active === 'Focus Board' ? 'selected' : ''}" data-time="161" data-cue="nav-focus">${icon('grid')}Focus Board</button>` : ''}<div class="projects-head"><span>Projects ${icon('chevron',true)}</span><button aria-label="Add project" data-time="8.5" data-cue="add-project">${icon('plus',true)}</button></div><div class="project-search">${icon('search',true)}Filter projects…</div><div class="project-row default-project">${icon('folder',true)}Default Project</div>${s.projectCreated ? `<div class="project-row"><span class="dot"></span>atlas-dashboard<span class="chev">⌄</span></div>${s.sent ? `<button class="subthread" data-time="53">${icon('bot',true)}<span><strong>Build the task dashboard</strong><span class="${s.status}">${s.status}</span> · Thread</span></button>` : ''}` : ''}${s.cliLaunched ? `<button class="subthread" data-at="65">${icon('terminal',true)}<span><strong>Review dashboard changes</strong><span class="${s.cliIdle ? 'Idle' : 'Working'}">${s.cliIdle ? 'Idle' : 'Working'}</span> · CLI Agent</span></button>` : ''}<div class="project-row"><span class="dot blue"></span>team-notes<span class="chev">⌄</span></div><div class="subthread">${icon('bot',true)}<span><strong>Review the release notes</strong><span class="Idle">Idle</span> · Thread</span></div>${s.view.startsWith('plugin') || s.installed ? `<div class="projects-head">Extensions</div><div class="project-row"><span class="dot blue"></span>Ext: Focus Board</div>` : ''}<div class="sidebar-bottom"><span>${icon('settings',true)} &nbsp;Settings</span><span class="avatar">JD</span></div>`;
  }

  function toolbar(title, actions = '') { return `<div class="toolbar"><div class="toolbar-title">${title}</div><div class="toolbar-actions">${actions}</div></div>`; }
  const launchTabs = cli => `<div class="launch-segmented" role="group" aria-label="Launch mode"><button class="${cli ? 'active' : ''}" data-at="52.8" data-cue="cli-mode" aria-pressed="${cli}">CLI Agent</button><button class="${cli ? '' : 'active'}" data-time="28" aria-pressed="${!cli}">Modern<small>NEW</small></button></div>`;
  function home(s) { return compose(s, 'home'); }
  function compose(s, kind = 'project') {
    const plugin=kind==='plugin',ticket=kind==='ticket',home=kind==='home',cli=kind==='cli';
    const draft=plugin?s.pluginPrompt:ticket?s.ticketPrompt:cli?s.cliPrompt:home?'':s.prompt;
    const selectedCli=cli&&s.cliSelected;
    const project=plugin?'Ext: Focus Board':s.projectCreated?'atlas-dashboard':'Default Project';
    return `<div class="compose"><div class="compose-inner">${launchTabs(selectedCli)}<div class="composer"><div class="draft ${draft?'':'placeholder'}" data-cue="draft"><span class="${draft&&!ticket?'caret':''}">${esc(draft||(selectedCli?'Describe the task… Leave empty to open an interactive session':'Ask anything, @ to mention files, / for commands'))}</span></div><div class="composer-bottom"><div class="composer-config"><span>${icon('bolt',true)} Agent ${icon('chevron',true)}</span><button class="provider" ${cli?'data-at="54"':'data-time="25"'} data-cue="provider">${providerMark()}${plugin||ticket||cli?'Codex':s.provider} ${icon('chevron',true)}</button><span>${!plugin&&!ticket&&!cli&&s.provider==='Claude Code'?'Sonnet 4.6':'gpt-5.5'} ${icon('chevron',true)}</span><span>High ${icon('chevron',true)}</span></div><button class="send-btn" aria-label="${cli?'Launch CLI agent':'Send prompt'}" ${cli?'data-at="59"':`data-time="${plugin?137:ticket?113:home?23:36}"`} data-cue="${cli?'cli-launch':'send'}">${icon('send')}</button></div></div><div class="context-row"><span>${icon('folder',true)} ${project} ${icon('chevron',true)}</span><span>${icon('branch',true)} Personal ${icon('chevron',true)}</span><span>${icon('monitor',true)} Local ${icon('chevron',true)}</span><span class="context-right">Edits ${icon('chevron',true)}</span></div>${plugin?'<p class="compose-caption">Plugin creator · Build a panel for your own workflow.</p>':ticket?'<div class="compose-help"><span>GUS W-100042</span><span>Acceptance criteria attached</span></div>':''}${home&&s.projectCreated?`<div class="compose-help"><button class="btn" data-time="23" data-cue="new-agent">${icon('plus',true)} New agent in atlas-dashboard</button></div>`:''}</div></div>`;
  }
  function cliTerminal(s) {
    const passed=s.cliPassed,idle=s.cliIdle;
    const terminal=`<div class="cli-window ${s.cliFullscreen?'fullscreen':''}"><div class="cli-window-header"><span class="cli-status ${idle?'idle':''}">${idle?'Idle':'Working'}</span><span class="cli-report">${icon('docs',true)} Report</span>${icon('star',true)}<div class="cli-window-actions"><button data-at="${s.cliFullscreen?61:62}" data-cue="cli-fullscreen">${icon('monitor',true)} ${s.cliFullscreen?'Exit full screen':'Full screen'}</button><button data-at="70.7" data-cue="cli-close" aria-label="Close terminal window">${icon('close',true)}</button></div></div><div class="cli-title">Review dashboard changes <span>${icon('grid',true)}</span></div><div class="cli-terminal" role="region" aria-label="Codex terminal TUI"><div class="cli-scroll">${s.cliEdit?'':`<div class="tui-banner"><strong>›_ OpenAI Codex</strong><br><span class="tui-dim">model:</span> &nbsp; gpt-5.5 high &nbsp; <span class="tui-dim">/model to change</span><br><span class="tui-dim">directory:</span> ~/Projects/atlas-dashboard</div>`}<div class="tui-prompt">› ${esc(T.cliPrompt)}</div><div class="tui-line">• ${esc(T.typed('I’ll review the diff, check the filter behavior, and run the tests.',s.p,59.2,60.6))}</div>${s.cliRead?`<div class="tui-line"><span class="tui-green">•</span> <b>Ran</b> <span class="tui-blue">git diff --stat</span></div><div class="tui-output">└ src/TaskDashboard.tsx       | 27 +++++++++++++++++++++---
  src/useLocalFilter.ts       | 18 ++++++++++++++++++
  src/TaskDashboard.test.tsx  | 46 +++++++++++++++++++++++++++++++++++++
  3 files changed, 88 insertions(+), 3 deletions(-)</div>`:''}${s.cliEdit?`<div class="tui-line"><span class="tui-green">•</span> <b>Explored</b> <span class="tui-cyan">src/TaskDashboard.tsx</span></div><div class="tui-diff">+ const [status, setStatus] = useLocalFilter('all');
+ const visibleTasks = tasks.filter(
+   task => status === 'all' || task.status === status
+ );</div>`:''}${s.cliTests?`<div class="tui-line"><span class="tui-green">•</span> <b>Ran</b> <span class="tui-blue">npm test -- TaskDashboard</span></div><div class="tui-output">└ <span class="tui-dim">RUN  v3.2.0 ~/Projects/atlas-dashboard</span>
${s.p>=65.5?`  <span class="tui-green">✓</span> renders filters and the completion summary
`:''}${s.p>=66.3?`  <span class="tui-green">✓</span> restores the saved selection
`:''}${passed?`  <span class="tui-green">✓ src/TaskDashboard.test.tsx (12 tests) 186ms</span>

  Test Files  <span class="tui-green">1 passed (1)</span>
       Tests  <span class="tui-green">12 passed (12)</span>`:''}</div>`:''}${passed?`<hr class="tui-rule"><div class="tui-line">• ${esc(T.typed('The changes look good. All 12 tests pass. Before merging, check the empty state and keyboard navigation in the preview.',s.p,67.4,70.1))}</div>`:''}</div><div class="tui-statusline">${idle?'─ Worked for 11s ───────────────────────────────────────────────────':`${['⠋','⠙','⠹','⠸'][s.cliStage%4]} Working (${Math.floor(s.p-59)}s • esc to interrupt)`}</div><div class="tui-input">› Ask Codex to do anything<span class="tui-cursor" style="opacity:${s.cliStage%10<6?1:0}"></span></div><div class="tui-footer"><span><span class="tui-gold">gpt-5.5 high</span> · <span class="tui-green">~/Projects/atlas-dashboard</span></span><span>94% context left</span></div></div></div>`;
    return s.cliFullscreen?terminal:`<div class="cli-backdrop">${terminal}</div>`;
  }
  function tool(label, detail, done = true, meta = '') { return `<div class="tool-row">${done ? `<span class="checkmark">${icon('check',true)}</span>` : '<span class="tool-progress"></span>'}<span>${label}</span><code>${detail}</code><span class="tool-meta">${meta || (done ? 'Done' : 'Running')}</span></div>`; }
  function followup(working = true) { return `<div class="thread-composer"><div class="placeholder">Ask for a follow-up. @ to mention files, folders or threads</div><div class="composer-bottom"><span>◎ &nbsp; Codex &nbsp;⌄ &nbsp;&nbsp; Agent &nbsp;⌄ &nbsp;&nbsp; Auto</span><span style="display:flex;align-items:center;gap:17px">${working ? '<span class="stop-square"></span>' : ''}<span class="send-btn">${icon('send',true)}</span></span></div></div>`; }
  function secondary(s) {
    return `<aside class="secondary"><div class="secondary-tabs"><span class="${!s.diff ? 'active' : ''}">Info</span><button class="${s.diff ? 'active' : ''}" data-time="60.5" data-cue="diff">Changes <span class="muted">3</span></button></div>${s.diff ? `<div class="diff-file">src/TaskDashboard.tsx <span class="change-stat">+24 −3</span></div><div class="diff-code"><div><span class="line-num">18</span>export function TaskDashboard() {</div><div class="remove"><span class="line-num">19</span>− const visibleTasks = tasks;</div><div class="add"><span class="line-num">19</span>+ const [status, setStatus] =</div><div class="add"><span class="line-num">20</span>+   useLocalFilter('all');</div><div class="add"><span class="line-num">21</span>+ const visibleTasks = tasks.filter(</div><div class="add"><span class="line-num">22</span>+   task => status === 'all' ||</div><div class="add"><span class="line-num">23</span>+     task.status === status</div><div class="add"><span class="line-num">24</span>+ );</div><div><span class="line-num">25</span></div><div><span class="line-num">26</span>  return (</div><div><span class="line-num">27</span>    &lt;Dashboard&gt;</div><div class="add"><span class="line-num">28</span>+     &lt;StatusFilters</div><div class="add"><span class="line-num">29</span>+       value={status}</div><div class="add"><span class="line-num">30</span>+       onChange={setStatus}</div><div class="add"><span class="line-num">31</span>+     /&gt;</div><div class="add"><span class="line-num">32</span>+     &lt;CompletionSummary</div><div class="add"><span class="line-num">33</span>+       tasks={tasks}</div><div class="add"><span class="line-num">34</span>+     /&gt;</div><div><span class="line-num">35</span>      &lt;TaskList tasks={visibleTasks} /&gt;</div></div><div class="diff-file">src/useLocalFilter.ts <span class="change-stat">+18</span></div><div class="diff-file">src/TaskDashboard.test.tsx <span class="change-stat">+46</span></div>` : `<div class="info-body"><div class="kicker">This thread</div><div class="info-label">Project</div><div class="info-value">${icon('folder',true)} &nbsp;atlas-dashboard</div><div class="info-label">Agent</div><div class="info-value">Codex · Modern</div><div class="info-label">Task</div><div class="info-step ${s.inspected ? 'done' : ''}">${icon(s.inspected ? 'check' : 'clock',true)}Understand the existing app</div><div class="info-step ${s.answerSent ? 'done' : ''}">${icon(s.answerSent ? 'check' : 'clock',true)}Build filters and summary</div><div class="info-step ${s.passed ? 'done' : ''}">${icon(s.passed ? 'check' : 'clock',true)}Verify and report</div><div class="info-label">Activity</div><div class="info-value">${s.question ? 'Waiting for your answer' : s.passed ? '12 tests passed' : 'Working in your project'}</div></div>`}</aside>`;
  }
  function thread(s) {
    let body = `<div class="agent-label">${providerMark()}Codex<span>·</span>${s.question ? 'Needs your input' : s.passed ? 'Finished this turn' : 'Working'}</div>`;
    if (s.question) body += `<div class="assistant-text">The dashboard is taking shape. One choice before I finish the filters:</div><div class="question-card"><h3>Where should the selected filter be saved?</h3><button class="answer-option ${s.answerSelected ? 'selected' : ''}" data-time="55" data-cue="answer"><span class="radio"></span>Locally in this browser <span class="muted">· Recommended</span></button><div class="answer-option"><span class="radio"></span>Sync through the account API</div><div class="question-actions">${btn('Continue', 'primary data-time="57.5" data-cue="continue"')}</div></div>`;
    else {
      body += `<p class="assistant-text">${s.answerSent ? 'I’ll keep the filter local and finish the verification.' : s.inspected ? 'The app already has a task list. I’ll add filters and a summary using its existing components.' : T.typed('I’ll inspect the project, build the dashboard, then run the tests.',s.t,36.5,39)}</p>`;
      body += tool('Read', 'README.md · src/TaskList.tsx', s.inspected, s.inspected ? '2 files' : 'Reading');
      if (s.edited) body += tool('Edit', 'TaskDashboard.tsx', s.answerSent, s.answerSent ? '+24 −3' : 'Adding filters…');
      if (s.tests) body += tool('Run', 'npm test -- TaskDashboard', s.passed);
      if (s.tests && !s.passed) body += `<div class="trace"><div class="trace-heading">Test output<span>vitest</span></div><pre>${s.t >= 65 ? '<span class="green">✓</span> renders the completion summary\n<span class="green">✓</span> filters tasks by status\n' : ''}${s.t >= 66 ? '<span class="green">✓</span> restores the saved selection\n' : ''}Running dashboard checks…</pre></div>`;
      if (s.passed) body += `<div class="trace"><div class="trace-heading">Verification<span class="green">Passed</span></div><pre><span class="green">✓</span> TaskDashboard.test.tsx <span class="green">(12 tests)</span>\nTest Files  <span class="green">1 passed</span>     Tests  <span class="green">12 passed</span></pre></div>`;
      if (s.t >= 70) body += `<p class="assistant-text">${esc(s.result)}</p><div class="result-links"><button class="result-link" data-time="73" data-cue="preview">${icon('monitor',true)}Preview dashboard</button><span class="result-link">${icon('check',true)}3 files changed</span></div>`;
    }
    return `${toolbar('Build the task dashboard', `${s.t >= 70 ? btn(`${icon('monitor',true)} Preview`, 'data-time="73" data-cue="preview-toolbar"') : ''}${badge(s.status)} ${icon('grid',true)}`)}<div class="thread-layout"><div class="thread"><div class="user-message">${esc(T.prompt)}</div><div class="assistant-body">${body}</div>${followup(s.status === 'Working')}</div>${secondary(s)}</div>`;
  }
  function board(s) {
    const lanes=[['Needs you','#d58b81','alert'],['Working','#c4a35f','bolt'],['Idle','#acb9c9','moon'],['Done','#7bac89','check']];
    const dashboard=`<button class="agent-card" data-time="${s.status==='Needs you'?53:70}" data-cue="agent-card"><h3>Build the task dashboard</h3><div class="card-footer"><span>Codex · Local</span><span class="card-tag">THREAD</span></div>${s.status==='Needs you'?'<div class="attention-line">Where should the selected filter be saved?</div>':''}</button>`;
    const cli=`<button class="agent-card" data-at="70.3" data-cue="cli-card"><h3>${icon('terminal',true)} Review dashboard changes</h3><div class="card-footer"><span>Codex · Local</span><span class="card-tag">CLI AGENT</span></div></button>`;
    return `${toolbar(`<div class="board-views"><span class="active">${icon('grid',true)} Board</span><span>List</span><span>Flow</span></div>`, `<span class="search">${icon('search',true)} &nbsp; Filter by project or task…</span>${btn(`${icon('plus',true)} New agent`,s.p>=51?'primary data-at="51.8" data-cue="cli-new"':'primary data-time="23"')}`)}<div class="board">${lanes.map(([label,color,glyph])=>{
      const hasThread=s.status===label,hasCli=s.cliLaunched&&(s.cliIdle?label==='Idle':label==='Working');
      return `<div class="lane" style="--lane:${color}"><div class="lane-head">${icon(glyph)}${label.toUpperCase()}<b>${Number(hasThread)+Number(hasCli)+(label==='Idle'?1:0)}</b></div>${hasThread||hasCli?`<div class="agent-card-group"><div class="group-label">ATLAS-DASHBOARD <span>${Number(hasThread)+Number(hasCli)}</span></div>${hasThread?dashboard:''}${hasCli?cli:''}</div>`:''}${label==='Idle'?'<div class="agent-card-group"><div class="group-label">TEAM-NOTES <span>1</span></div><div class="agent-card"><h3>Review the release notes</h3><div class="card-footer"><span>Claude Code · Local</span><span class="card-tag">THREAD</span></div></div></div>':''}</div>`;
    }).join('')}</div>`;
  }
  function preview() {
    return `${toolbar('Build the task dashboard', `${badge('Idle')} ${btn('Back to thread', 'data-time="70"')}`)}<div class="project-output"><div class="output-preview"><div class="preview-url">${icon('monitor',true)} &nbsp; atlas-dashboard / preview</div><div class="dashboard"><div class="kicker">Atlas</div><h2>Your team’s work, at a glance.</h2><p class="lead">A clear view of what’s next and what’s already done.</p><div class="summary-cards"><div class="summary-card"><strong>12</strong>Total tasks</div><div class="summary-card"><strong>4</strong>In progress</div><div class="summary-card"><strong>67%</strong>Completed</div></div><div class="filter-row"><span class="active">All tasks</span><span>To do</span><span>In progress</span><span>Complete</span></div><table class="task-table"><thead><tr><th>TASK</th><th>OWNER</th><th>STATUS</th></tr></thead><tbody><tr><td>Review dashboard layout</td><td>Jamie</td><td><span class="pill green">Complete</span></td></tr><tr><td>Add keyboard shortcuts</td><td>Alex</td><td><span class="pill">In progress</span></td></tr><tr><td>Update onboarding copy</td><td>Sam</td><td><span class="pill green">Complete</span></td></tr></tbody></table></div></div><div class="review-panel"><h3>Ready for your review</h3><div class="check-item"><span class="checkmark">${icon('check',true)}</span>Status filters</div><div class="check-item"><span class="checkmark">${icon('check',true)}</span>Completion summary</div><div class="check-item"><span class="checkmark">${icon('check',true)}</span>Saved filter preference</div><div class="check-item"><span class="checkmark">${icon('check',true)}</span>12 tests passed</div><div class="review-label">Changed files</div>TaskDashboard.tsx<br>useLocalFilter.ts<br>TaskDashboard.test.tsx<div class="review-label">Your next step</div>Review the changes and decide what comes next.</div></div>`;
  }
  function gus(s) {
    const tickets = [
      ['NEW','W-100042','Add task filters','3 pts · Jamie Demo'],
      ['IN PROGRESS','W-100043','Improve keyboard navigation','2 pts · Jamie Demo'],
      ['READY FOR REVIEW','W-100044','Review dashboard layout','5 pts · Jamie Demo'],
      ['FIXED',null,null,null],
    ];
    return `${toolbar('GUS <small>jamie@example.com</small>', `<div class="view-tabs"><span class="active">My work</span><span>Backlog</span></div><small>${s.me ? '3' : '6'} items</small>${icon('refresh')}`)}<div class="gus-layout"><aside class="gus-sprints"><div class="gus-filter">Filter work…</div><div class="gus-label">WATCHING</div><div class="sprint-item" style="font-size:12px;padding-top:0">${s.watching ? '☆ W-100042 · Add task filters' : 'Follow a sprint, team, or ticket'}</div><div class="gus-label">SPRINT</div><div class="sprint-item ${!s.sprint ? 'selected' : ''}">All sprints</div><button class="sprint-item ${s.sprint ? 'selected' : ''}" data-time="92" data-cue="sprint">Current sprint<small>14 Sep — 27 Sep 2026</small></button><div class="gus-filter">Atlas team</div><div class="sprint-item" style="margin-top:21px">September sprint<small>14 Sep — 27 Sep 2026</small></div><div class="sprint-item">Previous sprint<small>31 Aug — 13 Sep 2026</small></div></aside><div class="gus-main"><div class="assignees"><span class="assignee ${!s.me ? 'active' : ''}">Everyone</span><button class="assignee ${s.me ? 'active' : ''}" data-time="89" data-cue="me">Me 3</button><span class="assignee">Alex 2</span><span class="assignee">Sam 1</span></div><div class="gus-board">${tickets.map(([label,id,title,meta],i) => `<div class="gus-lane"><div class="gus-lane-header">${label}<span>${id ? (!s.me && i < 3 ? '2' : '1') : '0'}</span></div>${id ? `<button class="ticket-card" data-time="94" ${i === 0 ? 'data-cue="ticket"' : ''}><span class="ticket-id">${id}</span><h3>${title}</h3><span class="sprint-tag">September sprint</span><p>${meta}</p></button>${!s.me && i < 3 ? `<div class="ticket-card"><span class="ticket-id">W-1000${51+i}</span><h3>${['Refresh empty states','Polish the settings page','Update release notes'][i]}</h3><span class="sprint-tag">${s.sprint ? 'September sprint' : 'Previous sprint'}</span><p>2 pts · ${i === 2 ? 'Sam' : 'Alex'}</p></div>` : ''}` : '<div class="lane-empty">Nothing here</div>'}</div>`).join('')}</div></div></div>`;
  }
  function ticketThread(s) {
    return `${toolbar('Add task filters · W-100042', badge('Working'))}<div class="thread-layout no-side"><div class="thread no-side"><div class="user-message">${esc(T.ticketPrompt)}</div><div class="assistant-body"><div class="agent-label">${providerMark()}Codex · Working</div><p class="assistant-text">${esc(T.typed('I have the ticket context. I’ll compare the acceptance criteria with the dashboard and identify what still needs work.',s.t,113.4,117.8))}</p>${s.t >= 115 ? tool('Read ticket context', 'W-100042', true, '3 acceptance criteria') : ''}${s.t >= 117 ? tool('Read', 'src/TaskDashboard.tsx', false) : ''}</div>${followup()}</div></div>`;
  }
  function plugins() {
    const rows = [['ACP providers','Run Zana threads with your installed agents.','bot'],['Ask user question','Answer questions directly in the thread.','alert'],['Codex provider','Run Zana threads with Codex.','bot'],['Docs','Project knowledge, files and shared context.','docs'],['GUS','Your tickets, sprints and watched work.','gus'],['PR Monitor','Keep pull requests and checks in view.','branch']];
    return `<div class="plugins-page"><h1>Plugins</h1><p>The tools in your command center. Add what you need, or build something of your own.</p><div class="plugins-controls"><div class="plugin-search">${icon('search',true)}Search installed plugins</div>${btn(`${icon('plus',true)} New plugin`, 'primary data-time="125" data-cue="new-plugin"')}</div><div class="plugin-filters"><span class="active">All</span><span>Official</span><span>User</span></div><div class="plugin-list">${rows.map(([name,desc,glyph]) => `<div class="plugin-row"><span class="plugin-icon">${icon(glyph)}</span><div><strong>${name}<span class="official">Official</span></strong><p>${desc}</p></div><div class="toggle"></div></div>`).join('')}</div></div>`;
  }
  function pluginThread(s) {
    return `${toolbar('Create Focus Board', badge(s.pluginTested ? 'Idle' : 'Working'))}<div class="thread-layout no-side"><div class="thread no-side"><div class="user-message">${esc(T.pluginPrompt)}</div><div class="assistant-body"><div class="agent-label">${providerMark()}Codex · Plugin creator</div><p class="assistant-text">${esc(T.typed('I’ll build a small panel for today’s priorities, then check the add-task and completion flows.',s.t,137.5,140.5))}</p>${s.pluginRead ? tool('Read', 'Plugin Guide · panel starter', s.pluginScaffold) : ''}${s.pluginScaffold ? tool('Create', 'FocusBoard.tsx · package.json', s.pluginBuilt, s.pluginBuilt ? '3 files' : 'Writing…') : ''}${s.pluginBuilt ? tool('Build & verify', 'Focus Board', s.pluginTested, s.pluginTested ? '8 checks passed' : 'Checking interactions…') : ''}${s.pluginTested ? `<div class="plugin-ready"><h3>${icon('check',true)} &nbsp;Focus Board is ready</h3><p>A panel with three priorities, checkboxes, a live count, and local saving.</p>${btn(s.installed ? 'Installed locally' : 'Review & install', 'primary data-time="154" data-cue="review-install"')}</div>` : ''}</div>${followup(!s.pluginTested)}</div></div>`;
  }
  function focus(s) {
    const tasks = exploring ? manualTasks : initialTasks().map((task,i) => ({...task,checked:s.focusChecked[i]}));
    if (!exploring && s.focusAdded) tasks.push({title:'Share the dashboard update',detail:'Added just now',checked:false});
    const done = tasks.filter(t => t.checked).length;
    return `${toolbar(`${icon('grid')}Focus Board <small>Your plugin</small>`, '<span class="pill">Installed locally</span>')}<div class="focus-wrap"><div class="focus-board ${tasks.length > 3 ? 'has-four' : ''}"><div class="focus-topline"><span class="kicker">A little focus goes a long way</span><span class="focus-date">Friday, September 18</span></div><h1>Today’s priorities</h1><p>Make room for the work that matters.</p><div class="focus-progress"><div style="width:${done/tasks.length*100}%"></div></div><div class="focus-count"><span data-count>${done} of ${tasks.length} complete</span><span>${done === tasks.length ? 'All done. Nice work.' : done ? 'One step at a time.' : 'A fresh start.'}</span></div><div class="focus-tasks">${tasks.map((task,i) => `<button class="focus-task ${task.checked ? 'checked' : ''}" data-toggle="${i}" data-cue="focus-${i}" role="checkbox" aria-checked="${task.checked}" aria-label="${esc(task.title)}"><span class="focus-check">${task.checked ? icon('check',true) : ''}</span><span><strong>${esc(task.title)}</strong><small>${esc(task.detail)}</small></span><span class="task-number">0${i+1}</span></button>`).join('')}</div><form class="focus-add" id="task-form">${exploring ? '<input id="new-task" aria-label="New priority" placeholder="Add a priority…" maxlength="100" autocomplete="off">' : `<div class="fake-input" data-cue="focus-input">${!s.focusAdded && s.focusDraft ? `<span class="caret">${esc(s.focusDraft)}</span>` : '<span style="color:#a1b1c7">Add a priority…</span>'}</div>`}<button class="btn soft" type="submit" data-cue="focus-add">${icon('plus',true)}Add</button></form><div class="focus-footnote">${icon('check',true)}${exploring ? 'Changes stay in this demo tab' : 'Saved locally'} &nbsp;·&nbsp; Built to fit the way you work</div></div></div>`;
  }
  function overlays(s) {
    if(s.view==='cli-terminal'&&!s.cliFullscreen)return cliTerminal(s);
    if (s.modal === 'project-menu') return `<div class="menu"><button class="menu-item highlight" data-time="11" data-cue="add-local">${icon('folder')}Add local folder</button><div class="menu-item">${icon('branch')}Clone from Git</div><div class="menu-sep"></div><div class="menu-item">${icon('monitor')}Connect remote project</div></div>`;
    if (s.modal === 'add-project') return `<div class="scrim"><div class="modal"><div class="modal-header">Add project<button data-time="7" aria-label="Close">${icon('close')}</button></div><div class="modal-body"><p>A project gives your agents a place to work.</p><label class="input-label">Project folder</label><div class="field" data-cue="path"><span class="caret">${esc(s.projectPath)}</span></div><div class="field-help">The folder already contains your app and its instructions.</div></div><div class="modal-footer">${btn('Cancel','data-time="7"')}${btn('Add project','primary data-time="19.5" data-cue="confirm-project"')}</div></div></div>`;
    if (s.modal === 'provider') return `<div class="provider-menu menu"><div class="kicker">Installed providers</div>${['Claude Code','Cursor','Codex','OpenCode'].map(name => `<button class="menu-item ${s.t >= 26.6 && name === 'Codex' ? 'highlight' : ''}" data-time="28" ${name === 'Codex' ? 'data-cue="codex"' : ''}>${providerMark()}${name}</button>`).join('')}</div>`;
    if (s.modal === 'ticket') return `<div class="scrim"></div><div class="ticket-modal"><div class="ticket-top"><span class="ticket-id">W-100042 &nbsp; · &nbsp; User Story</span><div style="display:flex;gap:9px">${btn(`${icon('star',true)}${s.watching ? 'Watching' : 'Watch'}`, 'data-time="97" data-cue="watch"')}${btn(`${icon('bot',true)}Work with agent`, 'primary data-time="107" data-cue="work-with-agent"')}${btn(`${icon('link',true)}`, 'aria-label="Open in GUS"')}<button data-time="92" aria-label="Close ticket">${icon('close',true)}</button></div></div><h2>Add task filters</h2><div class="ticket-facts"><span>New</span><span>3 story points</span><span>September sprint</span><span>Jamie Demo</span></div><div class="ticket-tabs"><span class="${!s.chatter ? 'active' : ''}">Details</span><button class="${s.chatter ? 'active' : ''}" data-time="101" data-cue="chatter">Chatter <small>2</small></button></div><div class="ticket-body"><div>${s.chatter ? `<div class="chatter-entry"><span class="avatar">JD</span><div><strong>Jamie Demo</strong><small>Today, 9:14 AM</small><p>The dashboard layout is ready. Let’s keep the filter selection local for this first version.</p></div></div><div class="chatter-entry"><span class="avatar">AL</span><div><strong>Alex Lee</strong><small>Today, 9:32 AM</small><p>Agreed. Please include keyboard navigation and an empty state in the acceptance checks.</p></div></div>` : '<h4>Description</h4><p>Let people focus on the work they care about by filtering the dashboard by task status.</p><h4>Acceptance criteria</h4><div class="criteria">Filter by To do, In progress, or Complete.</div><div class="criteria">Remember the selected filter locally.</div><div class="criteria">Keep the summary in sync with all tasks.</div>'}</div><aside><div class="fact">Assignee<strong>Jamie Demo</strong></div><div class="fact">Team<strong>Atlas team</strong></div><div class="fact">Product<strong>Atlas dashboard</strong></div><div class="fact">Sprint<strong>September sprint</strong></div></aside></div></div>`;
    if (s.modal === 'install') return `<div class="scrim"><div class="modal"><div class="modal-header">Install Focus Board</div><div class="modal-body"><p>Add your custom panel to Zana. Review the access it needs before enabling it.</p><div class="permission-summary"><strong>Focus Board · Local plugin</strong><div class="permission">${icon('grid',true)}Adds a panel to your sidebar</div><div class="permission">${icon('docs',true)}Stores this plugin’s task list locally</div></div></div><div class="modal-footer">${btn('Cancel','data-time="150"')}${btn('Install & enable','primary data-time="158.5" data-cue="install"')}</div></div></div>`;
    return '';
  }
  function content(s) {
    switch (s.view) {
      case 'home': return home(s);
      case 'compose': return compose(s);
      case 'cli-compose': return compose(s,'cli');
      case 'cli-terminal': return s.cliFullscreen?cliTerminal(s):board(s);
      case 'thread': return thread(s);
      case 'board': return board(s);
      case 'preview': return preview();
      case 'gus': return gus(s);
      case 'ticket-compose': return compose(s,'ticket');
      case 'ticket-thread': return ticketThread(s);
      case 'plugins': return plugins();
      case 'plugin-compose': return compose(s,'plugin');
      case 'plugin-thread': return pluginThread(s);
      case 'focus': return focus(s);
      default: throw new Error(`Unknown demo view ${s.view}`);
    }
  }
  const outro = () => `<div class="outro-overlay"><div class="outro-card"><img src="assets/zana.png" alt=""><h1>Start a project. Give it a goal.</h1><p>Launch an agent. Stay in the loop.<br>Make room for your next idea.</p><div class="outro-tags"><span>Projects</span><span>Agents</span><span>GUS</span><span>Your plugins</span></div></div></div>`;
  function render(seconds) {
    current = Math.min(T.DURATION, Math.max(0, Number(seconds) || 0));
    const s = T.stateAt(current);
    $('sidebar').dataset.pluginContext=String(s.view.startsWith('plugin')||s.installed);
    $('app-window').classList.toggle('is-cli-fullscreen',s.view==='cli-terminal'&&s.cliFullscreen);
    const markup = content(s);
    if (markup !== lastContentKey) { $('content').innerHTML = markup; lastContentKey = markup; }
    const side = sidebar(s);
    if (side !== lastSideKey) { $('sidebar').innerHTML = side; lastSideKey = side; }
    const overlay = overlays(s) + (s.outro && !exploring ? outro() : '');
    if (overlay !== lastOverlayKey) { $('overlay').innerHTML = overlay; lastOverlayKey = overlay; }
    $('chapter-label').textContent = s.chapter.title;
    $('stage').style.setProperty('--spin', `${current * 230 % 360}deg`);
    $('toast').innerHTML = s.toast ? `${icon('check',true)}${esc(s.toast)}` : '';
    $('toast').style.display = s.toast ? 'flex' : 'none';
    const caption = DemoCaptions.find(c => current >= c.start && current < c.end);
    $('subtitle').textContent = exploring ? 'Try it: check off a priority, or add one of your own.' : caption?.text || '';
    const cursor = T.cursorAt(current);
    $('virtual-cursor').style.transform = `translate(${cursor.x}px,${cursor.y}px)`;
    $('virtual-cursor').style.display = cursor.visible && !exploring ? 'block' : 'none';
    const ring = $('virtual-cursor').firstElementChild;
    ring.style.opacity = cursor.click === null ? 0 : .65 * (1-cursor.click);
    ring.style.transform = `scale(${cursor.click === null ? .5 : .5+cursor.click*1.5})`;
    $('chapter-track').innerHTML = T.chapters.map((c,i) => {
      const end = T.chapters[i+1]?.at || T.DURATION;
      return `<span class="chapter-segment" style="flex:${end-c.at}"><i style="width:${Math.max(0,Math.min(1,(current-c.at)/(end-c.at)))*100}%"></i></span>`;
    }).join('');
    $('seek').value = current;
    $('time-label').textContent = `${formatTime(current)} / ${formatTime(T.DURATION)}`;
    $('chapter-select').value = s.chapter.at;
    return s;
  }
  function formatTime(t) { return `${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`; }
  function resize() {
    const factor = Math.min(window.innerWidth / 1920, document.body.classList.contains('capture-mode') ? window.innerHeight/1080 : Infinity);
    $('stage').style.transform = `scale(${factor})`;
    $('viewport').style.height = `${1080 * factor}px`;
  }
  function syncSound() {
    if (running && sound) { audio.currentTime = current; audio.play().catch(() => { sound=false; $('sound').textContent='♪ Sound off'; }); }
    else audio.pause();
  }
  function pause() { running=false; audio.pause(); $('play').textContent='▶ Play'; $('play').setAttribute('aria-label','Play walkthrough'); }
  function play() { exploring=false; if (current >= T.DURATION) current=0; running=true; lastWall=performance.now(); $('play').textContent='Ⅱ Pause'; $('play').setAttribute('aria-label','Pause walkthrough'); syncSound(); }
  function seek(t) { exploring=false; render(t); syncSound(); }
  function explore() { pause(); exploring=true; manualTasks=initialTasks(); render(T.toPresentation(161)); }
  $('play').addEventListener('click', () => running ? pause() : play());
  $('restart').addEventListener('click', () => { pause(); seek(0); play(); });
  $('seek').addEventListener('input', e => seek(Number(e.target.value)));
  $('chapter-select').innerHTML = T.chapters.map(c => `<option value="${c.at}">${esc(c.label)}</option>`).join('');
  $('chapter-select').addEventListener('change', e => seek(Number(e.target.value)));
  $('sound').addEventListener('click', () => { sound=!sound; $('sound').textContent = sound ? '♪ Sound on' : '♪ Sound off'; syncSound(); });
  $('explore').addEventListener('click', explore);
  $('stage').addEventListener('click', event => {
    const toggle = event.target.closest('[data-toggle]');
    if (toggle) {
      if (!exploring) { pause(); const s=T.stateAt(current); manualTasks=initialTasks().map((t,i)=>({...t,checked:s.focusChecked[i]})); if(s.focusAdded)manualTasks.push({title:'Share the dashboard update',detail:'Added just now',checked:false}); exploring=true; }
      const i=Number(toggle.dataset.toggle); manualTasks[i].checked=!manualTasks[i].checked; render(T.toPresentation(161)); return;
    }
    const absolute=event.target.closest('[data-at]');
    if(absolute){pause();seek(Number(absolute.dataset.at));return;}
    const target = event.target.closest('[data-time]');
    if (target) { pause(); seek(T.toPresentation(Number(target.dataset.time))); }
  });
  $('stage').addEventListener('submit', event => {
    if (event.target.id !== 'task-form') return;
    event.preventDefault();
    if (!exploring) { explore(); return; }
    const title = $('new-task').value.trim();
    if (!title || manualTasks.length >= 6) return;
    manualTasks.push({title:title.slice(0,100),detail:'Added just now',checked:false}); render(T.toPresentation(161));
  });
  window.addEventListener('resize',resize);
  const capture = new URLSearchParams(location.search).has('capture');
  if (capture) document.body.classList.add('capture-mode');
  window.demo = { seek(t) { pause(); exploring=false; return render(t); }, play, pause, explore, state:()=>({time:current,running,exploring,tasks:manualTasks.map(t=>({...t}))}), duration:T.DURATION };
  function tick(now) {
    if (running) { const dt=Math.min((now-lastWall)/1000,.25); const next=Math.min(current+dt,T.DURATION); render(next); if(next>=T.DURATION)pause(); }
    lastWall=now; requestAnimationFrame(tick);
  }
  render(0); resize(); requestAnimationFrame(tick);
})();
