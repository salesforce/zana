import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupRun } from './cleanup.js';
import type { ProductHttpClient } from './http.js';
import { liveTitle, writeJournal } from './tags.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fakeHttp(failing: Set<string> = new Set()) {
  const calls: string[] = [];
  const http = {
    async request(method: string, path: string) {
      calls.push(`${method} ${path}`);
      if (failing.has(`${method} ${path}`)) throw new Error('gone');
      if (method === 'GET' && path === '/api/v1/threads') {
        return { threads: [{ id: 'listed', title: liveTitle('run-1', 'case') }, { id: 'other', title: 'unrelated' }] };
      }
      return {};
    }
  } as unknown as ProductHttpClient;
  return { http, calls };
}

describe('cleanupRun', () => {
  it('stops and then archives every thread of the run, so no provider session outlives it', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-cleanup-'));
    dirs.push(dataDir);
    writeJournal(dataDir, { runId: 'run-1', createdAt: 0, threadIds: ['journaled'], cliAgentIds: [], environmentIds: [] });
    const { http, calls } = fakeHttp(new Set(['POST /api/v1/threads/journaled/stop']));

    const result = await cleanupRun(http, dataDir, 'run-1');

    expect(result.stoppedThreads).toEqual(['listed']);
    for (const id of ['journaled', 'listed']) {
      const stop = calls.indexOf(`POST /api/v1/threads/${id}/stop`);
      const archive = calls.indexOf(`POST /api/v1/threads/${id}/archive`);
      expect(stop).toBeGreaterThanOrEqual(0);
      expect(archive).toBeGreaterThan(stop);
    }
    expect(calls.some(call => call.includes('/threads/other/'))).toBe(false);
  });

  it('keeps cleaning when an archive fails', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-cleanup-'));
    dirs.push(dataDir);
    const { http, calls } = fakeHttp(new Set(['POST /api/v1/threads/listed/archive']));

    const result = await cleanupRun(http, dataDir, 'run-1');

    expect(result.stoppedThreads).toEqual(['listed']);
    expect(calls).toContain('GET /api/v1/cli-agents');
  });
});
