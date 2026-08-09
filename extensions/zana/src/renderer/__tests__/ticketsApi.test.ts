/**
 * Contract lock for the zana extension's data seam (`../ticketsApi.ts`).
 *
 * After the plugins→extensions migration, zana is a full DISK EXTENSION (main +
 * renderer in one bundle). This wrapper no longer reaches a core built-in over
 * the raw `window.cc.modules` bus — it routes through the extension's own host
 * bridge, read via the SDK's W1-7 `getModuleHost()` accessor that `activate({
 * host })` primes:
 *
 *     getModuleHost().call(capability, arg?)  // → window.cc.modules.call(<ext-id>, cap, [arg])
 *
 * `ModuleHost.call` prepends this extension's id itself, so the seam never names
 * `'zana'` — it only supplies the capability string + one options object (or no
 * arg for zero-arg capabilities). This proves:
 *   - every export routes through the ONE host bridge (`getModuleHost().call`);
 *   - the capability string + arg shape per export (the routing contract);
 *   - zero-arg capabilities call `host.call(cap)` with NO trailing arg;
 *   - `assignTicket`'s mutually-exclusive {profileId} / {assigneeName} /
 *     {profileId:null} payload variants each route without combining;
 *   - the resolved value is returned UNCHANGED (pass-through);
 *   - reading before `activate` primed the holder throws a clear, named error.
 *
 * Style: zero-DOM. Install a fake `ModuleHost` into the holder that records
 * every (capability, args) call. No real IPC touched.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModuleHost } from '@zana-ai/zcc-extension-sdk/renderer';
import { setModuleHostForTesting } from '@zana-ai/zcc-extension-sdk/renderer';
import {
  ticketsApi,
  getSnapshot,
  getTicket,
  getArtifact,
  listProfiles,
  getProfile,
  assignTicket,
  getVersionInfo,
  type TicketSource
} from '../ticketsApi';

// Records every (capability, args) the wrapper hands to the host bridge, and
// lets a per-test variable drive the resolved value (pass-through assertion).
const calls: Array<{ cap: string; args: unknown[] }> = [];
let nextResolved: unknown;

function installHost(): void {
  const fake = {
    call: (cap: string, ...args: unknown[]) => {
      calls.push({ cap, args });
      return Promise.resolve(nextResolved);
    }
  } as unknown as ModuleHost;
  setModuleHostForTesting(fake);
}

function uninstallHost(): void {
  // Reset the module-level accessor so the "unavailable" case can be exercised.
  setModuleHostForTesting(null);
}

const project: TicketSource = { kind: 'project', projectPath: '/p' };
const global: TicketSource = { kind: 'global' };

beforeEach(() => {
  calls.length = 0;
  nextResolved = undefined;
  installHost();
});

afterEach(() => {
  uninstallHost();
});

describe('ticketsApi — host-bridge seam: routes through getModuleHost().call, never names an id', () => {
  it('every export routes through the ONE host bridge', () => {
    void getSnapshot(project);
    void getTicket(project, 't1');
    void getArtifact(global, 'a1');
    void listProfiles();
    void getProfile('arch');
    void assignTicket(project, 't1', { profileId: 'arch' });
    void getVersionInfo();
    expect(calls).toHaveLength(7);
    // Args are ALWAYS an array; source-scoped calls send exactly one options
    // object, zero-arg capabilities send none.
    expect(calls.every((c) => Array.isArray(c.args))).toBe(true);
  });

  it('throws a clear, named error when the host bridge is unavailable', () => {
    uninstallHost();
    expect(() => getSnapshot(project)).toThrow(/host bridge/);
  });
});

describe('ticketsApi — capability routing + arg shape', () => {
  it('getSnapshot(project) → ("getSnapshot", [{ projectPath, useGlobal:false }])', () => {
    void getSnapshot(project);
    expect(calls[0]).toEqual({
      cap: 'getSnapshot',
      args: [{ projectPath: '/p', useGlobal: false }]
    });
  });

  it('getSnapshot(global) → ("getSnapshot", [{ useGlobal:true }])', () => {
    void getSnapshot(global);
    expect(calls[0]).toEqual({ cap: 'getSnapshot', args: [{ useGlobal: true }] });
  });

  it('getTicket merges { id } into the source args', () => {
    void getTicket(project, 't1');
    expect(calls[0]).toEqual({
      cap: 'getTicket',
      args: [{ projectPath: '/p', useGlobal: false, id: 't1' }]
    });
  });

  it('getArtifact merges { id } into the source args', () => {
    void getArtifact(global, 'a1');
    expect(calls[0]).toEqual({
      cap: 'getArtifact',
      args: [{ useGlobal: true, id: 'a1' }]
    });
  });

  it('listProfiles() is ZERO-arg — calls host.call(cap) with no trailing arg', () => {
    void listProfiles();
    expect(calls[0]).toEqual({ cap: 'listProfiles', args: [] });
  });

  it('getVersionInfo() is ZERO-arg — calls host.call(cap) with no trailing arg', () => {
    void getVersionInfo();
    expect(calls[0]).toEqual({ cap: 'getVersionInfo', args: [] });
  });

  it('getProfile sends [{ id }] (object, not positional)', () => {
    void getProfile('arch');
    expect(calls[0]).toEqual({ cap: 'getProfile', args: [{ id: 'arch' }] });
  });
});

describe('ticketsApi — assignTicket payload variants (mutually exclusive)', () => {
  it('profile assign → [{ …source, id, profileId }]', () => {
    void assignTicket(project, 't1', { profileId: 'arch' });
    expect(calls[0]).toEqual({
      cap: 'assignTicket',
      args: [{ projectPath: '/p', useGlobal: false, id: 't1', profileId: 'arch' }]
    });
  });

  it('free-text assign → [{ …source, id, assigneeName }] (no profileId key)', () => {
    void assignTicket(project, 't1', { assigneeName: 'Ada' });
    expect(calls[0]?.args[0]).toEqual({
      projectPath: '/p',
      useGlobal: false,
      id: 't1',
      assigneeName: 'Ada'
    });
    expect(calls[0]?.args[0]).not.toHaveProperty('profileId');
  });

  it('clear assign → [{ …source, id, profileId:null }] (no assigneeName key)', () => {
    void assignTicket(project, 't1', { profileId: null });
    expect(calls[0]?.args[0]).toEqual({
      projectPath: '/p',
      useGlobal: false,
      id: 't1',
      profileId: null
    });
    expect(calls[0]?.args[0]).not.toHaveProperty('assigneeName');
  });
});

describe('ticketsApi — return value pass-through', () => {
  it('returns the resolved bridge value UNCHANGED', async () => {
    const detail = { id: 't1', title: 'T', status: 'backlog', labels: [], blockedBy: [] };
    nextResolved = detail;
    const out = await assignTicket(project, 't1', { profileId: 'arch' });
    expect(out).toBe(detail); // same reference — no re-shaping
  });

  it('getSnapshot resolves the bridge value verbatim', async () => {
    const sentinel = { source: { kind: 'project' }, tickets: [], sprints: [], artifacts: [] };
    nextResolved = sentinel;
    await expect(getSnapshot(project)).resolves.toBe(sentinel);
  });
});

describe('ticketsApi — exported surface (sibling contract)', () => {
  it('the aggregate exposes exactly the 8 shipped capabilities', () => {
    expect(Object.keys(ticketsApi).sort()).toEqual(
      [
        'assignTicket',
        'getArtifact',
        'getProfile',
        'getSnapshot',
        'getTicket',
        'getVersionInfo',
        'initProject',
        'listProfiles'
      ].sort()
    );
  });

  it('does NOT re-export the bridge / internal shaping helpers in its public surface', () => {
    expect('callZana' in ticketsApi).toBe(false);
    expect('srcArgs' in ticketsApi).toBe(false);
  });
});
