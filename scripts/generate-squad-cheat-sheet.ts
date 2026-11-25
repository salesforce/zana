/**
 * Regenerate the per-Squad cheat sheet in website/content/docs/squads-plans.md from the BUILT-IN Squad definitions.
 * Usage: pnpm squad-cheat-sheet [--check]. Reads no user, Project or plugin Squads: the stores run against an empty
 * temporary data dir and only `source: 'builtin'` rows are kept.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks, type ResolveHookSync, type LoadHookSync } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { builtinSummaries, currentBlock, renderCheatSheet, spliceCheatSheet } from './squad-cheat-sheet.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PAGE = join(ROOT, 'website/content/docs/squads-plans.md');
const STUB_URL = 'zana-stub:electron';

/** The stores import `electron` for a data-dir lookup only; these hooks serve a stub pointing at `home`. */
export function electronStubHooks(home: string): { resolve: ResolveHookSync; load: LoadHookSync } {
  const stub = `export const app = { getPath: () => ${JSON.stringify(home)} }; export const shell = {}; export default { app, shell };`;
  return {
    resolve: (specifier, context, next) => specifier === 'electron' ? { url: STUB_URL, shortCircuit: true } : next(specifier, context),
    load: (url, context, next) => url === STUB_URL ? { format: 'module', source: stub, shortCircuit: true } : next(url, context)
  };
}

export async function loadBuiltins() {
  const home = mkdtempSync(join(tmpdir(), 'squad-cheat-sheet-'));
  process.env.ZCC_DATA_DIR = home;
  registerHooks(electronStubHooks(home));
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

interface CheatSheetIo { read: (path: string) => string; write: (path: string, text: string) => void; log: (line: string) => void; error: (line: string) => void }
const fsIo: CheatSheetIo = { read: (path) => readFileSync(path, 'utf8'), write: writeFileSync, log: console.log, error: console.error };

/** Check or rewrite the page. Returns the process exit code. */
export function runCheatSheet(args: readonly string[], block: string, io: CheatSheetIo = fsIo, page = PAGE): number {
  const text = io.read(page);
  if (args.includes('--check')) {
    if (currentBlock(text) !== block) { io.error('Cheat sheet is stale. Run: pnpm squad-cheat-sheet'); return 1; }
    io.log('Squad cheat sheet is up to date.');
    return 0;
  }
  io.write(page, spliceCheatSheet(text, block));
  io.log('Squad cheat sheet written to website/content/docs/squads-plans.md');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(runCheatSheet(process.argv.slice(2), renderCheatSheet(await loadBuiltins())));
}
