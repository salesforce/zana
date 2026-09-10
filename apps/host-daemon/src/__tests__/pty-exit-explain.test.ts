import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Fake IPty that STORES the onData/onExit callbacks so a test can push output
// (to populate the replay backlog) and then trigger an exit with a chosen code.
interface FakeProc {
  pid: number;
  dataCb?: (d: string) => void;
  diagnosticDataCb?: (d: string) => void;
  exitCb?: (e: { exitCode: number }) => void;
  write: (data: string) => void;
  onData: (cb: (d: string) => void) => void;
  onExit: (cb: (e: { exitCode: number }) => void) => void;
  resize: () => void;
  kill: () => void;
  destroy: () => void;
}

const spawned: FakeProc[] = [];
let nextPid = 7000;

vi.mock('node-pty', () => ({
  spawn: () => {
    const proc: FakeProc = {
      pid: nextPid++,
      write() {},
      onData(cb) {
        if (!this.dataCb) this.dataCb = cb;
        else this.diagnosticDataCb = cb;
      },
      onExit(cb) {
        this.exitCb = cb;
      },
      resize() {},
      kill() {},
      destroy() {}
    };
    spawned.push(proc);
    return proc;
  }
}));

vi.mock('../mcp-config.js', () => ({
  ensureMcpConfigForProjectSync: (id: string) => `/tmp/${id}/.mcp.json`
}));

import { PtyManager } from '../pty.js';
import type { AppConfig } from '@zana-ai/zcc-domain/product';

const CONFIG: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

const MODEL_GONE =
  'Error: ProviderModelNotFoundError: model llmgw/aisuite-old not found on provider';

describe('PtyManager.finalizeExit — provider exit explanation', () => {
  beforeEach(() => {
    spawned.length = 0;
    nextPid = 7000;
  });

  const capture = (mgr: PtyManager) => {
    const events: Array<{ kind: 'data' | 'exit'; payload: string }> = [];
    mgr.on('data', (_id: string, data: string) => events.push({ kind: 'data', payload: data }));
    mgr.on('exit', (_id: string, code: number) => events.push({ kind: 'exit', payload: String(code) }));
    return events;
  };

  it('surfaces an OpenCode exit-64 model-drift message as a data line before exit', () => {
    const mgr = new PtyManager();
    const events = capture(mgr);
    const session = mgr.create({ projectId: 'p1', profile: 'opencode', cwd: '/tmp', cols: 80, rows: 24, config: CONFIG });
    const proc = spawned[0];

    // The crash signature lands in the session's output tail...
    proc.dataCb?.(MODEL_GONE);
    // ...then OpenCode dies with exit 64.
    proc.exitCb?.({ exitCode: 64 });

    const dataPayloads = events.filter((e) => e.kind === 'data').map((e) => e.payload);
    const explanation = dataPayloads.find((p) => p.includes('no longer available on the gateway'));
    expect(explanation).toBeTruthy();
    // The explanation is emitted BEFORE the exit event (red ANSI framing).
    const explainIdx = events.findIndex((e) => e.kind === 'data' && e.payload.includes('no longer available'));
    const exitIdx = events.findIndex((e) => e.kind === 'exit');
    expect(explainIdx).toBeGreaterThanOrEqual(0);
    expect(exitIdx).toBeGreaterThan(explainIdx);
    expect(explanation).toContain('\x1b[31m');
    expect(mgr.getSession(session.id)).toBeNull();
  });

  it('stays silent on a clean exit (code 0)', () => {
    const mgr = new PtyManager();
    const events = capture(mgr);
    mgr.create({ projectId: 'p1', profile: 'opencode', cwd: '/tmp', cols: 80, rows: 24, config: CONFIG });
    const proc = spawned[0];
    proc.dataCb?.(MODEL_GONE);
    proc.exitCb?.({ exitCode: 0 });

    const explanation = events.find((e) => e.kind === 'data' && e.payload.includes('no longer available'));
    expect(explanation).toBeUndefined();
  });

  it('stays silent for a non-opencode profile on exit-64 (no provider explanation)', () => {
    const mgr = new PtyManager();
    const events = capture(mgr);
    mgr.create({ projectId: 'p1', profile: 'shell', cwd: '/tmp', cols: 80, rows: 24, config: CONFIG });
    const proc = spawned[0];
    proc.dataCb?.(MODEL_GONE);
    proc.exitCb?.({ exitCode: 64 });

    const explanation = events.find((e) => e.kind === 'data' && e.payload.includes('no longer available'));
    expect(explanation).toBeUndefined();
  });

  it('persists opted-in spawn, output, signal, and exit diagnostics', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-pty-diagnostic-'));
    process.env.ZCC_DEBUG_YOLO_CAPTURE = dir;
    try {
      const mgr = new PtyManager();
      const session = mgr.create({ projectId: 'p1', profile: 'opencode', cwd: '/tmp', cols: 80, rows: 24, config: CONFIG });
      const proc = spawned[0];
      proc.dataCb?.('startup failed');
      proc.diagnosticDataCb?.('startup failed');
      proc.exitCb?.({ exitCode: 17, signal: 9 } as { exitCode: number });

      const events = readFileSync(join(dir, `${session.id}.jsonl`), 'utf8')
        .trim().split('\n').map((line) => JSON.parse(line));
      expect(events[0]).toMatchObject({ event: 'spawn', command: 'opencode', cwd: '/tmp', profile: 'opencode' });
      expect(events).toContainEqual(expect.objectContaining({ event: 'data', data: 'startup failed' }));
      expect(events.at(-1)).toMatchObject({ event: 'exit', exitCode: 17, signal: 9 });
    } finally {
      delete process.env.ZCC_DEBUG_YOLO_CAPTURE;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
