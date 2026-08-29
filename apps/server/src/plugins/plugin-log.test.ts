import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendPluginLogLine, readPluginLogTail } from './plugin-log.js';

describe('plugin logs', () => {
  it('appends JSONL and returns the last N lines', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-plugin-log-'));
    try {
      appendPluginLogLine(dataDir, 'hello', 'info', 'loaded');
      appendPluginLogLine(dataDir, 'hello', 'warn', 'slow');
      const lines = await readPluginLogTail(dataDir, 'hello', 1);
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toMatchObject({ level: 'warn', message: 'slow' });
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
