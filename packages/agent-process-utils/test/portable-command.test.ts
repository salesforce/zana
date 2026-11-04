import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const shutdownSignals = ["SIGTERM", "SIGINT"] as const;
const previousShutdownListeners = new Map(shutdownSignals.map(signal => [signal, new Set(process.listeners(signal))]));
const { runPortableCommand } = await import("../src/index.js");
const commandCleanupListeners = new Map(shutdownSignals.map(signal => [
  signal, process.listeners(signal).filter(listener => !previousShutdownListeners.get(signal)!.has(listener)),
]));

const dirs: string[] = [];
const pidFiles: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const file of pidFiles.splice(0)) {
    if (!existsSync(file)) continue;
    for (const pid of JSON.parse(readFileSync(file, "utf8")) as number[]) {
      try { process.kill(pid, "SIGKILL"); } catch { /* Fixture already reaped. */ }
    }
  }
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

function commandTreeFixture(mode: "timeout" | "overflow" | "success" | "nonzero") {
  const cwd = mkdtempSync(join(tmpdir(), "portable-tree-"));
  dirs.push(cwd);
  const pids = join(cwd, "pids.json");
  pidFiles.push(pids);
  const wrapper = join(cwd, "wrapper.cjs");
  writeFileSync(wrapper, `
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
require('node:fs').writeFileSync(${JSON.stringify(`${pids}.tmp`)}, JSON.stringify([process.pid, child.pid]));
require('node:fs').renameSync(${JSON.stringify(`${pids}.tmp`)}, ${JSON.stringify(pids)});
${mode === "success" ? "process.stdout.write('complete-output'); process.exit(0);"
    : mode === "nonzero" ? "process.stderr.write('wrapper failed'); process.exit(7);"
    : mode === "overflow" ? "process.stdout.write('x'.repeat(10000)); setInterval(() => {}, 1000);"
    : "setInterval(() => {}, 1000);"}
`);
  return { wrapper, pids };
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function expectFixtureGone(file: string) {
  expect(existsSync(file)).toBe(true);
  const pids = JSON.parse(readFileSync(file, "utf8")) as number[];
  await expect.poll(() => pids.every(pid => !isAlive(pid)), { timeout: 5000 }).toBe(true);
}

it("preserves large UTF-8 output, literal args, cwd and env", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "portable command "));
  dirs.push(cwd);
  const arg = "space & literal $(echo nope)";
  const output = await runPortableCommand(process.execPath, ["-e",
    'process.stdout.write(JSON.stringify({arg:process.argv[1],cwd:process.cwd(),env:process.env.PROBE_VALUE,text:"é🙂".repeat(10000)}));process.stderr.write("diagnostic");', arg],
  { timeout: 5000, cwd, env: { ...process.env, PROBE_VALUE: "value" } });
  expect(JSON.parse(output.stdout)).toMatchObject({ arg, env: "value", text: "é🙂".repeat(10000) });
  // macOS canonicalizes /var to /private/var in process.cwd().
  expect(JSON.parse(output.stdout).cwd.endsWith(cwd.replace(/^\/private/, ""))).toBe(true);
  expect(output.stderr).toBe("diagnostic");
});

it("reports missing executables and nonzero exit diagnostics", async () => {
  await expect(runPortableCommand("zcc-nonexistent-probe", [], { timeout: 5000 })).rejects.toMatchObject({ code: "ENOENT" });
  await expect(runPortableCommand(process.execPath, ["-e", 'process.stderr.write("failed");process.exit(7)'], { timeout: 5000 }))
    .rejects.toMatchObject({ message: "failed", code: 7 });
  await expect(runPortableCommand(process.execPath, ["-e", "process.exit(8)"], { timeout: 5000 }))
    .rejects.toThrow("Command exited with code 8");
});

it("settles a timed-out command and caps combined stdout/stderr", async () => {
  await expect(runPortableCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeout: 100 }))
    .rejects.toMatchObject({ killed: true });
  await expect(runPortableCommand(process.execPath, ["-e", 'process.stdout.write("a".repeat(100));process.stderr.write("b".repeat(100))'], { timeout: 5000, maxBuffer: 150 }))
    .rejects.toThrow("byte limit");
});

it.runIf(process.platform !== "win32").each(["timeout", "overflow", "success", "nonzero"] as const)(
  "reaps wrapper descendants after %s, including inherited output pipes", async mode => {
    const fixture = commandTreeFixture(mode);
    const operation = runPortableCommand(process.execPath, [fixture.wrapper], { timeout: 1000, maxBuffer: 1000 });
    if (mode === "success") await expect(operation).resolves.toEqual({ stdout: "complete-output", stderr: "" });
    else await expect(operation).rejects.toThrow(mode === "timeout" ? "timed out" : mode === "overflow" ? "byte limit" : "wrapper failed");
    await expectFixtureGone(fixture.pids);
  },
);

