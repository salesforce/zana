/* Deterministic demo clock. All times are seconds; all data is fictional. */
(() => {
  const DURATION = 190;
  const chapters = [
    { at: 0, label: 'Welcome', title: 'A place for every part of your work' },
    { at: 7, label: 'Create a project', title: '01  /  Give your work a home' },
    { at: 23, label: 'Launch an agent', title: '02  /  Describe the outcome' },
    { at: 46, label: 'Monitor the work', title: '03  /  Stay in the loop' },
    { at: 85, label: 'Your GUS tickets', title: '04  /  Keep your tickets close' },
    { at: 119, label: 'Create a plugin', title: '05  /  Make Zana your own' },
    { at: 178, label: 'Ready for your next idea', title: 'Projects. Agents. Tickets. Your tools.' },
  ];
  const prompt = 'Build a task dashboard with status filters and a completion summary. Follow the existing design, add tests, and show me what changed.';
  const pluginPrompt = 'Create a new Zana plugin called Focus Board. Show my three priorities for today, with checkboxes and a completion count. Let me add a task. Keep it simple and save my changes locally.';
  const ticketPrompt = 'Help me implement GUS W-100042: Add task filters. Review the acceptance criteria, inspect the existing dashboard, and propose the smallest change.';
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  function typed(text, t, start, end) { return text.slice(0, Math.floor(text.length * clamp((t - start) / (end - start), 0, 1))); }
  function stateAt(seconds) {
    const t = clamp(Number.isFinite(seconds) ? seconds : 0, 0, DURATION);
    let view = 'home';
    if (t >= 23) view = 'compose';
    if (t >= 36) view = 'thread';
    if (t >= 46) view = 'board';
    if (t >= 53) view = 'thread';
    if (t >= 73) view = 'preview';
    if (t >= 79) view = 'board';
    if (t >= 85) view = 'gus';
    if (t >= 107) view = 'ticket-compose';
    if (t >= 113) view = 'ticket-thread';
    if (t >= 119) view = 'plugins';
    if (t >= 125) view = 'plugin-compose';
    if (t >= 137) view = 'plugin-thread';
    if (t >= 161) view = 'focus';
    let modal = null;
    if (t >= 8.5 && t < 11) modal = 'project-menu';
    if (t >= 11 && t < 19.5) modal = 'add-project';
    if (t >= 25 && t < 28) modal = 'provider';
    if (t >= 94 && t < 107) modal = 'ticket';
    if (t >= 154 && t < 158.5) modal = 'install';
    let status = 'Working';
    if (t >= 50.5 && t < 57.5) status = 'Needs you';
    if (t >= 70) status = 'Idle';
    return {
      t, view, modal, status,
      chapter: chapters.filter(c => c.at <= t).at(-1),
      projectCreated: t >= 19.5,
      projectPath: typed('~/Projects/atlas-dashboard', t, 12.2, 16.5),
      provider: t >= 27.3 ? 'Codex' : 'Claude Code',
      prompt: typed(prompt, t, 29, 34.7),
      pluginPrompt: typed(pluginPrompt, t, 126, 135),
      ticketPrompt,
      sent: t >= 36,
      inspected: t >= 40,
      edited: t >= 43,
      question: t >= 50.5 && t < 57.5,
      answerSelected: t >= 55,
      answerSent: t >= 57.5,
      tests: t >= 63,
      passed: t >= 68,
      diff: t >= 60.5 && t < 73,
      result: typed('Built the task dashboard with status filters and a completion summary. Your selection is saved locally, and all 12 tests pass.', t, 70, 72.6),
      me: t >= 89,
      sprint: t >= 92,
      watching: t >= 97,
      chatter: t >= 101,
      pluginRead: t >= 139,
      pluginScaffold: t >= 142,
      pluginBuilt: t >= 146,
      pluginTested: t >= 150,
      installed: t >= 158.5,
      focusChecked: t >= 168 ? [true, true, false] : t >= 164.5 ? [true, false, false] : [false, false, false],
      focusDraft: typed('Share the dashboard update', t, 170, 173),
      focusAdded: t >= 174,
      outro: t >= 178,
      toast: t >= 19.5 && t < 22.8 ? 'Project added' : t >= 97 && t < 100 ? 'You’re watching W-100042' : t >= 158.5 && t < 161.5 ? 'Focus Board is ready' : null,
    };
  }
  // Coordinates live in the fixed 1920×1080 stage, never the OS desktop.
  const moves = [
    [
      0,
      1140,
      540
    ],
    [
      6.5,
      1140,
      540
    ],
    [
      8.5,
      265,
      525,
      1
    ],
    [
      10.3,
      357,
      551
    ],
    [
      11,
      357,
      551,
      1
    ],
    [
      12.1,
      960,
      558,
      1
    ],
    [
      18.800000001,
      1208,
      668
    ],
    [
      19.5,
      1208,
      668,
      1
    ],
    [
      22.3,
      1150,
      610
    ],
    [
      23,
      755,
      671,
      1
    ],
    [
      24.3,
      800,
      595
    ],
    [
      25,
      800,
      595,
      1
    ],
    [
      27.3,
      840,
      761,
      1
    ],
    [
      28.4,
      1088,
      513
    ],
    [
      29,
      1088,
      513,
      1
    ],
    [
      35.300000001,
      1512,
      595
    ],
    [
      36,
      1512,
      595,
      1
    ],
    [
      39,
      1292,
      648
    ],
    [
      44,
      1251,
      665
    ],
    [
      45.3,
      173,
      241
    ],
    [
      46,
      173,
      241,
      1
    ],
    [
      49.5,
      858,
      449
    ],
    [
      51.3,
      504,
      345
    ],
    [
      53,
      504,
      345,
      1
    ],
    [
      54.3,
      614,
      477
    ],
    [
      55,
      614,
      477,
      1
    ],
    [
      56.8,
      1242,
      577
    ],
    [
      57.5,
      1242,
      577,
      1
    ],
    [
      59.800000001,
      1548,
      214
    ],
    [
      60.5,
      1548,
      214,
      1
    ],
    [
      64,
      1621,
      511
    ],
    [
      71.8,
      1720,
      161
    ],
    [
      73,
      1720,
      161,
      1
    ],
    [
      75,
      1122,
      350
    ],
    [
      78.3,
      173,
      241
    ],
    [
      79,
      173,
      241,
      1
    ],
    [
      84.3,
      173,
      393
    ],
    [
      85,
      173,
      393,
      1
    ],
    [
      88.3,
      667,
      223
    ],
    [
      89,
      667,
      223,
      1
    ],
    [
      91.3,
      411,
      501
    ],
    [
      92,
      411,
      501,
      1
    ],
    [
      93.3,
      698,
      385
    ],
    [
      94,
      698,
      385,
      1
    ],
    [
      96.3,
      1189,
      238
    ],
    [
      97,
      1189,
      238,
      1
    ],
    [
      100.3,
      670,
      412
    ],
    [
      101,
      670,
      412,
      1
    ],
    [
      106.3,
      1320,
      238
    ],
    [
      107,
      1320,
      238,
      1
    ],
    [
      109.000000001,
      974,
      486
    ],
    [
      112.300000001,
      1512,
      571
    ],
    [
      113,
      1512,
      571,
      1
    ],
    [
      118.3,
      173,
      317
    ],
    [
      119,
      173,
      317,
      1
    ],
    [
      124.3,
      1624,
      300
    ],
    [
      125,
      1624,
      300,
      1
    ],
    [
      125.8,
      1088,
      495,
      1
    ],
    [
      136.3,
      1512,
      577
    ],
    [
      137,
      1512,
      577,
      1
    ],
    [
      140.000000001,
      1245,
      651
    ],
    [
      148,
      1218,
      619
    ],
    [
      153.3,
      733,
      650
    ],
    [
      154,
      733,
      650,
      1
    ],
    [
      157.800000001,
      1196,
      676
    ],
    [
      158.5,
      1196,
      676,
      1
    ],
    [
      160.3,
      173,
      507
    ],
    [
      161,
      173,
      507,
      1
    ],
    [
      163.8,
      734,
      491
    ],
    [
      164.5,
      734,
      491,
      1
    ],
    [
      167.3,
      734,
      581
    ],
    [
      168,
      734,
      581,
      1
    ],
    [
      169.4,
      1046,
      754
    ],
    [
      170,
      1046,
      754,
      1
    ],
    [
      173.3,
      1435,
      754
    ],
    [
      174,
      1435,
      754,
      1
    ],
    [
      176,
      1510,
      737
    ],
    [
      190,
      1510,
      737
    ]
  ];
  function cursorAt(seconds) {
    const t = clamp(Number.isFinite(seconds) ? seconds : 0, 0, DURATION);
    let b = moves.findIndex(m => m[0] > t);
    if (b < 0) b = moves.length - 1;
    const a = Math.max(0, b - 1), from = moves[a], to = moves[b];
    // A deliberate 0.65 s approach followed by a hold. No slow wandering.
    const start = Math.max(from[0], to[0] - .65);
    const f = clamp((t - start) / Math.max(.001, to[0] - start), 0, 1);
    const ease = f * f * (3 - 2 * f);
    const click = moves.findLast(m => m[3] && m[0] <= t);
    const age = click ? t - click[0] : Infinity;
    return { x: from[1] + (to[1] - from[1]) * ease, y: from[2] + (to[2] - from[2]) * ease,
      click: age < .5 ? age / .5 : null, visible: t > 6 && t < 178 };
  }
  globalThis.DemoTimeline = { DURATION, chapters, prompt, pluginPrompt, ticketPrompt, stateAt, cursorAt, typed, moves };
})();
