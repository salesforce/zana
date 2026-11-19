import { existsSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

const homes: string[] = [];
vi.mock('electron', () => ({ app: { getPath: () => homes.at(-1) ?? '/nonexistent' }, shell: {} }));

import { loadBuiltins } from './generate-squad-cheat-sheet';

it('loads only built-in Squads from an empty temp data dir and removes it afterwards', async () => {
  const summaries = await loadBuiltins();
  homes.push(process.env.ZCC_DATA_DIR!);
  expect(summaries.length).toBeGreaterThan(0);
  expect(summaries.every((summary) => summary.source === 'builtin')).toBe(true);
  expect(existsSync(process.env.ZCC_DATA_DIR!)).toBe(false);
});