it.runIf(process.platform !== "win32").each(["exit", "SIGTERM", "SIGINT"] as const)("reaps in-flight command trees when their owner receives %s", async (shutdown) => {
  const fixture = commandTreeFixture("timeout");
  const utilityUrl = new URL("../src/index.ts", import.meta.url).href;
  const owner = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", `
const { runPortableCommand } = await import(${JSON.stringify(utilityUrl)});
void runPortableCommand(process.execPath, [${JSON.stringify(fixture.wrapper)}], { timeout: 60000 }).catch(() => {});
process.stdin.once('data', () => process.exit(0));
`], { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  owner.stderr!.on("data", chunk => { stderr += String(chunk); });
  try {
    await expect.poll(() => existsSync(fixture.pids) || stderr, { timeout: 5000 }).toBe(true);
    const exited = once(owner, "exit");
    if (shutdown === "exit") owner.stdin!.end("exit");
    else owner.kill(shutdown);
    expect(await exited).toEqual(shutdown === "exit" ? [0, null] : [null, shutdown]);
    await expectFixtureGone(fixture.pids);
  } finally { if (owner.exitCode === null) owner.kill("SIGKILL"); }
});

it.runIf(process.platform !== "win32")("preserves an owner's existing once signal handler without terminating it", async () => {
  const fixture = commandTreeFixture("timeout");
  const utilityUrl = new URL("../src/index.ts", import.meta.url).href;
  const owner = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", `
process.once('SIGTERM', () => process.stdout.write('handled'));
const { runPortableCommand } = await import(${JSON.stringify(utilityUrl)});
void runPortableCommand(process.execPath, [${JSON.stringify(fixture.wrapper)}], { timeout: 60000 }).catch(() => {});
process.stdin.once('data', () => process.exit(23));
`], { stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  owner.stderr!.on("data", chunk => { stderr += String(chunk); });
  try {
    await expect.poll(() => existsSync(fixture.pids) || stderr, { timeout: 5000 }).toBe(true);
    const handled = once(owner.stdout!, "data");
    owner.kill("SIGTERM");
    expect(String((await handled)[0])).toBe("handled");
    await expectFixtureGone(fixture.pids);
    expect(owner.exitCode).toBeNull();
    expect(owner.signalCode).toBeNull();
    const exited = once(owner, "exit");
    owner.stdin!.end("exit");
    expect(await exited).toEqual([23, null]);
  } finally { if (owner.exitCode === null) owner.kill("SIGKILL"); }
});

it.runIf(process.platform !== "win32").each(shutdownSignals)(
  "cleans owned probes on %s and delegates to the owner or the default signal action", async signal => {
    const listeners = commandCleanupListeners.get(signal)!;
    expect(listeners).toHaveLength(1);
    const cleanup = listeners[0]!;
    const originalKill = process.kill.bind(process);
    const kill = vi.spyOn(process, "kill").mockImplementation((pid, receivedSignal) =>
      pid === process.pid ? true : originalKill(pid, receivedSignal));
    const removeListener = vi.spyOn(process, "removeListener").mockReturnValue(process);
    const getListeners = vi.spyOn(process, "listeners");

    for (const hasOwnerHandler of [true, false]) {
      const fixture = commandTreeFixture("timeout");
      const operation = runPortableCommand(process.execPath, [fixture.wrapper], { timeout: 5000 });
      const settled = operation.catch(error => error);
      await expect.poll(() => existsSync(fixture.pids), { timeout: 5000 }).toBe(true);
      getListeners.mockReturnValue(hasOwnerHandler ? [cleanup, () => {}] : [cleanup]);

      cleanup(signal);

      expect(await settled).toMatchObject({ signal: "SIGKILL" });
      await expectFixtureGone(fixture.pids);
      if (hasOwnerHandler) {
        expect(removeListener).not.toHaveBeenCalledWith(signal, cleanup);
        expect(kill).not.toHaveBeenCalledWith(process.pid, signal);
      } else {
        expect(removeListener).toHaveBeenCalledWith(signal, cleanup);
        expect(kill).toHaveBeenCalledWith(process.pid, signal);
        const removal = removeListener.mock.calls.findIndex(([event, listener]) => event === signal && listener === cleanup);
        const reraised = kill.mock.calls.findIndex(([pid, receivedSignal]) => pid === process.pid && receivedSignal === signal);
        expect(removeListener.mock.invocationCallOrder[removal]).toBeLessThan(kill.mock.invocationCallOrder[reraised]!);
      }
    }
  },
);

it("does not accumulate shutdown listeners across bundled copies or completed and failed probes", async () => {
  const signals = ["exit", "SIGTERM", "SIGINT"] as const;
  const before = signals.map(signal => process.listenerCount(signal));
  const bundledCopy = await import(`${new URL("../src/index.ts", import.meta.url).href}?portable-command-copy`);
  await bundledCopy.runPortableCommand(process.execPath, ["-e", "process.exit(0)"], { timeout: 1000 });
  await runPortableCommand(process.execPath, ["-e", "process.exit(0)"], { timeout: 1000 });
  await expect(runPortableCommand("zcc-missing-cleanup-test", [], { timeout: 1000 })).rejects.toThrow();
  expect(signals.map(signal => process.listenerCount(signal))).toEqual(before);
});

it.runIf(process.platform === "win32")("runs npm-style cmd shims from PATH with spaces", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "portable cmd "));
  dirs.push(cwd);
  writeFileSync(join(cwd, "zcc-probe.cmd"), "@echo off\r\necho shim-ok\r\n");
  const output = await runPortableCommand("zcc-probe", [], { timeout: 5000, env: { ...process.env, PATH: `${cwd};${process.env.PATH}` } });
  expect(output.stdout.trim()).toBe("shim-ok");
});
