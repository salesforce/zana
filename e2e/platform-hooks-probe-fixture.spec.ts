import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, launchApp } from './fixtures/app.js';
import { buildPluginHost } from '../packages/plugin-build/src/build-plugin-host.js';

// The real, checked-in fixture plugin dir (never copied — its mcp-server.js
// resolves @modelcontextprotocol/sdk/zod via the repo root node_modules walk,
// which only works from this in-tree location; it also sits outside the
// pnpm workspace globs, so it is installed server-only, with no appEntry —
// the renderer-bundle (buildPluginApp) path requires a hoisted
// @zana-ai/zcc-plugin-sdk, which only `plugins/*`/`packages/*` get).
const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/plugins/platform-hooks-probe', import.meta.url));
const PLUGIN_ID = 'platform-hooks-probe';

test.beforeAll(async () => {
  // Pre-build dist/host.js in the test runner's own Node, matching the
  // precedent in afcode-launch-boundary.spec.ts and shared-machine-sources.spec.ts —
  // avoids depending on the launched app's own in-process esbuild rebuild path.
  await buildPluginHost(FIXTURE_DIR, '1.0.0');
});

test('platform-hooks-probe fixture exercises project-tab availability and the agent-tool marker through the real host-RPC and tool-call boundaries', async ({
  home
}) => {
  test.setTimeout(120_000);

  const pluginStore = join(home, '.zcc/plugins');
  mkdirSync(pluginStore, { recursive: true });
  writeFileSync(
    join(pluginStore, 'installed.json'),
    JSON.stringify({
      version: 1,
      plugins: [
        {
          id: PLUGIN_ID,
          version: '0.1.0',
          name: 'Platform Hooks Probe',
          enabled: true,
          status: 'running',
          provenance: 'direct',
          sourceKind: 'path',
          source: `path:${FIXTURE_DIR}`,
          rootDir: FIXTURE_DIR,
          serverEntry: './server.ts',
          appEntry: null,
          installedAt: Date.now(),
          updatedAt: Date.now()
        }
      ]
    })
  );

  const app = await launchApp(home, {
    env: { ZCC_FAKE_PROVIDER: '1' },
    initialConfig: { sponsorPromptDismissed: true }
  });
  try {
    const win = app.window;
    win.on('console', (msg) => console.log(`[renderer:${msg.type()}]`, msg.text()));
    let appStderr = '';
    app.electron.process().stderr?.on('data', (chunk) => { appStderr += String(chunk); });

    let lastRow: unknown;
    try {
      await expect
        .poll(
          async () => {
            lastRow = await win.evaluate(async (id) => (await window.cc.pluginApps.list()).find((p) => p.id === id), PLUGIN_ID);
            return (lastRow as { status?: string } | undefined)?.status;
          },
          { timeout: 30_000 }
        )
        .toBe('running');
    } catch (error) {
      throw new Error(`plugin never reached status 'running'; last row: ${JSON.stringify(lastRow)}`, { cause: error });
    }

    const projectDir = join(home, 'hooks-probe-project');
    mkdirSync(projectDir, { recursive: true });
    const projectId = await win.evaluate(async (path) => {
      const result = await window.cc.projects.add(path);
      if (!result.ok) throw new Error(result.message);
      return result.value.id;
    }, projectDir);

    const rpc = <T,>(method: string, args: unknown) =>
      win.evaluate(({ id, method, args }) => window.cc.pluginApps.callRpc(id, method, args), { id: PLUGIN_ID, method, args }) as Promise<T>;

    // OBL-006: project-tab availability is gated off until the fixture is enabled for this project.
    await expect(rpc('getEnabled', { projectId })).resolves.toEqual({ enabled: false });
    await expect(rpc('markerGet', { projectId })).resolves.toEqual({ count: 0, history: [] });

    await expect(rpc('setEnabled', { projectId, enabled: true })).resolves.toEqual({ enabled: true });
    await expect(rpc('getEnabled', { projectId })).resolves.toEqual({ enabled: true });

    // OBL-001: project-bound host RPC, driven through the real host-daemon
    // boundary (zcc.host.projectCall -> callPluginHostRpc -> hostHub ->
    // plugin-host-manager -> host.ts's inspectContext handler).
    await expect(rpc('hostInspectContext', { projectId })).resolves.toMatchObject({
      workspaceKind: 'workspace',
      rootBasename: 'hooks-probe-project',
      pid: expect.any(Number)
    });

    // OBL-001: "no token or path spoofing permitted" — main authorizes the
    // projectId server-side (plugin-service.ts hostCall) before a host RPC is
    // ever dispatched; a spoofed/unregistered projectId must be rejected, not
    // silently routed through.
    await expect(rpc('hostInspectContext', { projectId: 'spoofed-unregistered-project-id' })).rejects.toThrow();

    // OBL-001: the same boundary supports mid-flight cancellation of a slow
    // host call — hostCancelSlowProbe aborts the in-flight hostSlowProbe via
    // the shared AbortController, proving cancel propagates across the
    // process boundary rather than only locally.
    const slowProbePromise = rpc('hostSlowProbe', { delayMs: 5000, probeId: 'probe-e2e-1' });
    await expect(rpc('hostCancelSlowProbe', { probeId: 'probe-e2e-1' })).resolves.toEqual({ cancelled: true });
    await expect(slowProbePromise).resolves.toEqual({ cancelled: true });

    // Drive a real thread through the fake provider's deterministic tool-call
    // control token, routed through the production tool-call HTTP boundary into
    // the plugin's registered agent tool (apps/server/src/http/host-internal.ts
    // -> invokeAgentTool -> zcc.agents.registerTool('platform_hooks_probe_marker')).
    // Agent-tool-call routing has no per-project availability gate, so this
    // succeeds regardless of the setEnabled state above — it proves the tool
    // reaches the plugin through the real multi-process boundary.
    const thread = await win.evaluate(async (projectId) => {
      const response = await fetch('/api/v1/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId,
          providerId: 'fake',
          title: 'Hooks Probe tool-call E2E',
          input: 'call_tool:platform_hooks_probe_marker'
        })
      });
      if (!response.ok) throw new Error(await response.text());
      return (await response.json()).value;
    }, projectId);

    await expect
      .poll(
        () =>
          win.evaluate(async (id) => {
            const response = await fetch(`/api/v1/threads/${id}`);
            return (await response.json()).thread.status;
          }, thread.id),
        { timeout: 30_000 }
      )
      .toBe('idle');

    const events = await win.evaluate(async (id) => {
      const response = await fetch(`/api/v1/threads/${id}/events?limit=50`);
      return response.json();
    }, thread.id);
    console.log('[hooks-probe] thread events', JSON.stringify(events));

    await expect(rpc('markerGet', { projectId }), appStderr.slice(-8_000)).resolves.toMatchObject({
      count: 1,
      history: [expect.objectContaining({ source: 'modern-tool' })]
    });

    // OBL-003: dispatch admission, driven through the real send boundary
    // (sendConversationTurn -> dispatch-service.admitDispatch -> plugin-service
    // admitDispatch fan-out -> the fixture's zcc.hooks.on handler, keyed on
    // setDispatchSelection/getDispatchSelection). A second thread isolates this
    // from the tool-call thread above.
    const dispatchThread = await win.evaluate(async (projectId) => {
      const response = await fetch('/api/v1/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, providerId: 'fake', title: 'Hooks Probe dispatch E2E', input: 'dispatch probe seed' })
      });
      if (!response.ok) throw new Error(await response.text());
      return (await response.json()).value;
    }, projectId);
    await expect
      .poll(
        () => win.evaluate(async (id) => {
          const response = await fetch(`/api/v1/threads/${id}`);
          return (await response.json()).thread.status;
        }, dispatchThread.id),
        { timeout: 30_000 }
      )
      .toBe('idle');

    // Reject: the fixture's handler returns { action: 'reject' }, which must
    // surface as a 409 dispatch_rejected through the real HTTP send route,
    // never silently swallowed or converted to a different error.
    await expect(rpc('setDispatchSelection', { kind: 'reject', message: 'rejected by fixture policy' })).resolves.toEqual({ ok: true });
    const rejected = await win.evaluate(async (id) => {
      const response = await fetch(`/api/v1/threads/${id}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'should be rejected' })
      });
      return { status: response.status, body: await response.json() };
    }, dispatchThread.id);
    expect(rejected.status).toBe(409);
    expect(rejected.body).toMatchObject({ ok: false, code: 'dispatch_rejected' });

    // Wait (locked, not overrideable): the send is deferred into next-turn
    // rather than failing outright, and "Send now" must be refused because
    // overrideable is false.
    await expect(rpc('setDispatchSelection', { kind: 'wait', overrideable: false, reason: 'locked wait' })).resolves.toEqual({ ok: true });
    const waitedLocked = await win.evaluate(async (id) => {
      const response = await fetch(`/api/v1/threads/${id}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'should be held, locked' })
      });
      return { status: response.status, body: await response.json() };
    }, dispatchThread.id);
    expect(waitedLocked.status).toBe(200);
    await expect(rpc('dispatchEventsList', undefined)).resolves.toContainEqual(expect.objectContaining({
      decision: expect.objectContaining({ action: 'wait', overrideable: false })
    }));
    const lockedNextTurn = await win.evaluate(async (id) => (await fetch(`/api/v1/threads/${id}/next-turn`)).json(), dispatchThread.id);
    expect(lockedNextTurn.items).toHaveLength(1);
    const lockedItemId = lockedNextTurn.items[0].id as string;
    const lockedSendNow = await win.evaluate(async ({ id, itemId }) => {
      const response = await fetch(`/api/v1/threads/${id}/next-turn/${itemId}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      });
      return { status: response.status, body: await response.json() };
    }, { id: dispatchThread.id, itemId: lockedItemId });
    expect(lockedSendNow.status).toBe(409);
    expect(lockedSendNow.body).toMatchObject({ error: 'dispatch_not_overrideable' });
    await win.evaluate(async ({ id, itemId }) => {
      await fetch(`/api/v1/threads/${id}/next-turn/${itemId}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      });
    }, { id: dispatchThread.id, itemId: lockedItemId });

    // Wait (overrideable): "Send now" consumes the admission generation via
    // CAS and must emit the redacted dispatch-override audit event onto the
    // thread's own event stream — proving the override path reaches the real
    // emitDispatchOverrideAudit sink, not just a mocked unit test.
    await expect(rpc('setDispatchSelection', { kind: 'wait', overrideable: true, reason: 'overrideable wait' })).resolves.toEqual({ ok: true });
    const waitedOverrideable = await win.evaluate(async (id) => {
      const response = await fetch(`/api/v1/threads/${id}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'should be held, overrideable' })
      });
      return { status: response.status, body: await response.json() };
    }, dispatchThread.id);
    expect(waitedOverrideable.status).toBe(200);
    const overrideableNextTurn = await win.evaluate(async (id) => (await fetch(`/api/v1/threads/${id}/next-turn`)).json(), dispatchThread.id);
    expect(overrideableNextTurn.items).toHaveLength(1);
    const overrideableItemId = overrideableNextTurn.items[0].id as string;

    // Flip back to proceed before the override send actually dispatches, so
    // the drained turn is not itself re-admitted into another wait.
    await expect(rpc('setDispatchSelection', { kind: 'proceed' })).resolves.toEqual({ ok: true });
    const sentNow = await win.evaluate(async ({ id, itemId }) => {
      const response = await fetch(`/api/v1/threads/${id}/next-turn/${itemId}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      });
      return { status: response.status, body: await response.json() };
    }, { id: dispatchThread.id, itemId: overrideableItemId });
    expect(sentNow.status).toBe(200);
    expect(sentNow.body).toEqual({ ok: true });

    await expect
      .poll(
        () => win.evaluate(async (id) => {
          const response = await fetch(`/api/v1/threads/${id}/events?limit=100`);
          const { events } = await response.json();
          return events.some((event: { type: string }) => event.type === 'dispatch/override/audited');
        }, dispatchThread.id),
        { timeout: 30_000 }
      )
      .toBe(true);
    const auditEvents = await win.evaluate(async (id) => {
      const response = await fetch(`/api/v1/threads/${id}/events?limit=100`);
      const { events } = await response.json();
      return events.filter((event: { type: string }) => event.type === 'dispatch/override/audited');
    }, dispatchThread.id);
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].payload).toMatchObject({
      threadId: dispatchThread.id,
      projectId,
      overriddenBy: 'desktop-ui',
      pluginId: PLUGIN_ID,
      reason: 'overrideable wait',
      outcome: 'accepted'
    });
    expect(auditEvents[0].payload).not.toHaveProperty('prompt');
    expect(auditEvents[0].payload).not.toHaveProperty('input');

    // Proceed: with the policy reset, a normal send goes straight through
    // with no wait/next-turn item created at all.
    await expect
      .poll(
        () => win.evaluate(async (id) => {
          const response = await fetch(`/api/v1/threads/${id}`);
          return (await response.json()).thread.status;
        }, dispatchThread.id),
        { timeout: 30_000 }
      )
      .toBe('idle');
    const proceeded = await win.evaluate(async (id) => {
      const response = await fetch(`/api/v1/threads/${id}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'should proceed immediately' })
      });
      return { status: response.status, body: await response.json() };
    }, dispatchThread.id);
    expect(proceeded.status).toBe(200);
    const finalNextTurn = await win.evaluate(async (id) => (await fetch(`/api/v1/threads/${id}/next-turn`)).json(), dispatchThread.id);
    expect(finalNextTurn.items).toHaveLength(0);

    await win.evaluate(async (id) => {
      await fetch(`/api/v1/threads/${id}/archive`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    }, dispatchThread.id);

    await win.evaluate(async (id) => {
      await fetch(`/api/v1/threads/${id}/archive`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    }, thread.id);
    await win.evaluate(async (id) => {
      try {
        await window.cc.projects.remove(id);
      } catch {
        /* best-effort cleanup */
      }
    }, projectId);
  } finally {
    await app.electron.close();
  }
});

test('platform-hooks-probe fixture tool policy allow/deny gates the real decideToolPolicy -> invokeAgentTool boundary (OBL-004)', async ({
  home
}) => {
  test.setTimeout(120_000);

  const pluginStore = join(home, '.zcc/plugins');
  mkdirSync(pluginStore, { recursive: true });
  writeFileSync(
    join(pluginStore, 'installed.json'),
    JSON.stringify({
      version: 1,
      plugins: [
        {
          id: PLUGIN_ID,
          version: '0.1.0',
          name: 'Platform Hooks Probe',
          enabled: true,
          status: 'running',
          provenance: 'direct',
          sourceKind: 'path',
          source: `path:${FIXTURE_DIR}`,
          rootDir: FIXTURE_DIR,
          serverEntry: './server.ts',
          appEntry: null,
          installedAt: Date.now(),
          updatedAt: Date.now()
        }
      ]
    })
  );

  const app = await launchApp(home, {
    env: { ZCC_FAKE_PROVIDER: '1' },
    initialConfig: { sponsorPromptDismissed: true }
  });
  try {
    const win = app.window;
    win.on('console', (msg) => console.log(`[renderer:${msg.type()}]`, msg.text()));

    let lastRow: unknown;
    try {
      await expect
        .poll(
          async () => {
            lastRow = await win.evaluate(async (id) => (await window.cc.pluginApps.list()).find((p) => p.id === id), PLUGIN_ID);
            return (lastRow as { status?: string } | undefined)?.status;
          },
          { timeout: 30_000 }
        )
        .toBe('running');
    } catch (error) {
      throw new Error(`plugin never reached status 'running'; last row: ${JSON.stringify(lastRow)}`, { cause: error });
    }

    const projectDir = join(home, 'hooks-probe-tool-policy-project');
    mkdirSync(projectDir, { recursive: true });
    const projectId = await win.evaluate(async (path) => {
      const result = await window.cc.projects.add(path);
      if (!result.ok) throw new Error(result.message);
      return result.value.id;
    }, projectDir);

    const rpc = <T,>(method: string, args: unknown) =>
      win.evaluate(({ id, method, args }) => window.cc.pluginApps.callRpc(id, method, args), { id: PLUGIN_ID, method, args }) as Promise<T>;

    const callToolViaThread = async () => {
      const thread = await win.evaluate(async (projectId) => {
        const response = await fetch('/api/v1/threads', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            projectId,
            providerId: 'fake',
            title: 'Hooks Probe tool-policy E2E',
            input: 'call_tool:platform_hooks_probe_marker'
          })
        });
        if (!response.ok) throw new Error(await response.text());
        return (await response.json()).value;
      }, projectId);
      await expect
        .poll(
          () => win.evaluate(async (id) => {
            const response = await fetch(`/api/v1/threads/${id}`);
            return (await response.json()).thread.status;
          }, thread.id),
          { timeout: 30_000 }
        )
        .toBe('idle');
      await win.evaluate(async (id) => {
        await fetch(`/api/v1/threads/${id}/archive`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      }, thread.id);
    };

    // Baseline: this plugin install's onToolPolicy handler governs EVERY
    // registerTool invocation (not just native-CLI PreToolUse calls) through
    // the real apps/server/src/http/host-internal.ts decideToolPolicy ->
    // invokeAgentTool boundary. Start from a known marker count and a clean
    // event log so the allow/deny deltas below are unambiguous.
    await expect(rpc('toolPolicyEventsClear', undefined)).resolves.toEqual({ ok: true });
    const baseline = await rpc<{ count: number }>('markerGet', { projectId });
    const baselineCount = baseline.count;

    // Deny: setToolPolicySelection flips the fixture's onToolPolicy handler to
    // deny. decideToolPolicy must short-circuit host-internal.ts BEFORE
    // invokeAgentTool runs, so the agent tool's side effect (the marker write)
    // must never happen — proving the veto arrives before the tool's side
    // effect, not merely that a deny event was recorded alongside it.
    await expect(rpc('setToolPolicySelection', { selection: 'deny' })).resolves.toEqual({ ok: true });
    await expect(rpc('getToolPolicySelection', undefined)).resolves.toBe('deny');
    await callToolViaThread();
    await expect(rpc('markerGet', { projectId })).resolves.toMatchObject({ count: baselineCount });
    const deniedEvents = await rpc<Array<{ toolName: string; state: string }>>('toolPolicyEventsList', undefined);
    expect(deniedEvents).toHaveLength(1);
    expect(deniedEvents[0]).toMatchObject({ toolName: 'platform_hooks_probe_marker', state: 'denied' });

    // Allow: flipping the selection back to allow must let the identical tool
    // call proceed all the way to its side effect — the marker count advances
    // by exactly one, and the recorded event is 'allowed', not 'denied'.
    await expect(rpc('setToolPolicySelection', { selection: 'allow' })).resolves.toEqual({ ok: true });
    await expect(rpc('getToolPolicySelection', undefined)).resolves.toBe('allow');
    await callToolViaThread();
    await expect(rpc('markerGet', { projectId })).resolves.toMatchObject({ count: baselineCount + 1 });
    const allEvents = await rpc<Array<{ toolName: string; state: string }>>('toolPolicyEventsList', undefined);
    expect(allEvents).toHaveLength(2);
    expect(allEvents[1]).toMatchObject({ toolName: 'platform_hooks_probe_marker', state: 'allowed' });

    // Retry with the same invocation decision must stay deduped at the server
    // boundary (toolPolicyDecisions cache keyed by invocationId) rather than
    // re-invoking the handler — each distinct thread/tool-call above minted
    // its own invocationId via randomUUID() in host-internal.ts, so exactly
    // two policy events exist: one denied, one allowed, never more.
    expect(allEvents.filter((event) => event.state === 'denied')).toHaveLength(1);
    expect(allEvents.filter((event) => event.state === 'allowed')).toHaveLength(1);

    await win.evaluate(async (id) => {
      try {
        await window.cc.projects.remove(id);
      } catch {
        /* best-effort cleanup */
      }
    }, projectId);
  } finally {
    await app.electron.close();
  }
});
