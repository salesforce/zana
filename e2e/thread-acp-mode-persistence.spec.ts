/**
 * Native-role (acpMode) PERSISTENCE round-trip at the real Electron boundary.
 *
 * A Modern-composer thread launched under a provider-native session role (the
 * opencode ACP `mode` selector — build/plan/doc-vault/…) must remember that role
 * so reopening the thread shows the mode it is actually running, not a neutral
 * placeholder and not the sessionless provider default. The role is recorded on
 * the `client/turn/requested` event's `execution` block and read back by
 * `readLastThreadExecution`, which the GET `/threads/:id` response merges in.
 *
 * That persistence is PROVIDER-AGNOSTIC: the turn event is appended before the
 * host spawn RPC, so a fake `claude` agent proves the HTTP create→persist→GET
 * round-trip deterministically without a live opencode ACP session (the
 * opencode wiring itself is covered by opencode-launch-boundary.spec.ts).
 *
 * We drive the real product HTTP API from the renderer (`window.evaluate` +
 * `fetch`) so the assertion spans the actual main-process server boundary, which
 * unit tests of the reader alone cannot establish.
 */
import { test, expect } from './fixtures/app.js';
import { makeFakeAgentBinary } from './sdk/harness.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.use({ e2e: true });

test.setTimeout(90_000);

test('an existing thread reads back the native role it launched under; a role-less thread reads back none', async ({
  app
}) => {
  const { window } = app;
  const agent = makeFakeAgentBinary(); // claude/working-hold → the spawn survives.
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-acp-mode-persist-'));
  let projectId: string | null = null;

  try {
    await window.evaluate((bin) => window.cc.config.set({
      sponsorPromptDismissed: true,
      claudeBinary: bin,
      defaultHarness: 'claude'
    }), agent.path);

    projectId = await window.evaluate(async (path) => {
      const res = await window.cc.projects.add(path);
      const proj = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as { id: string };
      return proj.id;
    }, projectDir);
    expect(projectId).toBeTruthy();

    // Create a thread that picked a native role, and a control thread that did
    // not. `plan` is a generic ACP session mode — the persistence is opaque to
    // the concrete value.
    const createThread = (body: Record<string, unknown>) => window.evaluate(async (payload) => {
      const res = await fetch('/api/v1/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error('POST /threads failed: ' + JSON.stringify(json));
      return (json.value ?? json.thread).id as string;
    }, body);

    const readAcpMode = (id: string) => window.evaluate(async (threadId) => {
      const res = await fetch(`/api/v1/threads/${encodeURIComponent(threadId)}`);
      const json = await res.json();
      if (!res.ok) throw new Error('GET /threads/:id failed: ' + JSON.stringify(json));
      // `acpMode` is `string | null`; normalize an omitted key to `null`.
      return (json.thread?.acpMode ?? null) as string | null;
    }, id);

    const withRoleId = await createThread({
      projectId,
      input: 'launched under a native role',
      acpMode: 'plan'
    });
    expect(withRoleId).toBeTruthy();

    const roleLessId = await createThread({
      projectId,
      input: 'launched with no native role'
    });
    expect(roleLessId).toBeTruthy();

    // The role sticks to its thread; the role-less thread reads back none (so the
    // picker stays honestly neutral rather than claiming the provider default).
    await expect.poll(() => readAcpMode(withRoleId), { timeout: 30_000, intervals: [500] }).toBe('plan');
    expect(await readAcpMode(roleLessId)).toBeNull();
  } finally {
    try {
      if (projectId) {
        await window.evaluate(async (pid) => {
          try {
            const sessions = (await window.cc.terminals.list?.(pid)) as Array<{ id: string }> | undefined;
            if (Array.isArray(sessions)) {
              for (const s of sessions) { try { await window.cc.terminals.close(s.id); } catch { /* best-effort */ } }
            }
          } catch { /* best-effort */ }
          try { await window.cc.projects.remove(pid); } catch { /* best-effort */ }
        }, projectId);
      }
    } catch { /* page may already be closed on timeout */ }
    try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    agent.cleanup();
  }
});
