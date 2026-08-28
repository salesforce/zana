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
    alt: 'Zana Command Center Agents board with sessions grouped into Needs you, Working, Idle, and Done.',
    capture: 'Show the three-column cockpit with several active projects and a focused terminal.',
    aspectRatio: 'wide',
    src: '/product-shots/agents-board.gif'
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
    caption: 'Threads are the default from New Chat; CLI Agent tabs are real harness terminals in the project that provides their context.',
    alt: 'A coding agent task running in a Zana thread or terminal tab.',
    capture: 'Show a focused supported-harness task running in the correct project directory.',
    aspectRatio: 'standard'
  },
  'agents-board': {
    id: 'agents-board',
    title: 'Agents board',
    caption: 'See which sessions are working, waiting, idle, or complete without inspecting every tab.',
    alt: 'The Zana Agents board showing sessions grouped by status.',
    capture: 'Show a realistic mix of needs-you, working, idle, and done sessions.',
    aspectRatio: 'wide',
    src: '/product-shots/agents-board.gif'
  },
  'inbox-decision': {
    id: 'inbox-decision',
    title: 'Inbox',
    caption: 'Questions, reports, and follow-ups reach one decision surface where replies route back to the right session.',
    alt: 'The Zana Inbox grouped into Questions, Reports, Ideas, and Goals.',
    capture: 'Show a high-context agent question and the inline reply action, with no private data.',
    aspectRatio: 'standard',
    src: '/product-shots/inbox-decision.jpg'
  },
  'team-launch': {
    id: 'team-launch',
    title: 'Teams',
    caption: 'Launch a repeatable set of roles when a task needs research, implementation, and review in parallel.',
    alt: 'A Zana team graph showing a squad lead with Designer, Cloud Architect, and Developer roles working in parallel.',
    capture: 'Show a team with clearly named roles and an explicit project destination.',
    aspectRatio: 'standard',
    src: '/product-shots/team-launch.gif'
  },
  'goal-or-ticket': {
    id: 'goal-or-ticket',
    title: 'Goals and follow-ups',
    caption: 'Keep work that outlives a single session visible through goals and follow-ups.',
    alt: 'A Zana goal with progress and ownership.',
    capture: 'Show a goal with progress, ownership, and a clear next action.',
    aspectRatio: 'wide'
  },
  'marketplace-catalog': {
    id: 'marketplace-catalog',
    title: 'Plugin marketplace',
    caption: 'Browse plugins that add panels, skills, and MCP servers from official and community catalogs.',
    alt: 'The Zana plugin marketplace showing a searchable plugin catalog.',
    capture: 'Show the marketplace catalog with search, plugin metadata, and a full-trust install confirm.',
    aspectRatio: 'wide'
  },
  'extension-install': {
    id: 'extension-install',
    title: 'Install a plugin',
    caption: 'Install from official or community catalogs, a local folder, or a git/npm pointer using the same confirm flow.',
    alt: 'The Zana plugin installation interface showing install options.',
    capture: 'Show Plugins → Browse with marketplace, folder, git, and npm install options.',
    aspectRatio: 'standard'
  },
  'extension-consent': {
    id: 'extension-consent',
    title: 'Confirm full trust',
    caption: 'Plugins run in-process on the server. Zana lists skills, MCP, and extra, then you confirm the install.',
    alt: 'A Zana plugin full-trust install confirm dialog.',
    capture: 'Show a full-trust install confirm that names skills and MCP servers.',
    aspectRatio: 'portrait'
  },
  'local-extension-workspace': {
    id: 'local-extension-workspace',
    title: 'Editable local plugin',
    caption: 'Keep a local source folder connected so zcc plugin dev can rebuild and reload live.',
    alt: 'A local Zana plugin source workspace connected to the desktop application.',
    capture: 'Show an editable plugin project with package.json zcc, source, and reload status.',
    aspectRatio: 'wide'
  },
  'extension-panel-result': {
    id: 'extension-panel-result',
    title: 'Your panel in Zana',
    caption: 'definePluginApp can register a React panel that runs inside the host without a core rebuild.',
    alt: 'A custom plugin panel running inside Zana Command Center.',
    capture: 'Show a small finished plugin panel mounted inside the Zana application shell.',
    aspectRatio: 'standard'
  },
  'sdk-main-module': {
    id: 'sdk-main-module',
    title: 'Server plugin API',
    caption: 'export default function plugin(zcc) receives ZccPluginApi in-process. Host-daemon tokens never reach the plugin.',
    alt: 'Plugin source code showing a Zana server plugin API call.',
    capture: 'Show a concise plugin(zcc) example next to its package.json zcc block.',
    aspectRatio: 'standard'
  }
};

export function productShot(id: ProductShotId): ProductShotDefinition {
  return PRODUCT_SHOTS[id];
}

/** Features keeps the capture-target cards even after a shot has a real `src`. */
export function productShotShowsMedia(src: string | undefined, placeholder = false): boolean {
  return Boolean(src) && !placeholder;
}
