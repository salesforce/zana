import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CapabilitySurfaceKey } from '@zana-ai/zcc-domain';
import { capabilityRegistry } from './capability-registry.js';

const here = dirname(fileURLToPath(import.meta.url));
const doc = readFileSync(join(here, '..', '..', '..', '..', 'docs', 'extensions-sdk-reference.md'), 'utf8');

const COLUMNS = ['surface', 'harness', 'headless', 'hookBase', 'message-admission', 'lifecycle-delivery', 'tool-before-native', 'tool-after-native', 'interactions'] as const;
type Row = Record<(typeof COLUMNS)[number], string>;

function parseMatrix(): Row[] {
  const lines = doc.split('\n');
  const start = lines.findIndex(line => line.startsWith('| Surface | Harness | Headless | Hook base |'));
  if (start < 0) throw new Error('capability matrix not found in docs/extensions-sdk-reference.md');
  const rows: Row[] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    expect(cells, line).toHaveLength(COLUMNS.length);
    rows.push(Object.fromEntries(COLUMNS.map((column, index) => [column, cells[index]!])) as Row);
  }
  return rows;
}

const flags = (cell: string): boolean[] => (cell === 'any' ? [false, true] : [cell === 'yes']);

function keysOf(row: Row): CapabilitySurfaceKey[] {
  const surface = row.surface as 'pty' | 'modern';
  return row.harness.split(',').map(harness => harness.trim()).flatMap(harness =>
    flags(row.headless).flatMap(headless =>
      // Modern sessions are always registered with a hook base.
      (surface === 'modern' ? [true] : flags(row.hookBase)).map(hookBase => ({ surface, harness, headless, hookBase }))));
}

const rows = parseMatrix();

describe('capability matrix in the SDK reference matches the registry', () => {
  it('lists rows', () => {
    expect(rows.length).toBeGreaterThan(5);
  });

  it('matches every described cell', () => {
    for (const row of rows) for (const key of keysOf(row)) {
      const described = capabilityRegistry.describe(key);
      for (const id of ['message-admission', 'lifecycle-delivery', 'tool-before-native', 'tool-after-native', 'interactions'] as const) {
        const cell = row[id];
        const descriptor = described.find(item => item.id === id)!;
        const where = `${JSON.stringify(key)} ${id}`;
        expect(descriptor.available, where).toBe(cell !== 'unavailable');
        if (id === 'lifecycle-delivery') {
          expect(descriptor.reason?.includes('never reports active or idle') ?? false, where).toBe(cell === 'created and exit only');
        }
      }
    }
  });

  it('covers every key the registry wires', () => {
    const covered = new Set(rows.flatMap(keysOf).map(key => JSON.stringify([key.surface, key.harness, key.headless, key.hookBase])));
    const modern = ['claude-code', 'codex', 'pi', 'acp', 'acp-opencode', 'acp-cursor'];
    const pty = ['claude', 'codex', 'opencode', 'cursor', 'pi', 'shell'];
    for (const headless of [false, true]) {
      for (const harness of modern) expect(covered, `modern ${harness}`).toContain(JSON.stringify(['modern', harness, headless, true]));
      for (const harness of pty) for (const hookBase of [false, true]) {
        expect(covered, `pty ${harness} headless=${headless} hookBase=${hookBase}`).toContain(JSON.stringify(['pty', harness, headless, hookBase]));
      }
    }
  });
});
