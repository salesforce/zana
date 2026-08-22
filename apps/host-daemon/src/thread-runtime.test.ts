import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { HostCommandError } from './host-command-error.js';

const creates: Array<{
  preallocatedSessionId?: string;
  profile: string;
  cwd: string;
  extraArgs?: string[];
}> = [];
const replies: Array<{ id: string; text: string }> = [];
const resizes: Array<{ id: string; cols: number; rows: number }> = [];

const writes: Array<{ id: string; data: string }> = [];
const closes: string[] = [];

vi.mock('./pty.js', () => ({
  PtyManager: class {
    setProjectRoots(): void {}
    on(): this { return this; }
    removeAllListeners(): this { return this; }
    create(opts: {
      preallocatedSessionId?: string;
      profile: string;
      cwd: string;
      extraArgs?: string[];
      remote?: unknown;
      reconnectTmuxId?: string;
      title?: string;
    }) {
      creates.push(opts);
      return { id: opts.preallocatedSessionId ?? 'sid' };
    }
    reply(id: string, text: string): boolean {
      replies.push({ id, text });
      return true;
    }
    resize(id: string, cols: number, rows: number): void {
      resizes.push({ id, cols, rows });
    }
    write(id: string, data: string): void {
      writes.push({ id, data });
    }
    close(id: string): void {
      closes.push(id);
    }
    killAll(): void {}
  }
}));

import { createPtyThreadAdapter } from './thread-runtime.js';

const config = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
} as AppConfig;

describe('pty thread adapter', () => {
  it('spawns through PtyManager.create with a seeded prompt', async () => {
    creates.length = 0;
    replies.length = 0;
    resizes.length = 0;
    writes.length = 0;
    closes.length = 0;
    const cwd = mkdtempSync(join(tmpdir(), 'zcc-thread-rt-'));
    const threadId = randomUUID();
    const adapter = createPtyThreadAdapter({
      loadConfig: () => config,
      emit: () => {}
    });
    await adapter.startWork({
      threadId,
      projectId: 'proj-1',
      providerId: 'claude',
      cwd,
      input: ['review this']
    });
    expect(creates).toEqual([expect.objectContaining({
      preallocatedSessionId: threadId,
      profile: 'claude',
      cwd,
      extraArgs: ['review this']
    })]);
    await adapter.submitTurn({ threadId, input: ['continue'] });
    expect(replies).toEqual([{ id: threadId, text: 'continue' }]);
    await adapter.resizeWork({ threadId, cols: 120, rows: 40 });
    expect(resizes).toEqual([{ id: threadId, cols: 120, rows: 40 }]);
    await adapter.writeWork({ threadId, data: '\x03' });
    expect(writes).toEqual([{ id: threadId, data: '\x03' }]);
    await adapter.stopWork({ threadId });
    expect(closes).toEqual([threadId]);
    adapter.dispose();
  });

  it('rejects an unknown provider before spawn', async () => {
    const adapter = createPtyThreadAdapter({
      loadConfig: () => config,
      emit: () => {}
    });
    await expect(adapter.startWork({
      threadId: randomUUID(),
      projectId: 'proj-1',
      providerId: 'not-a-harness',
      cwd: mkdtempSync(join(tmpdir(), 'zcc-thread-rt-')),
      input: ['hello']
    })).rejects.toMatchObject({ code: 'provider_unavailable' });
    adapter.dispose();
  });

  it('starts a remote reconnect through PtyManager.create', async () => {
    creates.length = 0;
    const cwd = mkdtempSync(join(tmpdir(), 'zcc-thread-rt-remote-'));
    const threadId = randomUUID();
    const adapter = createPtyThreadAdapter({
      loadConfig: () => config,
      emit: () => {}
    });
    await adapter.startWork({
      threadId,
      projectId: 'proj-1',
      providerId: 'claude',
      cwd,
      input: [],
      remote: { host: 'box.example', user: 'me', remotePath: '/src' },
      reconnectTmuxId: threadId,
      resume: true
    });
    expect(creates).toEqual([expect.objectContaining({
      preallocatedSessionId: threadId,
      remote: { host: 'box.example', user: 'me', remotePath: '/src' },
      reconnectTmuxId: threadId
    })]);
    adapter.dispose();
  });

  it('starts a shell with an empty prompt and writes raw bytes', async () => {
    creates.length = 0;
    writes.length = 0;
    const cwd = mkdtempSync(join(tmpdir(), 'zcc-thread-rt-shell-'));
    const threadId = randomUUID();
    const adapter = createPtyThreadAdapter({
      loadConfig: () => config,
      emit: () => {}
    });
    await adapter.startWork({
      threadId,
      projectId: 'proj-1',
      providerId: 'shell',
      cwd,
      input: []
    });
    expect(creates[0]).toMatchObject({
      profile: 'shell',
      extraArgs: []
    });
    adapter.dispose();
  });

  it('strips denied extraArgs before they reach PtyManager.create', async () => {
    creates.length = 0;
    const cwd = mkdtempSync(join(tmpdir(), 'zcc-thread-rt-deny-'));
    const adapter = createPtyThreadAdapter({
      loadConfig: () => config,
      emit: () => {}
    });
    await adapter.startWork({
      threadId: randomUUID(),
      projectId: 'proj-1',
      providerId: 'claude',
      cwd,
      input: ['do work'],
      extraArgs: ['--model', 'opus', '--dangerously-skip-permissions', '--mcp-config', '/tmp/evil.json']
    });
    expect(creates[0]?.extraArgs).toEqual(['--model', 'opus', 'do work']);
    adapter.dispose();
  });

  it('rejects a turn for a thread that was never started', async () => {
    const adapter = createPtyThreadAdapter({
      loadConfig: () => config,
      emit: () => {}
    });
    await expect(adapter.submitTurn({
      threadId: randomUUID(),
      input: ['hello']
    })).rejects.toBeInstanceOf(HostCommandError);
    await expect(adapter.resizeWork({
      threadId: randomUUID(),
      cols: 80,
      rows: 24
    })).rejects.toBeInstanceOf(HostCommandError);
    adapter.dispose();
  });
});
