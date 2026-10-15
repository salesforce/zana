import {
  createFakePluginHost,
  makeThreadResponse,
} from "@zana-ai/zcc-plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import plugin from "./server.js";
import { rpcContract } from "./contracts.js";

async function setup(initial?: Map<string, unknown>, asynchronousClient = false) {
  const worker = vi.fn(
    async ({ method }: { method: string; timeoutMs?: number }): Promise<unknown> =>
      method === "run"
        ? { text: "done", images: [], exitCode: 0 }
        : method === "prepare"
          ? { status: "ready", version: "1.0.0-test", source: "release" }
          : null,
  );
  const host = createFakePluginHost({
    pluginId: "browser-automation",
    agentSkillIds: ["browser-automation"],
    experimental_callHostRpc: worker,
  });
  const subscriptions: any[] = [];
  let workerExit: (event: { hostId: string }) => void | Promise<void> = async () => {};
  const client = host.bb.host.experimental_client.bind(host.bb.host);
  host.bb.host.experimental_client = (options => {
    const value = { ...client(options), experimental_onWorkerExit: (callback: typeof workerExit) => { workerExit = callback; return () => {}; } };
    return asynchronousClient ? Promise.resolve(value) : value;
  }) as typeof host.bb.host.experimental_client;
  host.harness.sdk.stub("threads.get", async () =>
    makeThreadResponse({ id: "thread-test" }),
  );
  host.harness.sdk.stub(
    "experimental_desktopBrowsers.listInstances",
    async () => ({
      instances: [
        {
          hostId: "desktop-host",
          instanceId: "desktop",
          generation: "generation",
          label: "Desktop",
        },
      ],
    }),
  );
  host.harness.sdk.stub("experimental_desktopBrowsers.createTab", async () => ({
    tab: {
      tabId: "created",
      threadId: "thread-test",
      url: "about:blank",
      title: "",
      control: null,
      profile: { kind: "automation", id: "profile" },
      presentation: "hidden",
    },
  }));
  host.harness.sdk.stub(
    "experimental_desktopBrowsers.acquireControl",
    async () => ({ leaseId: "lease", expiresAt: Date.now() + 60_000 }),
  );
  host.harness.sdk.stub(
    "experimental_desktopBrowsers.openConnection",
    async () => ({
      hostId: "desktop-host",
      expiresAt: Date.now() + 60_000,
      wsEndpoint: "ws://127.0.0.1:9999/cdp?token=secret",
    }),
  );
  host.harness.sdk.stub(
    "experimental_desktopBrowsers.releaseControl",
    async (input) => {
      expect(Object.keys(input).sort()).toEqual([
        "generation",
        "hostId",
        "instanceId",
        "leaseId",
        "threadId",
      ]);
      return { ok: true };
    },
  );
  host.harness.sdk.stub(
    "experimental_desktopBrowsers.closeTab",
    async (input) => {
      expect(Object.keys(input).sort()).toEqual([
        "generation",
        "hostId",
        "instanceId",
        "tabId",
        "threadId",
      ]);
      return { ok: true };
    },
  );
  host.harness.sdk.stub("experimental_desktopBrowsers.subscribe", input => { subscriptions.push(input); return { dispose() {} }; });
  host.harness.sdk.stub("experimental_desktopBrowsers.listTabs", async () => ({
    tabs: [
      { tabId: "created", profile: { kind: "automation", id: "profile" } },
    ],
  }));
  host.harness.sdk.stub("hosts.list", async () => [
    { id: "local-host", name: "Lab workstation" },
    { id: "desktop-host", name: "Lab desktop" },
  ]);
  for (const [key, value] of initial ?? []) host.harness.kv.set(key, value);
  await plugin(host.bb);
  async function open(tabId?: string) {
    const result = await host.harness.behavior.callRpc("open", {
      threadId: "thread-test",
      selection: {
        backend: "desktop",
        hostId: "desktop-host",
        instanceId: "desktop",
        ...(tabId ? { tabId } : {}),
      },
    });
    return rpcContract.open.output.parse(result);
  }
  return { ...host, worker, open, subscriptions, workerExit: (hostId: string) => workerExit({ hostId }) };
}

