/**
 * Regenerate the per-Squad cheat sheet in website/content/docs/squads-plans.md from the BUILT-IN Squad definitions.
 * Usage: pnpm squad-cheat-sheet [--check]. Reads no user, Project or plugin Squads: the stores run against an empty
 * temporary data dir and only `source: 'builtin'` rows are kept.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { builtinSummaries, currentBlock, renderCheatSheet, spliceCheatSheet } from './squad-cheat-sheet.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PAGE = join(ROOT, 'website/content/docs/squads-plans.md');

/** The stores import `electron` for a data-dir lookup only; serve them a stub pointing at an empty dir. */
export async function loadBuiltins() {
  const home = mkdtempSync(join(tmpdir(), 'squad-cheat-sheet-'));
  process.env.ZCC_DATA_DIR = home;
  const stub = `export const app = { getPath: () => ${JSON.stringify(home)} }; export const shell = {}; export default { app, shell };`;
  registerHooks({
    resolve(specifier, context, next) {
      return specifier === 'electron' ? { url: 'zana-stub:electron', shortCircuit: true } : next(specifier, context);
    },
    load(url, context, next) {
      return url === 'zana-stub:electron' ? { format: 'module', source: stub, shortCircuit: true } : next(url, context);
    }
  });
  try {
    const { TeamStore } = await import('../apps/server/src/services/agents/team-store.js');
    const { PersonaStore } = await import('../apps/server/src/services/agents/persona-store.js');
    const teams = new TeamStore(() => []);
    const personas = new PersonaStore(() => []);
    teams.refresh();
    personas.refresh();
    return builtinSummaries(teams.list(), personas.list());
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const block = renderCheatSheet(await loadBuiltins());
  const page = readFileSync(PAGE, 'utf8');
  if (process.argv.includes('--check')) {
    if (currentBlock(page) !== block) { console.error('Cheat sheet is stale. Run: pnpm squad-cheat-sheet'); process.exit(1); }
    console.log('Squad cheat sheet is up to date.');
  } else {
    writeFileSync(PAGE, spliceCheatSheet(page, block));
    console.log('Squad cheat sheet written to website/content/docs/squads-plans.md');
  }
  process.exit(0);
}
