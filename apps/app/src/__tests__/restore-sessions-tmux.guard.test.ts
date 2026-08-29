import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('launch restore does not use an open-sessions snapshot', () => {
  it('store restore is tmux-capability only', () => {
    const source = readFileSync(new URL('../store.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('persistOpenSessions');
    expect(source).not.toContain('zcc.openSessions');
    expect(source).not.toContain('planRestore');
    expect(source).not.toContain('readSnapshot');
    expect(source).not.toContain('writeSnapshot');
    expect(source).not.toContain('snapshotTabs');
    expect(source).toContain('listTmuxRestoreCandidates');
    expect(source).not.toContain('hydrateHostThreads');
  });

  it('sessionRestore no longer owns a localStorage tab snapshot', () => {
    const source = readFileSync(new URL('../lib/sessionRestore.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('zcc.openSessions');
    expect(source).not.toContain('snapshotTabs');
    expect(source).not.toContain('planRestore');
    expect(source).not.toContain('function readSnapshot');
    expect(source).not.toContain('function writeSnapshot');
    expect(source).toContain('export function resolveRestartProfile');
  });
});