describe("server session ownership", () => {
  it.each([false, true])("cleans an asynchronous desktop subscription when control is revoked early: %s", async revoke => {
    const h = await setup();
    const dispose = vi.fn();
    let resolve!: (value: { dispose(): void }) => void;
    let onChange!: (value: { tabs: [] }) => void;
    h.harness.sdk.stub("experimental_desktopBrowsers.subscribe", input => {
      onChange = (input as { onChange(value: { tabs: [] }): void }).onChange;
      return new Promise(done => { resolve = done; });
    });
    try {
      const opening = h.open();
      // Attach a rejection handler before exercising a revoke during open.
      const outcome = opening.then(session => ({ session }), error => ({ error }));
      await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
      if (revoke) {
        onChange({ tabs: [] });
        await vi.waitFor(async () => expect(await h.harness.behavior.callRpc("list", { threadId: "thread-test" })).toMatchObject([{ state: "stopped" }]));
      }
      resolve({ dispose });
      const result = await outcome;
      if ("error" in result) expect(result.error.message).toContain("control was released");
      else {
        expect(revoke).toBe(false);
        await h.harness.behavior.callRpc("close", { threadId: "thread-test", sessionId: result.session.id });
      }
      expect(dispose).toHaveBeenCalledTimes(1);
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });

  it("keeps host contracts local and rejects malformed worker output before admitting a session", async () => {
    const h = await setup();
    try {
      h.worker.mockImplementation(async ({ method }) => method === "prepare" ? { status: "ready", version: "test", source: "release" } : method === "open" ? { unexpected: true } : null);
      await expect(h.open()).rejects.toThrow();
      expect(h.harness.sdk.callsTo("experimental_desktopBrowsers.releaseControl")).toHaveLength(1);
      expect(h.harness.sdk.callsTo("experimental_desktopBrowsers.closeTab")).toHaveLength(1);
      expect(await h.harness.behavior.callRpc("list", { threadId: "thread-test" })).toMatchObject([{ state: "closed" }]);
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });

  it("loads when the desktop worker bridge resolves the host client asynchronously", async () => {
    const h = await setup(undefined, true);
    try {
      const session = await h.open();
      expect(session.state).toBe("ready");
      await h.workerExit("desktop-host");
      expect(await h.harness.behavior.callRpc("list", { threadId: "thread-test" })).toMatchObject([{ state: "closed" }]);
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });

  it("serves command help without a thread or opening a worker", async () => {
    const h = await setup();
    try {
      const result = await h.harness.behavior.runCli(["run", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("--timeout <duration>");
      expect(result.stdout).toContain("500 KB");
      expect(h.worker).not.toHaveBeenCalled();
      const invalid = await h.harness.behavior.runCli(["list", "--headless", "--json"], { threadId: "thread-test" });
      expect(invalid.exitCode).toBe(1);
      expect(JSON.parse(invalid.stdout!)).toMatchObject({ ok: false, error: { code: "command_failed" } });
      const missing = await h.harness.behavior.runCli(["run", "00000000-0000-4000-8000-000000000001", "--script", "1", "--timeout", "90s", "--json"], { threadId: "thread-test" });
      expect(missing.exitCode).toBe(1);
      expect(JSON.parse(missing.stdout!)).toMatchObject({ ok: false, error: { code: "session_unavailable" } });
      expect(h.worker).not.toHaveBeenCalled();
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });

  it("passes duration timeouts to the worker and exposes session recovery errors", async () => {
    const h = await setup();
    try {
      const session = await h.open();
      const result = await h.harness.behavior.runCli(["run", session.id, "--script", "1", "--timeout", "90s", "--json"], { threadId: "thread-test" });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(h.worker).toHaveBeenCalledWith(expect.objectContaining({ method: "run", input: expect.objectContaining({ timeoutMs: 90_000 }) }));
      await h.harness.behavior.runCli(["stop", session.id], { threadId: "thread-test" });
      const stopped = await h.harness.behavior.runCli(["run", session.id, "--script", "1", "--json"], { threadId: "thread-test" });
      expect(stopped.exitCode).toBe(1);
      expect(JSON.parse(stopped.stdout!)).toMatchObject({ ok: false, error: { code: "session_unavailable", hint: expect.stringContaining("new browser session") } });
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });

  it.each([
    ["local", "Lab workstation", "local-host"],
    ["desktop", "Lab desktop", "desktop-host"],
    ["local", "local-host", "local-host"],
  ])(
    "resolves %s machine selector %s before opening",
    async (backend, target, hostId) => {
      const h = await setup();
      try {
        const result = await h.harness.behavior.runCli(
          [
            "open",
            "--backend",
            backend,
            "--machine",
            target,
            ...(backend === "local"
              ? ["--headless"]
              : ["--desktop", "desktop"]),
            "--json",
          ],
          { threadId: "thread-test" },
        );
        expect(result.exitCode, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({ hostId });
        expect(h.worker).toHaveBeenCalledWith(
          expect.objectContaining({ method: "prepare", hostId }),
        );
      } finally {
        await h.harness.lifecycle.dispose();
      }
    },
  );

  it("prefers an exact machine ID over a matching name", async () => {
    const h = await setup();
    h.harness.sdk.stub("hosts.list", async () => [
      { id: "other-host", name: "local-host" },
      { id: "local-host", name: "Lab workstation" },
    ]);
    try {
      const result = await h.harness.behavior.runCli(
        [
          "open",
          "--backend",
          "local",
          "--machine",
          " local-host ",
          "--headless",
          "--json",
        ],
        { threadId: "thread-test" },
      );
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ hostId: "local-host" });
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });

  it.each([
    ["Shared lab", "ambiguous"],
    ["Missing lab", "not found"],
  ])(
    "rejects machine selector %s before creating a session",
    async (target, message) => {
      const h = await setup();
      h.harness.sdk.stub("hosts.list", async () => [
        { id: "host-a", name: "Shared lab" },
        { id: "host-b", name: "Shared lab" },
      ]);
      try {
        const result = await h.harness.behavior.runCli(
          [
            "open",
            "--backend",
            "local",
            "--machine",
            target,
            "--headless",
            "--json",
          ],
          { threadId: "thread-test" },
        );
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(message);
        expect(h.worker).not.toHaveBeenCalled();
        expect(
          await h.harness.behavior.callRpc("list", { threadId: "thread-test" }),
        ).toEqual([]);
      } finally {
        await h.harness.lifecycle.dispose();
      }
    },
  );


  it("returns browser-host image paths through the CLI without registering tools", async () => {
    const h = await setup();
    try {
      const session = await h.open();
      const images = [
        {
          path: "/tmp/browser-session/tmp/capture.jpg",
          mimeType: "image/jpeg",
          width: 640,
          height: 400,
        },
      ];
      h.worker.mockResolvedValueOnce({ text: "captured", images, exitCode: 0 });
      const result = await h.harness.behavior.runCli(
        ["screenshot", session.id, "--json"],
        { threadId: "thread-test" },
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        text: "captured",
        images,
        exitCode: 0,
        hostId: "desktop-host",
      });
      expect(h.harness.registrations.agentTools).toEqual([]);
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });
  it("routes to the desktop host without exposing the connection and preserves a handed-off tab", async () => {
    const h = await setup();
    try {
      const session = await h.open("personal");
      expect(JSON.stringify(session)).not.toContain("secret");
      expect(h.worker).toHaveBeenCalledWith(
        expect.objectContaining({
          hostId: "desktop-host",
          method: "open",
          input: expect.objectContaining({
            connectionUrl: "ws://127.0.0.1:9999/cdp?token=secret",
          }),
        }),
      );
      await h.harness.behavior.callRpc("close", {
        threadId: "thread-test",
        sessionId: session.id,
      });
      expect(
        h.harness.sdk.callsTo("experimental_desktopBrowsers.closeTab"),
      ).toHaveLength(0);
      expect(
        h.harness.sdk.callsTo("experimental_desktopBrowsers.releaseControl"),
      ).toHaveLength(1);
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });
  it("denies cross-thread RPC and CLI access before calling the worker", async () => {
    const h = await setup();
    try {
      const session = await h.open();
      await expect(
        h.harness.behavior.callRpc("run", {
          threadId: "other",
          sessionId: session.id,
          script: "1",
        }),
      ).rejects.toThrow();
      const denied = await h.harness.behavior.runCli(
        ["run", session.id, "--thread", "thread-test", "--script", "1"],
        { threadId: "other" },
      );
      expect(denied.exitCode).toBe(1);
      expect(denied.stderr).toContain("another thread");
      expect(
        h.worker.mock.calls.filter(([call]) => call.method === "run"),
      ).toHaveLength(0);
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });
  it.each(["thread.archived", "thread.deleted", "thread.failed"] as const)(
    "%s closes only the owning thread's sessions",
    async (event) => {
      const h = await setup();
      try {
        const session = await h.open("personal");
        const other = rpcContract.open.output.parse(
          await h.harness.behavior.callRpc("open", {
            threadId: "other",
            selection: { backend: "local", hostId: "local-host" },
          }),
        );
        await h.harness.behavior.emitThreadEvent("thread.idle", {
          thread: makeThreadResponse({ id: "thread-test" }),
          lastAssistantText: null,
        });
        expect(
          h.worker.mock.calls.filter(([call]) => call.method === "close"),
        ).toHaveLength(0);
        await h.harness.behavior.emitThreadEvent(event, {
          thread: makeThreadResponse({ id: "thread-test" }),
          error: null,
        });
        const own = rpcContract.list.output.parse(
          await h.harness.behavior.callRpc("list", { threadId: "thread-test" }),
        );
        const remaining = rpcContract.list.output.parse(
          await h.harness.behavior.callRpc("list", { threadId: "other" }),
        );
        expect(own.find((entry) => entry.id === session.id)?.state).toBe(
          "closed",
        );
        expect(remaining.find((entry) => entry.id === other.id)?.state).toBe(
          "ready",
        );
        expect(
          h.harness.sdk.callsTo("experimental_desktopBrowsers.closeTab"),
        ).toHaveLength(0);
      } finally {
        await h.harness.lifecycle.dispose();
      }
    },
  );
  it("concurrent stop and close leave the session closed", async () => {
    const h = await setup();
    try {
      const session = await h.open();
      const input = { threadId: "thread-test", sessionId: session.id };
      await Promise.all([
        h.harness.behavior.callRpc("stop", input),
        h.harness.behavior.callRpc("close", input),
      ]);
      const sessions = rpcContract.list.output.parse(
        await h.harness.behavior.callRpc("list", { threadId: "thread-test" }),
      );
      expect(sessions.find((entry) => entry.id === session.id)?.state).toBe(
        "closed",
      );
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });
  it("waits for the browser host to finish installing the runtime before opening", async () => {
    const h = await setup();
    try {
      let polls = 0;
      h.worker.mockImplementation(async ({ method }) => {
        if (method === "prepare")
          return ++polls < 3
            ? { status: "installing", detail: `step ${polls}` }
            : { status: "ready", version: "1.0.0-test", source: "release" };
        return null;
      });
      await h.open();
      const methods = h.worker.mock.calls.map(([call]) => call.method);
      expect(methods.filter((method) => method === "prepare")).toHaveLength(3);
      expect(methods.indexOf("open")).toBeGreaterThan(
        methods.lastIndexOf("prepare"),
      );
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });
  it('gives startup and long scripts time to return their bounded cleanup result', async () => {
    const h = await setup();
    try {
      const session = await h.open();
      expect(h.worker.mock.calls.find(([call]) => call.method === 'open')?.[0].timeoutMs).toBe(45_000);
      await h.harness.behavior.callRpc('run', { threadId: 'thread-test', sessionId: session.id, script: 'await browser.listPages()', timeoutMs: 120_000 });
      expect(h.worker.mock.calls.find(([call]) => call.method === 'run')?.[0].timeoutMs).toBe(130_000);
    } finally { await h.harness.lifecycle.dispose(); }
  });
  it("cleans up a newly created tab when worker launch fails", async () => {
    const h = await setup();
    try {
      h.worker.mockImplementation(async ({ method }) => {
        if (method === "open") throw new Error("failed startup");
        if (method === "prepare")
          return { status: "ready", version: "1.0.0-test", source: "release" };
        return null;
      });
      await expect(h.open()).rejects.toThrow("failed startup");
      expect(
        h.harness.sdk.callsTo("experimental_desktopBrowsers.closeTab"),
      ).toHaveLength(1);
      expect(
        h.harness.sdk.callsTo("experimental_desktopBrowsers.releaseControl"),
      ).toHaveLength(1);
    } finally {
      await h.harness.lifecycle.dispose();
    }
  });
});


const localOpen = async (h: Awaited<ReturnType<typeof setup>>) => rpcContract.open.output.parse(await h.harness.behavior.callRpc('open', { threadId: 'thread-test', selection: { backend: 'local', hostId: 'local-host' } }));
describe('browser cleanup and recovery paths', () => {
  it('routes list/pages/preview/stop/close CLI calls and strips live preview bytes', async () => {
    const h = await setup();
    try {
      const session = await localOpen(h);
      for (const argv of [['list'], ['pages', session.id]]) expect((await h.harness.behavior.runCli(argv, { threadId: 'thread-test' })).exitCode).toBe(0);
      h.worker.mockResolvedValueOnce({ frame: { sequence: 1, mimeType: 'image/jpeg', data: 'YWJj', width: 1, height: 1, url: 'about:blank', title: 'Preview' } });
      const preview = await h.harness.behavior.runCli(['preview', session.id], { threadId: 'thread-test' });
      expect(JSON.parse(preview.stdout).frame).toMatchObject({ bytes: 3 }); expect(preview.stdout).not.toContain('YWJj');
      expect((await h.harness.behavior.runCli(['stop', session.id], { threadId: 'thread-test' })).exitCode).toBe(0);
      const stopped = await h.harness.behavior.callRpc('preview', { threadId: 'thread-test', sessionId: session.id }); expect(stopped).toMatchObject({ frame: null });
      const run = await h.harness.behavior.runCli(['run', session.id, '--script', '1'], { threadId: 'thread-test' }); expect(run.stderr).toContain('stopped or expired');
      expect((await h.harness.behavior.runCli(['close', session.id], { threadId: 'thread-test' })).exitCode).toBe(0);
    } finally { await h.harness.lifecycle.dispose(); }
  });
  it.each(['timeout', 'failure'])('stops sessions after a worker %s', async failure => {
    const h = await setup();
    try {
      const session = await localOpen(h);
      if (failure === 'timeout') h.worker.mockResolvedValueOnce({ text: 'timeout', images: [], exitCode: 124 });
      else h.worker.mockRejectedValueOnce(new Error('worker disconnected'));
      const result = await h.harness.behavior.runCli(['run', session.id, '--script', '1'], { threadId: 'thread-test' });
      expect(result.exitCode).toBe(failure === 'timeout' ? 124 : 1);
      expect(await h.harness.behavior.callRpc('list', { threadId: 'thread-test' })).toMatchObject([{ state: 'stopped' }]);
    } finally { await h.harness.lifecycle.dispose(); }
  });
  it('refuses missing desktop instances, cross-host endpoints and failed lease acquisition', async () => {
    const h = await setup();
    try {
      await expect(h.harness.behavior.callRpc('open', { threadId: 'thread-test', selection: { backend: 'desktop', hostId: 'desktop-host', instanceId: 'missing' } })).rejects.toThrow('unavailable');
      h.harness.sdk.stub('experimental_desktopBrowsers.openConnection', async () => ({ hostId: 'wrong', expiresAt: Date.now() + 10000, wsEndpoint: 'ws://localhost:1' }));
      await expect(h.open()).rejects.toThrow('different execution host');
      h.harness.sdk.stub('experimental_desktopBrowsers.acquireControl', async () => { throw new Error('cannot acquire'); });
      await expect(h.open()).rejects.toThrow('cannot acquire');
    } finally { await h.harness.lifecycle.dispose(); }
  });
  it('reads CLI script files only from their explicitly selected host and rejects binary or ambiguous relative paths', async () => {
    const h = await setup();
    try {
      const session = await localOpen(h);
      h.harness.sdk.stub('files.read', async () => ({ contentEncoding: 'utf8', content: 'await browser.listPages()' }));
      for (const [path, cwd] of [['script.js', '/project'], ['script.js', 'C:\\project'], ['/absolute/script.js', undefined]] as const) {
        const result = await h.harness.behavior.runCli(['run', session.id, '--script-file', path, '--script-host', 'source-host'], { threadId: 'thread-test', ...(cwd ? { cwd } : {}) });
        expect(result.exitCode, result.stderr).toBe(0);
      }
      expect(h.harness.sdk.callsTo('files.read')).toHaveLength(3);
      expect((await h.harness.behavior.runCli(['run', session.id, '--script-file', 'relative.js', '--script-host', 'source-host'], { threadId: 'thread-test' })).stderr).toContain('working directory');
      h.harness.sdk.stub('files.read', async () => ({ contentEncoding: 'base64', content: 'YWJj' }));
      expect((await h.harness.behavior.runCli(['run', session.id, '--script-file', '/binary', '--script-host', 'source-host'], { threadId: 'thread-test' })).stderr).toContain('UTF-8');
    } finally { await h.harness.lifecycle.dispose(); }
  });
  it('bounds live sessions and closes idle sessions while keeping running work alive', async () => {
    vi.useFakeTimers(); const h = await setup();
    try {
      for (let n = 0; n < 64; n++) await localOpen(h);
      await expect(localOpen(h)).rejects.toThrow('session limit');
      vi.setSystemTime(Date.now() + 5 * 60_000); await vi.advanceTimersByTimeAsync(1000);
      expect((await h.harness.behavior.callRpc('list', { threadId: 'thread-test' }) as { state: string }[]).every(s => s.state === 'closed')).toBe(true);
      await vi.waitFor(() => expect([...h.harness.kv.values()].every(value => !(value as { cleanupPending: boolean }).cleanupPending)).toBe(true));
      const session = await localOpen(h); let release!: (value: unknown) => void;
      h.worker.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
      const running = h.harness.behavior.callRpc('run', { threadId: 'thread-test', sessionId: session.id, script: '1' });
      await vi.advanceTimersByTimeAsync(1); vi.setSystemTime(Date.now() + 6 * 60_000); await vi.advanceTimersByTimeAsync(1000);
      expect((await h.harness.behavior.callRpc('list', { threadId: 'thread-test' }) as { id: string; state: string }[]).find(s => s.id === session.id)?.state).toBe('ready');
      release({ text: 'ok', images: [], exitCode: 0 }); await running;
    } finally { await h.harness.lifecycle.dispose(); vi.useRealTimers(); }
  });
  it('cleans saved sessions on restart, skips invalid/closed records and retains cleanup failures for retry', async () => {
    const before = await setup(); const session = await localOpen(before);
    const saved = structuredClone(before.harness.kv);
    await before.harness.lifecycle.dispose();
    saved.set('sessions/invalid', {});
    const closed = structuredClone(saved.values().next().value as any); closed.session.id = '00000000-0000-4000-8000-000000000099'; closed.session.state = 'closed';
    saved.set('sessions/thread-test/' + closed.session.id, closed);
    const h = await setup(saved);
    try {
      expect(h.worker).toHaveBeenCalledWith(expect.objectContaining({ method: 'close', input: { sessionId: session.id } }));
      const other = await localOpen(h); h.worker.mockRejectedValueOnce(new Error('offline'));
      await h.harness.behavior.callRpc('close', { threadId: 'thread-test', sessionId: other.id });
      const value = h.harness.kv.get('sessions/thread-test/' + other.id) as any; expect(value.cleanupPending).toBe(true);
    } finally { await h.harness.lifecycle.dispose(); }
  });
});

it('stops on revoked desktop leases/subscription errors and closes only the failed worker host', async () => {
  const h = await setup();
  try {
    const first = await h.open();
    h.subscriptions[0].onChange({ tabs: [{ control: { leaseId: 'lease' } }] });
    expect(h.worker.mock.calls.filter(([call]) => call.method === 'close')).toHaveLength(0);
    h.subscriptions[0].onChange({ tabs: [] });
    await vi.waitFor(async () => expect(await h.harness.behavior.callRpc('list', { threadId: 'thread-test' })).toMatchObject([{ state: 'stopped' }]));
    const second = await h.open(); h.subscriptions[1].onError(new Error('lost subscription'));
    await vi.waitFor(async () => expect((await h.harness.behavior.callRpc('list', { threadId: 'thread-test' }) as any[]).find(s => s.id === second.id).state).toBe('stopped'));
    const local = await localOpen(h); await h.workerExit('desktop-host');
    const listed = await h.harness.behavior.callRpc('list', { threadId: 'thread-test' }) as any[];
    expect(listed.find(s => s.id === first.id).state).toBe('closed'); expect(listed.find(s => s.id === second.id).state).toBe('closed'); expect(listed.find(s => s.id === local.id).state).toBe('ready');
  } finally { await h.harness.lifecycle.dispose(); }
});
