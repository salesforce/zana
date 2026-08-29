import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readMcpPort, writeMcpPort } from '@zana-ai/zcc-server';

describe('MCP port store', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function path(): string {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-mcp-port-'));
    dirs.push(dir);
    return join(dir, 'nested', 'port.json');
  }

  it('atomically persists and reads a valid listener port', () => {
    const file = path();
    writeMcpPort(file, 49_321);
    expect(readMcpPort(file)).toBe(49_321);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ port: 49_321 });
  });

  it('ignores missing, corrupt, privileged, and out-of-range ports', () => {
    const file = path();
    expect(readMcpPort(file)).toBeUndefined();
    mkdirSync(join(file, '..'), { recursive: true });
    for (const value of ['bad', { port: 80 }, { port: 65_536 }, { port: 12.5 }]) {
      writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
      expect(readMcpPort(file)).toBeUndefined();
    }
  });
});
