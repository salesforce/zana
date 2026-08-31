export interface PluginSurface {
  id: string;
  title: string;
  summary: string;
  bullets: string[];
  tagline?: string;
  apiSymbols: string[];
  firstParty?: string[];
  experimental?: boolean;
}

export interface SurfaceGroup {
  id: string;
  title: string;
  blurb: string;
  fixtureKind: 'spatial' | 'capability-grid';
  surfaces: PluginSurface[];
  sections?: readonly { title: string; surfaceIds: readonly string[] }[];
}

export const SURFACE_GROUPS: SurfaceGroup[] = [
  {
    id: 'app-shell',
    title: 'App shell',
    fixtureKind: 'spatial',
    blurb: 'Global sidebar, Workspaces header, project rail, and workspace topbar.',
    surfaces: [
      {
        id: 'navPanel',
        title: 'Sidebar panel',
        summary: 'A full-height page in the global sidebar, or a page listed under Plugins.',
        bullets: [
          'Default `placement: "sidebar"` registers a rail row at `/plugins/<id>/<path>`.',
          '`placement: "extensions"` lists the page in the Plugins hub instead.',
          'Optional header and sidebar accessory.'
        ],
        apiSymbols: ['PluginAppSlots.navPanel', 'PluginNavPanelRegistration'],
        firstParty: ['Tasks', 'Automations', 'PR Monitor']
      },
      {
        id: 'projectTab',
        title: 'Project tab',
        summary: 'A tab on the project-scoped workspace rail, beside Agents and Explorer.',
        bullets: [
          'Receives `pluginId` and `projectId`.',
          'The workspace topbar labels the tab; fill the slot, not the list pane.',
          '`global: false` hides the global sidebar entry.'
        ],
        apiSymbols: ['PluginAppSlots.projectTab', 'PluginProjectTabRegistration'],
        firstParty: ['Docs', 'Salesforce']
      },
      {
        id: 'experimental_projectMenuAction',
        title: 'Project / workspace menu',
        summary: 'An item on the Workspaces Organize menu or a project-row overflow.',
        bullets: ['`placement: "project"` gets that `projectId`.', '`placement: "workspace"` runs with `projectId: null`.'],
        apiSymbols: ['PluginAppSlots.experimental_projectMenuAction', 'PluginProjectMenuActionRegistration'],
        experimental: true
      },
      {
        id: 'sidebarFooterAction',
        title: 'Sidebar footer',
        summary: 'An action in the rail utility dock.',
        bullets: ['`run` receives `openSettings()`.'],
        apiSymbols: ['PluginAppSlots.sidebarFooterAction', 'PluginSidebarFooterActionRegistration'],
        firstParty: ['Connect']
      }
    ]
  },
  {
    id: 'home',
    title: 'Home',
    fixtureKind: 'spatial',
    blurb: 'New Chat compose — plugin CTAs and sections sit under the prompt.',
    surfaces: [
      {
        id: 'homepageSection',
        title: 'Home section',
        summary: 'A card on the Home compose surface.',
        bullets: ['Props include `pluginId` and optional `projectId`.'],
        apiSymbols: ['PluginAppSlots.homepageSection', 'PluginHomepageSectionRegistration']
      },
      {
        id: 'experimental_newThreadPanelAction',
        title: 'New-thread action',
        summary: 'A CTA under New Chat compose.',
        bullets: ['Can open a compose-time side panel.'],
        apiSymbols: ['PluginAppSlots.experimental_newThreadPanelAction', 'PluginNewThreadPanelActionRegistration'],
        experimental: true
      }
    ]
  },
  {
    id: 'composer',
    title: 'Composer',
    fixtureKind: 'spatial',
    blurb: 'The prompt box every thread uses.',
    surfaces: [
      {
        id: 'composer',
        title: 'Composer chrome',
        summary: 'Actions, banners, plus-menu items, and rich-text effects.',
        bullets: ['Scope to `thread`, `new-thread`, `queued-message`, or `side-chat`.'],
        apiSymbols: ['PluginAppComposer.customize', 'ComposerCustomization'],
        firstParty: ['Workflows', 'Salesforce']
      }
    ]
  },
  {
    id: 'thread',
    title: 'Thread',
    fixtureKind: 'spatial',
    blurb: 'The conversation, its side panel, and message chrome.',
    surfaces: [
      {
        id: 'threadPanelAction',
        title: 'Thread panel',
        summary: 'A tab beside an existing thread.',
        apiSymbols: ['PluginAppSlots.threadPanelAction', 'PluginThreadPanelActionRegistration'],
        bullets: ['`run` can open the panel with params.'],
        firstParty: ['Tasks', 'Side chat']
      },
      {
        id: 'pendingInteraction',
        title: 'Pending interaction',
        summary: 'Custom in-thread prompt UI.',
        bullets: ['`id` must match `zcc.ui.requestInput` `rendererId`.'],
        apiSymbols: ['PluginAppSlots.pendingInteraction', 'PluginUi.requestInput'],
        firstParty: ['Ask user question', 'Secrets']
      },
      {
        id: 'experimental_threadHeaderAction',
        title: 'Thread header',
        summary: 'An action in the thread detail header.',
        apiSymbols: ['PluginAppSlots.experimental_threadHeaderAction'],
        bullets: ['Receives `threadId` and `projectId`.'],
        experimental: true
      },
      {
        id: 'experimental_threadList',
        title: 'Agents list',
        summary: 'Replace the Agents list pane.',
        apiSymbols: ['PluginAppSlots.experimental_threadList'],
        bullets: ['Exclusive — last registered wins Appearance pin.'],
        experimental: true
      },
      {
        id: 'experimental_agentCardAction',
        title: 'Agent card action',
        summary: 'A right-click item on an Agents board card.',
        apiSymbols: ['PluginAppSlots.experimental_agentCardAction'],
        bullets: ['Optional `isAvailable` gate receives `sessionId` and `projectId`.'],
        experimental: true
      },
      {
        id: 'experimental_agentsBoardAction',
        title: 'Agents board action',
        summary: 'A toolbar control on the Agents board.',
        apiSymbols: ['PluginAppSlots.experimental_agentsBoardAction'],
        bullets: ['`projectId` is `null` on the cross-project Agents nav.'],
        experimental: true
      },
      {
        id: 'experimental_timelineRenderer',
        title: 'Timeline renderer',
        summary: 'Custom body for a timeline row kind.',
        apiSymbols: ['PluginAppSlots.experimental_timelineRenderer'],
        bullets: ['Key is `kind`, not a free-form slot id.'],
        experimental: true
      },
      {
        id: 'messageDirective',
        title: 'Message directive',
        summary: 'Render `::name{attr}` leaves in markdown.',
        apiSymbols: ['PluginAppSlots.messageDirective'],
        bullets: ['Id must be a kebab-case directive name.'],
        firstParty: ['Docs', 'Tasks', 'Workflows']
      },
      {
        id: 'messageAction',
        title: 'Message action',
        summary: 'A per-message menu item on the timeline.',
        apiSymbols: ['PluginAppSlots.messageAction'],
        bullets: ['Gets selected text and `openPanel`.'],
        firstParty: ['Side chat']
      },
      {
        id: 'fileOpener',
        title: 'File opener',
        summary: 'Open a previewed file by extension.',
        apiSymbols: ['PluginAppSlots.fileOpener'],
        bullets: ['Listed in thread file preview “Open with”.'],
        firstParty: ['Docs', 'Salesforce']
      }
    ]
  },
  {
    id: 'command-palette',
    title: 'Command palette',
    fixtureKind: 'spatial',
    blurb: '⌘P Extensions section.',
    surfaces: [
      {
        id: 'commandPaletteAction',
        title: 'Palette action',
        summary: 'A row in the command palette.',
        apiSymbols: ['PluginAppSlots.commandPaletteAction'],
        bullets: ['Optional `isAvailable` gate.'],
        firstParty: ['PR Monitor', 'Salesforce']
      }
    ]
  },
  {
    id: 'settings',
    title: 'Configure',
    fixtureKind: 'spatial',
    blurb: 'The Plugins hub detail for one install.',
    surfaces: [
      {
        id: 'settingsSection',
        title: 'Settings section',
        summary: 'A React settings UI on the plugin’s hub page.',
        apiSymbols: ['PluginAppSlots.settingsSection', 'ZccPluginApi.settings'],
        bullets: [
          'Renders `title` and `description` on the plugin’s hub Configure block.',
          'Host `zcc.settings.define` form mounts on the same page.'
        ],
        firstParty: ['Custom instructions', 'Connect', 'Keep-awake']
      }
    ]
  },
  {
    id: 'headless',
    title: 'Platform',
    fixtureKind: 'capability-grid',
    blurb: 'APIs with no pixels — skills, CLI, MCP, workers.',
    sections: [
      { title: 'Agent capabilities', surfaceIds: ['skills', 'cli', 'mcp'] },
      { title: 'Host services', surfaceIds: ['settings-define', 'background'] },
      { title: 'Runtime', surfaceIds: ['contentScripts', 'experimental_providerIcon'] }
    ],
    surfaces: [
      {
        id: 'skills',
        title: 'Skills',
        tagline: 'SKILL.md roots the agent can load.',
        summary: 'Durable and runtime skill directories injected into every provider.',
        bullets: [
          '`package.json` `zcc.skills` (default `["skills"]`).',
          '`zcc.agents.contributeSkills` at runtime.',
          'CLI verbs rewrite the generated `plugin-commands` skill.'
        ],
        apiSymbols: ['ZccPluginApi.agents.contributeSkills']
      },
      {
        id: 'cli',
        title: 'CLI command',
        tagline: 'A `zcc <name>` verb.',
        summary: 'Register a command the core CLI dispatches in-process.',
        bullets: ['Core `zcc` names always win.'],
        apiSymbols: ['ZccPluginApi.cli.register']
      },
      {
        id: 'mcp',
        title: 'MCP servers',
        tagline: 'Servers merged into project `.mcp.json`.',
        summary: 'Declare MCP servers on the manifest.',
        bullets: ['`command` is basename-only.'],
        apiSymbols: ['PluginManifest.mcpServers']
      },
      {
        id: 'settings-define',
        title: 'Defined settings',
        tagline: 'Host-rendered schema.',
        summary: '`zcc.settings.define` descriptors the hub form can persist.',
        bullets: ['`status.needsConfiguration` deep-links here.'],
        apiSymbols: ['ZccPluginApi.settings.define', 'ZccPluginApi.status.needsConfiguration']
      },
      {
        id: 'background',
        title: 'Background',
        tagline: 'Services and cron.',
        summary: 'Long-running work and minute-aligned schedules.',
        bullets: ['Named schedules persist last-fired minute.'],
        apiSymbols: ['ZccPluginApi.background.service', 'ZccPluginApi.background.schedule']
      },
      {
        id: 'contentScripts',
        title: 'Content scripts',
        tagline: 'Per-window mount/dispose.',
        summary: 'Run host-side DOM work without a panel.',
        bullets: ['Registered via `app.contentScripts.register`.'],
        apiSymbols: ['PluginAppContentScripts.register']
      },
      {
        id: 'experimental_providerIcon',
        title: 'Provider icon',
        tagline: 'Picker glyph for a provider id.',
        summary: 'Replace the default icon for a thread provider.',
        bullets: ['`providerId` must match a registered provider.'],
        apiSymbols: ['PluginAppSlots.experimental_providerIcon'],
        experimental: true,
        firstParty: ['Claude Code', 'Codex', 'Pi']
      }
    ]
  }
];

export const SURFACES: PluginSurface[] = SURFACE_GROUPS.flatMap((group) => group.surfaces);

export const SURFACES_BY_ID = new Map(SURFACES.map((surface) => [surface.id, surface]));

export const GROUP_BY_SURFACE_ID = new Map(
  SURFACE_GROUPS.flatMap((group) => group.surfaces.map((surface) => [surface.id, group] as const))
);

export function copyPluginSurfaceAgentReference(surface: PluginSurface): string {
  return [
    `ZCC plugin surface: ${surface.title} (\`${surface.id}\`)`,
    surface.summary,
    ...surface.bullets.map((line) => `- ${line}`),
    `SDK: ${surface.apiSymbols.join(', ')}`,
    'After editing, run `zcc plugin install .` then `zcc plugin dev` and open this surface in the running app.'
  ].join('\n');
}
