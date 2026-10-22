import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Fake node-pty: record writes so no real shell is spawned.
interface FakeProc {
  pid: number;
  writes: string[];
  write: (data: string) => void;
  onData: (cb: (d: string) => void) => void;
  onExit: (cb: (e: { exitCode: number }) => void) => void;
  resize: () => void;
  kill: () => void;
}

const spawned: FakeProc[] = [];

vi.mock('node-pty', () => ({
  spawn: () => {
    const proc: FakeProc = {
      pid: 2000 + spawned.length,
      writes: [],
      write(data: string) {
        this.writes.push(data);
      },
      onData() {},
      onExit() {},
      resize() {},
      kill() {}
    };
    spawned.push(proc);
    return proc;
  }
}));

vi.mock('../mcp-config.js', () => ({
  ensureMcpConfigForProjectSync: (id: string) => `/tmp/${id}/.mcp.json`,
  alwaysOnPluginMcpAllowlist: () => []
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

function setup() {
  const mgr = new PtyManager();
  const session = mgr.create({ projectId: 'p1', profile: 'shell', cwd: '/tmp', cols: 80, rows: 24, config: CONFIG });
  return { mgr, id: session.id, proc: spawned[spawned.length - 1], get: () => mgr.getSession(session.id)! };
}

describe('PtyManager.write — key-input and draft tracking', () => {
  beforeEach(() => {
    spawned.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mouse and focus reports stamp lastInputAt but leave lastKeyInputAt and draftPending untouched', () => {
    const { mgr, id, proc, get } = setup();
    mgr.write(id, '\x1b[<35;10;4M');
    mgr.write(id, '\x1b[I');
    mgr.write(id, '\x1b[O');
    mgr.write(id, '\x1b[M #!');
    expect(get().lastInputAt).toBe(1_000);
    expect(get().lastKeyInputAt).toBeUndefined();
    expect(get().draftPending).toBeUndefined();
    // Every byte is still forwarded to the pty.
    expect(proc.writes).toEqual(['\x1b[<35;10;4M', '\x1b[I', '\x1b[O', '\x1b[M #!']);
  });

  it('mouse motion after typing does not move lastKeyInputAt or clear the draft', () => {
    const { mgr, id, get } = setup();
    mgr.write(id, 'fix the');
    expect(get().lastKeyInputAt).toBe(1_000);
    expect(get().draftPending).toBe(true);

    vi.setSystemTime(5_000);
    mgr.write(id, '\x1b[<35;11;4M\x1b[<35;12;4M');
    mgr.write(id, '\x1b[O');
    expect(get().lastInputAt).toBe(5_000);
    expect(get().lastKeyInputAt).toBe(1_000);
    expect(get().draftPending).toBe(true);
  });

  it('Enter clears the draft and stamps lastKeyInputAt', () => {
    const { mgr, id, get } = setup();
    mgr.write(id, 'hello');
    vi.setSystemTime(2_000);
    mgr.write(id, '\r');
    expect(get().draftPending).toBe(false);
    expect(get().lastKeyInputAt).toBe(2_000);
  });

  it('backspacing a draft to empty clears it, keystroke by keystroke', () => {
    const { mgr, id, get } = setup();
    for (const ch of 'ab') mgr.write(id, ch);
    mgr.write(id, '\x7f');
    expect(get().draftPending).toBe(true);
    mgr.write(id, '\x7f');
    expect(get().draftPending).toBe(false);
    // Extra backspaces on an empty prompt stay at zero; one key re-opens a draft.
    mgr.write(id, '\x7f');
    mgr.write(id, 'x');
    expect(get().draftPending).toBe(true);
  });

  it('Shift+Enter (LF) and a bare Esc keep the draft pending', () => {
    const { mgr, id, get } = setup();
    mgr.write(id, 'line one');
    mgr.write(id, '\n');
    mgr.write(id, '\x1b');
    mgr.write(id, '\x1b');
    expect(get().draftPending).toBe(true);
  });

  it('OSC, DCS and DECRPM replies leave the key clock and draft untouched', () => {
    const { mgr, id, get } = setup();
    mgr.write(id, '\x1b]4;1;rgb:cdcd/0000/0000\x07');
    mgr.write(id, '\x1bP1$r0m\x1b\\');
    mgr.write(id, '\x1b[?2004;1$y');
    expect(get().lastInputAt).toBe(1_000);
    expect(get().lastKeyInputAt).toBeUndefined();
    expect(get().draftPending).toBeUndefined();
  });

  it('reply() clears the draft when it submits and never stamps the key clock', () => {
    const { mgr, id, proc, get } = setup();
    mgr.write(id, 'half-typed');
    expect(get().draftPending).toBe(true);

    vi.setSystemTime(3_000);
    expect(mgr.reply(id, 'report')).toBe(true);
    vi.advanceTimersByTime(200);
    expect(proc.writes.slice(-2)).toEqual(['report', '\r']);
    expect(get().draftPending).toBe(false);
    expect(get().lastKeyInputAt).toBe(1_000);
    expect(get().lastInputAt).toBe(1_000);

    // The submit reset the count, so one char then one backspace is empty again.
    mgr.write(id, 'x');
    mgr.write(id, '\x7f');
    expect(get().draftPending).toBe(false);
  });

  it('write() to an unknown session is a no-op', () => {
    const { mgr } = setup();
    expect(() => mgr.write('nope', 'x')).not.toThrow();
  });
});
