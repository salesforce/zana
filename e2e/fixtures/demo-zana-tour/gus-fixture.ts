/**
 * The GUS plugin for the Zana tour, on sample data. The renderer is copied from
 * the GUS checkout (never modified there); the server is a fixture that serves
 * made-up tickets, so no Salesforce credentials or `sf` calls are involved.
 */
import { cpSync, existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlugin } from '../../../packages/plugin-build/src/build-plugin.js';

const here = dirname(fileURLToPath(import.meta.url));
const zccVersion = () => JSON.parse(readFileSync(join(here, '..', '..', '..', 'package.json'), 'utf8')).version as string;

const SERVER = `
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const sprint = { id: 'sprint-42', name: 'Atlas 42', startDate: day(-6), endDate: day(8), openCount: 7, teamId: 'team-atlas', teamName: 'Atlas Web' };
const base = { sprintId: sprint.id, sprintName: sprint.name, teamId: 'team-atlas', teamName: 'Atlas Web', assigneeId: 'me', assignee: 'Alex Morgan', author: 'Sam Lee', productTag: 'Atlas Site', lastModified: new Date().toISOString() };
const tickets = [
  { id: 'a01', name: 'W-18402117', subject: 'Checkout button overlaps the footer on small screens', status: 'New', priority: 'P1', type: 'Bug', storyPoints: 2 },
  { id: 'a02', name: 'W-18402254', subject: 'Add annual billing toggle to the pricing page', status: 'In Progress', priority: 'P2', type: 'User Story', storyPoints: 5 },
  { id: 'a03', name: 'W-18402301', subject: 'Search results lose their filters after paging', status: 'In Progress', priority: 'P1', type: 'Bug', storyPoints: 3 },
  { id: 'a04', name: 'W-18402388', subject: 'Translate the onboarding emails into French', status: 'Waiting', priority: 'P3', type: 'User Story', storyPoints: 3 },
  { id: 'a05', name: 'W-18402412', subject: 'Single sign-on for the admin console', status: 'Ready for Review', priority: 'P2', type: 'User Story', storyPoints: 8 },
  { id: 'a06', name: 'W-18402476', subject: 'Slow dashboard load for large accounts', status: 'Waiting', priority: 'P1', type: 'Bug', storyPoints: 5 },
  { id: 'a07', name: 'W-18402533', subject: 'Dark mode for the docs site', status: 'New', priority: 'P3', type: 'User Story', storyPoints: 3 },
  { id: 'a08', name: 'W-18402590', subject: 'Fix broken links in the API reference', status: 'Fixed', priority: 'P2', type: 'Bug', storyPoints: 1 },
  { id: 'a09', name: 'W-18402644', subject: 'Release notes page for version 3.2', status: 'Completed', priority: 'P3', type: 'User Story', storyPoints: 2 }
].map((ticket) => ({ ...base, ...ticket }));
const details = '<p>On phones narrower than 380px the sticky <b>Checkout</b> button covers the footer links, so customers cannot reach Terms or Support.</p>'
  + '<p><b>Steps:</b> open the cart on an iPhone SE, scroll to the bottom.</p><p><b>Expected:</b> the button sits above the footer.</p>';

export default function plugin(zcc) {
  const stored = new Map();
  for (const [name, run] of Object.entries({
    whoami: () => ({ userId: 'me', username: 'alex.morgan@example.com', instanceUrl: 'https://gus.example.invalid' }),
    listSprints: () => [sprint],
    listTeams: () => [{ id: 'team-atlas', name: 'Atlas Web', openCount: 7 }],
    watchList: () => ({ sprints: [], teams: [], work: [] }),
    listWork: () => tickets, listSprintWork: () => tickets, listBacklog: () => tickets, listAutoForward: () => [],
    listProjects: () => zcc.sdk.projects.list(), listPersonas: () => [],
    getChatter: () => [], getAttachments: () => [], getFiles: () => [],
    getWork: (id) => ({ ...(tickets.find((ticket) => ticket.id === id) ?? tickets[0]), detailsHtml: details }),
    storageGet: (key) => stored.get(key), storageSet: ({ key, value }) => { stored.set(key, value); return { ok: true }; }
  })) zcc.rpc.method(name, run);
}
`;

/** Copy the GUS renderer into `dir`, with the sample-data server, and build it. */
export async function prepareGusFixture(source: string, dir: string): Promise<void> {
  for (const part of ['app.tsx', 'src', 'lib', 'css.d.ts', 'tsconfig.json']) {
    if (existsSync(join(source, part))) cpSync(join(source, part), join(dir, part), { recursive: true, filter: (path) => !/\.test\.tsx?$/.test(path) });
  }
  symlinkSync(join(source, 'node_modules'), join(dir, 'node_modules'));
  writeFileSync(join(dir, 'server.ts'), SERVER);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'zcc-plugin-gus-demo', version: '0.2.0', type: 'module',
    engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
    zcc: { name: 'GUS', description: 'Your GUS sprint board and tickets, with an agent one click away', branding: { icon: 'Bug' }, server: './server.ts', app: './app.tsx' }
  }, null, 2));
  await rebuildGusFixture(dir);
}

/** Build the plugin and point the manifest at the compiled entries. */
export async function rebuildGusFixture(dir: string): Promise<void> {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  manifest.zcc.app = './app.tsx';
  manifest.zcc.server = './server.ts';
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2));
  await buildPlugin(dir, zccVersion());
  manifest.zcc.app = './app.js';
  manifest.zcc.server = './server.mjs';
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2));
}

function replaceOnce(text: string, anchor: string, next: string): string {
  if (text.split(anchor).length !== 2) throw new Error(`GusPanel anchor not found once: ${anchor.slice(0, 40)}`);
  return text.replace(anchor, next);
}

/** The agent's change: a Dashboard tab beside My work and Backlog. Returns the files to write. */
export function dashboardChange(dir: string): Array<{ path: string; content: string }> {
  let panel = readFileSync(join(dir, 'src', 'app', 'GusPanel.tsx'), 'utf8');
  panel = replaceOnce(panel, "type PanelMode = 'work' | 'backlog' | 'cdc';", "type PanelMode = 'work' | 'backlog' | 'cdc' | 'dashboard';");
  panel = replaceOnce(panel, "import { CdcPanel } from './CdcPanel';", "import { CdcPanel } from './CdcPanel';\nimport { GusDashboard } from './GusDashboard';");
  panel = replaceOnce(panel, '            Backlog\n          </button>\n', `            Backlog
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'dashboard'}
            className={\`gus-mode-tab \${mode === 'dashboard' ? 'active' : ''}\`}
            onClick={() => selectMode('dashboard')}
          >
            Dashboard
          </button>
`);
  panel = replaceOnce(panel, '      <div\n        className="gus-body"', `      {mode === 'dashboard' ? (
        <GusDashboard items={items} sprint={currentSprint} identity={identity} onOpen={openItem} />
      ) : (
      <div
        className="gus-body"`);
  panel = replaceOnce(panel, '      </div>\n\n      {compact && filtersOpen', '      </div>\n      )}\n\n      {compact && filtersOpen');
  return [
    { path: join(dir, 'src', 'app', 'GusDashboard.tsx'), content: readFileSync(join(here, 'GusDashboard.tsx'), 'utf8') },
    { path: join(dir, 'src', 'app', 'GusPanel.tsx'), content: panel }
  ];
}
