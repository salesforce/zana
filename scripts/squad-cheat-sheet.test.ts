import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CHEAT_SHEET_END, CHEAT_SHEET_START, builtinSummaries, currentBlock, renderCheatSheet, spliceCheatSheet } from './squad-cheat-sheet';
import { electronStubHooks, runCheatSheet } from './generate-squad-cheat-sheet';

describe('renderCheatSheet', () => {
  it('falls back when a slot has no label, level, description or usable role names', () => {
    const block = renderCheatSheet([{ id: 'sq', name: 'Plain', slotCount: 1, slots: [{ personaId: 'p|1', roles: ['  ', 'qa'] }] }]);
    expect(block).toContain('Squad id: `sq`.\n');
    expect(block).toContain('| p\\|1 | not set | any | `qa`, `p\\|1` |');
  });

  it('dedupes trimmed names and maps a level to its Execution class', () => {
    const block = renderCheatSheet([{ id: 'sq', name: 'Rich', description: 'Does it.', slotCount: 1, slots: [{ personaId: 'eng', label: 'Engineer ', roles: ['Engineer', 'dev'], level: 'high' }] }]);
    expect(block).toContain('Squad id: `sq`. Does it.');
    expect(block).toContain('| Engineer  | high | Expert | `Engineer`, `dev`, `eng` |');
  });
});

describe('builtinSummaries', () => {
  it('keeps built-in personas, drops the orchestrator slot and Squads left empty, and sorts by name', () => {
    const personas = [{ id: 'w', source: 'builtin', modelLevel: 'low' as const }, { id: 'u', source: 'user', modelLevel: 'high' as const }];
    const summaries = builtinSummaries([
      { id: 'b', name: 'Beta', source: 'builtin', slots: [{ personaId: 'w' }, { personaId: 'u' }] },
      { id: 'a', name: 'Alpha', source: 'builtin', orchestratorPersonaId: 'o', slots: [{ personaId: 'o' }, { personaId: 'w' }] },
      { id: 'c', name: 'Only orchestrator', source: 'builtin', orchestratorPersonaId: 'o', slots: [{ personaId: 'o' }] }
    ], personas);
    expect(summaries.map((s) => s.id)).toEqual(['a', 'b']);
    expect(summaries[1].slots).toEqual([{ personaId: 'w', level: 'low' }, { personaId: 'u' }]);
  });
});

describe('markers', () => {
  const block = `${CHEAT_SHEET_START}\nX\n${CHEAT_SHEET_END}`;
  it('treats an end marker before the start marker as missing', () => {
    const reversed = `${CHEAT_SHEET_END}\n${CHEAT_SHEET_START}`;
    expect(currentBlock(reversed)).toBeUndefined();
    expect(currentBlock('nothing')).toBeUndefined();
    expect(() => spliceCheatSheet(reversed, block)).toThrow(/markers/);
  });
  it('splices a new block between the markers', () => {
    expect(spliceCheatSheet(`a\n${block}\nb`, `${CHEAT_SHEET_START}\nY\n${CHEAT_SHEET_END}`)).toBe(`a\n${CHEAT_SHEET_START}\nY\n${CHEAT_SHEET_END}\nb`);
  });
});

describe('runCheatSheet', () => {
  const block = `${CHEAT_SHEET_START}\nfresh\n${CHEAT_SHEET_END}`;
  const io = () => ({ read: vi.fn(), write: vi.fn(), log: vi.fn(), error: vi.fn() });

  it('--check passes when the page is current and fails when it is stale', () => {
    const ok = io();
    ok.read.mockReturnValue(`intro\n${block}\n`);
    expect(runCheatSheet(['--check'], block, ok, '/page.md')).toBe(0);
    expect(ok.log).toHaveBeenCalledWith('Squad cheat sheet is up to date.');
    const stale = io();
    stale.read.mockReturnValue(`${CHEAT_SHEET_START}\nold\n${CHEAT_SHEET_END}`);
    expect(runCheatSheet(['--check'], block, stale, '/page.md')).toBe(1);
    expect(stale.error).toHaveBeenCalledWith(expect.stringContaining('stale'));
    expect(stale.write).not.toHaveBeenCalled();
  });

  it('rewrites the page without --check', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cheat-run-'));
    try {
      const page = join(dir, 'page.md');
      writeFileSync(page, `top\n${CHEAT_SHEET_START}\nold\n${CHEAT_SHEET_END}\nend`);
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      expect(runCheatSheet([], block, undefined, page)).toBe(0);
      log.mockRestore();
      expect(readFileSync(page, 'utf8')).toBe(`top\n${block}\nend`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('electronStubHooks', () => {
  const hooks = electronStubHooks('/tmp/home');
  const next = vi.fn(() => ({ url: 'next', shortCircuit: true }) as never);

  it('resolves only `electron` to the stub and serves it as a module pointing at the home dir', () => {
    expect(hooks.resolve('electron', {} as never, next)).toEqual({ url: 'zana-stub:electron', shortCircuit: true });
    expect(next).not.toHaveBeenCalled();
    const loaded = hooks.load('zana-stub:electron', {} as never, next) as { format: string; source: string };
    expect(loaded.format).toBe('module');
    expect(loaded.source).toContain('"/tmp/home"');
  });

  it('passes every other specifier and url through', () => {
    hooks.resolve('node:fs', {} as never, next);
    hooks.load('file:///x.js', {} as never, next);
    expect(next).toHaveBeenCalledTimes(2);
  });
});
