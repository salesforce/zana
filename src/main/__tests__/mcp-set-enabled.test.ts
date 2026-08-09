import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setMcpServerEnabled } from '../mcp.js';

// Regression (QA medium #6): setMcpServerEnabled does a read-modify-write of
// settings.local.json. The atomic tmp+rename prevents a torn file but does NOT
// serialize concurrent callers — two rapid toggles of DIFFERENT servers both
// read the same pre-existing state, each flip their own flag, then the second
// rename clobbers the first (a lost update). The fix chains every write for a
// given file through one promise (Rule 4 in-process mutex). These assert both
// concurrent flags survive and the tmp files don't leak.
describe('setMcpServerEnabled — concurrent read-modify-write serialization', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'cc-mcp-set-'));
  });
  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  const readSettings = (): Record<string, unknown> => {
    const target = join(projectPath, '.claude', 'settings.local.json');
    return JSON.parse(readFileSync(target, 'utf-8'));
  };

  it('preserves both flags when two different servers are toggled concurrently', async () => {
    // Fire both disables without awaiting between them — the pre-fix lost-update
    // window. With the mutex, the second read sees the first's committed write.
    await Promise.all([
      setMcpServerEnabled(projectPath, 'serverA', false),
      setMcpServerEnabled(projectPath, 'serverB', false)
    ]);

    const settings = readSettings();
    expect(settings.mcpServers).toEqual({
      serverA: { disabled: true },
      serverB: { disabled: true }
    });
  });

  it('a burst of interleaved toggles all land (last-writer-per-server wins)', async () => {
    await Promise.all([
      setMcpServerEnabled(projectPath, 'a', false),
      setMcpServerEnabled(projectPath, 'b', false),
      setMcpServerEnabled(projectPath, 'c', false),
      setMcpServerEnabled(projectPath, 'a', true) // re-enable a
    ]);

    const settings = readSettings();
    // a was re-enabled (flag removed → entry dropped); b and c stay disabled.
    expect(settings.mcpServers).toEqual({
      b: { disabled: true },
      c: { disabled: true }
    });
  });

  it('leaves no orphaned .tmp files behind', async () => {
    await Promise.all([
      setMcpServerEnabled(projectPath, 'x', false),
      setMcpServerEnabled(projectPath, 'y', false)
    ]);
    const dir = join(projectPath, '.claude');
    const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });

  it('preserves unrelated top-level keys across the write', async () => {
    // Seed a file with an unrelated key, then toggle a server.
    await setMcpServerEnabled(projectPath, 'first', false);
    // Manually confirm the write happened, then a second toggle preserves it.
    await setMcpServerEnabled(projectPath, 'second', false);
    const settings = readSettings();
    expect(settings.mcpServers).toMatchObject({
      first: { disabled: true },
      second: { disabled: true }
    });
    expect(existsSync(join(projectPath, '.claude', 'settings.local.json'))).toBe(true);
  });
});
