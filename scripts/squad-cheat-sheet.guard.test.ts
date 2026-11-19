import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

const home = mkdtempSync(join(tmpdir(), 'squad-cheat-guard-'));
process.env.ZCC_DATA_DIR = home;
vi.mock('electron', () => ({ app: { getPath: () => home }, shell: {} }));

import { PersonaStore } from '../apps/server/src/services/agents/persona-store';
import { TeamStore } from '../apps/server/src/services/agents/team-store';
import { builtinSummaries, currentBlock, renderCheatSheet, spliceCheatSheet } from './squad-cheat-sheet';

const PAGE = join(__dirname, '../website/content/docs/squads-plans.md');

function builtins() {
  const teams = new TeamStore(() => []);
  const personas = new PersonaStore(() => []);
  teams.refresh();
  personas.refresh();
  return builtinSummaries(teams.list(), personas.list());
}

it('keeps the Squad plans cheat sheet in sync with the built-in Squads (run `pnpm squad-cheat-sheet`)', () => {
  const page = readFileSync(PAGE, 'utf8');
  expect(currentBlock(page)).toBe(renderCheatSheet(builtins()));
});

it('lists only built-in Squads and never orchestrator slots', () => {
  const summaries = builtins();
  expect(summaries.length).toBeGreaterThan(0);
  for (const summary of summaries) {
    expect(summary.source).toBe('builtin');
    expect(summary.slots.some((slot) => slot.personaId === 'builtin:orchestrator')).toBe(false);
  }
});

it('drops non-built-in Squads', () => {
  const user = { id: 'mine', name: 'Mine', source: 'user', slots: [{ personaId: 'x' }] };
  expect(builtinSummaries([user as never], [])).toEqual([]);
});

it('splice replaces the block and rejects a page without markers', () => {
  const page = readFileSync(PAGE, 'utf8');
  expect(spliceCheatSheet(page, currentBlock(page)!)).toBe(page);
  expect(() => spliceCheatSheet('no markers', 'x')).toThrow(/markers/);
});
