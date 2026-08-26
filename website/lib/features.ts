/**
 * Detailed catalog of the CORE app's capabilities, drawn from the repo README +
 * the renderer surfaces (src/renderer/components/*). Used by the landing
 * highlights and the dedicated /features page. Keep grounded in real features —
 * do not invent capabilities the app doesn't ship.
 */

export type FeatureSlug =
  | 'cockpit'
  | 'agents-board'
  | 'inbox'
  | 'orchestration'
  | 'projects'
  | 'scheduler'
  | 'extensions';

export interface FeatureDetail {
  slug: FeatureSlug;
  title: string;
  tagline: string;
  body: string;
  /** Concrete capabilities — the "what you actually get" list. */
  points: string[];
  /** Optional related doc slug on this site. */
  docs?: string;
}

export const FEATURES: FeatureDetail[] = [
  {
    slug: 'cockpit',
    title: 'Multi-project cockpit',
    tagline: 'One window for every project and every session.',
    body:
      'A workspace of real Claude Code, OpenCode, Codex, and Pi terminals, not a generic chat wrapper. Switch projects or harnesses without losing anything that is running.',
    points: [
      'Real terminals — full shell, not a chat box',
      'Tabbed workspace with a command palette',
      'Switch projects without losing a session'
    ]
  },
  {
    slug: 'agents-board',
    title: 'Agents board',
    tagline: 'See who needs you vs. who is still working.',
    body:
      'Every running session at a glance, grouped by state — needs you, working, idle, or done. A global board rolls all your projects into one view.',
    points: [
      'Per-project and all-projects views',
      'Grouped by needs-you · working · idle · done',
      'Open any agent to take over directly'
    ]
  },
  {
    slug: 'inbox',
    title: 'Inbox',
    tagline: "Agents come to you — you don't watch every terminal.",
    body:
      'Agents push results, questions, and reports into one feed. Reply from the inbox and your answer goes straight back to the waiting session.',
    points: [
      'Results, questions, and summaries in one feed',
      'Reply inline — answers route back to the agent',
      'Triage decisions instead of scanning scrollback'
    ]
  },
  {
    slug: 'orchestration',
    title: 'Multi-agent orchestration',
    tagline: 'Run a fleet — teams, sprints, and autopilot.',
    body:
      'Go beyond single sessions: spin up curated teams, run sprints against a ticket board, and let goal-driven autopilot loop until the job is done — while you stay in the loop.',
    points: [
      'Curated teams of agents, spawned on demand',
      'Sprints and a kanban ticket board per project',
      'Autopilot that loops toward a goal'
    ]
  },
  {
    slug: 'projects',
    title: 'Local & remote projects',
    tagline: 'This computer, an enrolled machine, or SSH — one explorer.',
    body:
      'Add a local folder, browse a machine you paired in Settings → Machines, or attach a remote SSH project. Work the same way, with a file explorer that spans all three. Enrolled machines and SSH remotes are separate paths.',
    points: [
      'Add local folders or git repos in a click',
      'Pair another computer as an execution host',
      'Browse SSH remotes without leaving the app'
    ],
    docs: 'multiple-devices'
  },
  {
    slug: 'scheduler',
    title: 'Scheduler, personas & teams',
    tagline: 'Automate recurring work with reusable crews.',
    body:
      'Define recurring tasks that launch agents on a schedule, save personas (reusable launch profiles), and compose teams from them.',
    points: [
      'Schedules that launch agents unattended',
      'Personas: reusable role + model + prompt + tools',
      'Teams: multi-agent crews spawned on demand'
    ]
  },
  {
    slug: 'extensions',
    title: 'Plugins & marketplace',
    tagline: 'Extend the app, or install from the marketplace.',
    body:
      'Add new features — a sidebar panel, a per-project tab, skills, MCP servers — without editing core. Install from the marketplace in a click, or build your own with the plugin SDK.',
    points: [
      'Install plugins from official or community catalogs',
      'Add panels, tabs, skills, and MCP servers',
      'Build your own with @zana-ai/zcc-plugin-sdk'
    ],
    docs: 'extensions-authoring'
  }
];

/** The subset highlighted on the landing grid. */
export const LANDING_FEATURE_SLUGS = [
  'cockpit',
  'agents-board',
  'inbox',
  'orchestration',
  'projects',
  'extensions'
];
