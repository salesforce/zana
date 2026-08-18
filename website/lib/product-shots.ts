export const PRODUCT_SHOT_IDS = [
  'cockpit-overview',
  'project-setup',
  'agent-terminal',
  'agents-board',
  'inbox-decision',
  'team-launch',
  'goal-or-ticket',
  'marketplace-catalog',
  'extension-install',
  'extension-consent',
  'local-extension-workspace',
  'extension-panel-result',
  'sdk-main-module'
] as const;

export type ProductShotId = (typeof PRODUCT_SHOT_IDS)[number];

export interface ProductShotDefinition {
  id: ProductShotId;
  title: string;
  caption: string;
  alt: string;
  capture: string;
  aspectRatio: 'wide' | 'standard' | 'portrait';
  /** Add a /product-shots/<name>.webp path when a reviewed screenshot is ready. */
  src?: string;
}

/**
 * The only place a product screenshot is named. A placeholder renders until
 * `src` is set, so replacing a shot never requires touching page layouts.
 */
export const PRODUCT_SHOTS: Record<ProductShotId, ProductShotDefinition> = {
  'cockpit-overview': {
    id: 'cockpit-overview',
    title: 'Zana Command Center',
    caption: 'A single workspace for projects, terminals, agents, and the work that needs attention.',
    alt: 'Zana Command Center showing projects, active agent sessions, and a terminal workspace.',
    capture: 'Show the three-column cockpit with several active projects and a focused terminal.',
    aspectRatio: 'wide',
    src: '/demo.gif'
  },
  'project-setup': {
    id: 'project-setup',
    title: 'Add a project',
    caption: 'Connect local folders and remote SSH workspaces without changing how your coding harness starts.',
    alt: 'The Add project dialog with local folder and remote SSH options.',
    capture: 'Show local-folder and remote-SSH project options in the Add project flow.',
    aspectRatio: 'standard'
  },
  'agent-terminal': {
    id: 'agent-terminal',
    title: 'Focused execution',
    caption: 'Each tab is a real harness terminal, opened in the project that provides its context.',
    alt: 'A coding agent task running in a Zana terminal tab.',
    capture: 'Show a focused supported-harness task running in the correct project directory.',
    aspectRatio: 'standard'
  },
  'agents-board': {
    id: 'agents-board',
    title: 'Agents board',
    caption: 'See which sessions are working, waiting, idle, or complete without inspecting every tab.',
    alt: 'The Zana Agents board showing sessions grouped by status.',
    capture: 'Show a realistic mix of needs-you, working, idle, and done sessions.',
    aspectRatio: 'wide'
  },
  'inbox-decision': {
    id: 'inbox-decision',
    title: 'Inbox',
    caption: 'Questions, reports, and follow-ups reach one decision surface where replies route back to the right session.',
    alt: 'The Zana Inbox with an agent question and an inline reply action.',
    capture: 'Show a high-context agent question and the inline reply action, with no private data.',
    aspectRatio: 'standard'
  },
  'team-launch': {
    id: 'team-launch',
    title: 'Teams',
    caption: 'Launch a repeatable set of roles when a task needs research, implementation, and review in parallel.',
    alt: 'A Zana team launch view showing multiple agent roles.',
    capture: 'Show a team with clearly named roles and an explicit project destination.',
    aspectRatio: 'standard'
  },
  'goal-or-ticket': {
    id: 'goal-or-ticket',
    title: 'Goals and tickets',
    caption: 'Keep work that outlives a single session visible through goals, follow-ups, and project tickets.',
    alt: 'A Zana goal or project ticket board with progress and ownership.',
    capture: 'Show a goal or ticket board with progress, ownership, and a clear next action.',
    aspectRatio: 'wide'
  },
  'marketplace-catalog': {
    id: 'marketplace-catalog',
    title: 'Extension marketplace',
    caption: 'Browse extensions that add panels, project tabs, commands, personas, and teams.',
    alt: 'The Zana extension marketplace showing a searchable extension catalog.',
    capture: 'Show the marketplace catalog with search, extension metadata, and permission summaries.',
    aspectRatio: 'wide'
  },
  'extension-install': {
    id: 'extension-install',
    title: 'Install an extension',
    caption: 'Install from the marketplace, a local built folder, or a published archive using the same validation flow.',
    alt: 'The Zana extension installation interface showing install options.',
    capture: 'Show the extensions settings surface with marketplace, folder, and archive install options.',
    aspectRatio: 'standard'
  },
  'extension-consent': {
    id: 'extension-consent',
    title: 'Review permissions',
    caption: 'Extensions declare the capabilities they need; Zana asks for explicit consent before granting access.',
    alt: 'A Zana extension permission consent dialog.',
    capture: 'Show a permission review dialog with scoped capabilities and no sensitive values.',
    aspectRatio: 'portrait'
  },
  'local-extension-workspace': {
    id: 'local-extension-workspace',
    title: 'Editable local extension',
    caption: 'Keep a local source folder connected so a creator or shell session can rebuild and reload your extension live.',
    alt: 'A local Zana extension source workspace connected to the desktop application.',
    capture: 'Show an editable extension project with its manifest, source, and reload status.',
    aspectRatio: 'wide'
  },
  'extension-panel-result': {
    id: 'extension-panel-result',
    title: 'Your panel in Zana',
    caption: 'A renderer entry can return a React panel that runs inside the host application without a core rebuild.',
    alt: 'A custom extension panel running inside Zana Command Center.',
    capture: 'Show a small finished extension panel mounted inside the Zana application shell.',
    aspectRatio: 'standard'
  },
  'sdk-main-module': {
    id: 'sdk-main-module',
    title: 'Brokered main module',
    caption: 'Optional main-side capabilities are permission-gated and scoped by the host rather than granted as raw Node access.',
    alt: 'Extension source code showing a Zana main module capability call.',
    capture: 'Show a concise main-module example and its permission declaration side by side.',
    aspectRatio: 'standard'
  }
};

export function productShot(id: ProductShotId): ProductShotDefinition {
  return PRODUCT_SHOTS[id];
}
