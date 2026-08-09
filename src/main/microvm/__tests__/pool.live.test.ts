import { describe, it, expect } from 'vitest';
import { MicroVmPool } from '../pool.js';

/**
 * LIVE integration test for the playground pool. Unlike the fake-SDK unit test,
 * this drives the REAL MicroVmPool against the REAL `microsandbox` native addon
 * — it boots an actual libkrun microVM and runs shell commands in it, exactly
 * the way the `microvm_exec` MCP tool does. It therefore only runs when
 * explicitly opted in:
 *
 *   ZCC_MICROVM_LIVE=1 npx vitest run \
 *     src/main/microvm/__tests__/pool.live.test.ts
 *
 * It proves the whole external-playground thesis end-to-end:
 *   1. exec() lazily boots an isolated guest and runs a command in it.
 *   2. STATE PERSISTS across exec calls for the same projectId (write a file in
 *      one call, read it back in the next) — a real workspace, not one-shot.
 *   3. ISOLATION — the guest cannot see host files (no /Users, no bind mount).
 *   4. A separate projectId gets a SEPARATE guest.
 *   5. reset() wipes the guest so the next exec boots a clean one.
 *   6. disposeAll() tears everything down.
 *
 * The model/auth path is out of scope (the agent stays native on the host); the
 * pool only runs EXECUTION, so there is nothing gateway-bound to reach here.
 */

const LIVE = process.env.ZCC_MICROVM_LIVE === '1';
const d = LIVE ? describe : describe.skip;

// Booting a real microVM + in-guest work can take several seconds cold.
const TIMEOUT = 120_000;

d('MicroVmPool — LIVE playground integration', () => {
  it(
    'boots, persists state across calls, isolates from host, resets, and disposes',
    async () => {
      const pool = new MicroVmPool({
        enabled: () => true,
        platformSupported: () => true,
        // Longer idle TTL than the test so the reaper never races us.
        idleTtlMs: TIMEOUT
      });

      try {
        // 1. Lazy boot + run in an isolated guest.
        const r1 = await pool.exec('live-proj', 'uname -s; echo BOOTED');
        expect(r1.ok).toBe(true);
        expect(r1.code).toBe(0);
        expect(r1.stdout).toContain('Linux'); // guest kernel, not the macOS host
        expect(r1.stdout).toContain('BOOTED');
        expect(pool.liveCount()).toBe(1);

        // 2. PERSISTENCE — write a file in one call...
        const w = await pool.exec('live-proj', 'echo persisted-marker > /root/note.txt && echo WROTE');
        expect(w.ok).toBe(true);
        expect(w.stdout).toContain('WROTE');
        // ...and read it back in a SEPARATE call (same guest reused, no re-boot).
        const rd = await pool.exec('live-proj', 'cat /root/note.txt');
        expect(rd.ok).toBe(true);
        expect(rd.stdout).toContain('persisted-marker');
        expect(pool.liveCount()).toBe(1); // still one guest — it was reused

        // 3. ISOLATION — the guest cannot see host files.
        const iso = await pool.exec('live-proj', 'ls /Users 2>&1 || echo NO-HOST-FS');
        expect(iso.stdout).toContain('NO-HOST-FS');

        // 4. A separate project gets a separate guest.
        const other = await pool.exec('other-proj', 'cat /root/note.txt 2>&1 || echo CLEAN-GUEST');
        expect(other.stdout).toContain('CLEAN-GUEST'); // the marker is NOT here
        expect(pool.liveCount()).toBe(2);

        // 5. reset() wipes the guest — the next exec boots a fresh one where the
        //    marker is gone.
        const res = await pool.reset('live-proj');
        expect(res.existed).toBe(true);
        const afterReset = await pool.exec('live-proj', 'cat /root/note.txt 2>&1 || echo WIPED');
        expect(afterReset.stdout).toContain('WIPED');
      } finally {
        // 6. Tear everything down.
        pool.disposeAll();
        // Give the async stop() calls a beat to fire.
        await new Promise((r) => setTimeout(r, 500));
        expect(pool.liveCount()).toBe(0);
      }
    },
    TIMEOUT
  );

  it(
    'runs fully network-isolated with network:"none"',
    async () => {
      const pool = new MicroVmPool({ enabled: () => true, platformSupported: () => true, idleTtlMs: TIMEOUT });
      try {
        // A no-egress guest: a public fetch should fail. (We don't assert a
        // specific error string — just that it did NOT succeed reaching out.)
        const r = await pool.exec(
          'netless',
          'wget -q -T 5 -O- http://example.org >/dev/null 2>&1 && echo NET-OK || echo NET-BLOCKED',
          { network: 'none' }
        );
        expect(r.ok).toBe(true);
        expect(r.stdout).toContain('NET-BLOCKED');
      } finally {
        pool.disposeAll();
        await new Promise((r) => setTimeout(r, 500));
      }
    },
    TIMEOUT
  );
});
