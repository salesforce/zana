/**
 * Detailed catalog of the CORE app's capabilities, drawn from the repo README +
 * the renderer surfaces (apps/app). Used by the landing highlights and the
 * dedicated /features page. Keep grounded in real features — do not invent
 * capabilities the app doesn't ship.
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
      'New Chat starts a Thread with Claude Code, Cursor, OpenCode, Codex, or Pi. Legacy Agent is still a real PTY when you want the native terminal. Switch projects or harnesses without losing anything that is running.',
    points: [
      'Thread is the default; Legacy Agent is a real PTY',
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
    tagline: 'Run a fleet — teams, goals, and autonomous runs.',
    body:
      'Go beyond single sessions: spin up curated teams, launch an Autonomous Team from New Chat, and let goal-driven autopilot loop until the job is done — while you stay in the loop. Ticket boards live in plugins, not core.',
    points: [
      'Curated teams of agents, spawned on demand',
      'Autonomous Team launch from New Chat',
      'Goals that loop toward an outcome'
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
