import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { runPortableCommand, shutdownPortableCommands } from "../src/index.js";

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// Final shutdown permanently closes this isolated test file's command owner.
it.runIf(process.platform !== "win32")("reaps owned groups, settles blocked probes and denies late work across bundled copies", async () => {
  const directory = mkdtempSync(join(tmpdir(), "portable-shutdown-"));
  const pidFiles = [join(directory, "first.json"), join(directory, "second.json")];
  const wrapper = join(directory, "wrapper.cjs");
  const lateMarker = join(directory, "late-marker");
  writeFileSync(wrapper, `
const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
require('node:fs').writeFileSync(process.argv[2] + '.tmp', JSON.stringify([process.pid, child.pid]));
require('node:fs').renameSync(process.argv[2] + '.tmp', process.argv[2]);
setInterval(() => {}, 1000);
`);
  const bundled = await import(`${new URL("../src/index.ts", import.meta.url).href}?shutdown-copy`);
  let settled = 0;
  const operations = [runPortableCommand, bundled.runPortableCommand].map((run, index) =>
    run(process.execPath, [wrapper, pidFiles[index]!], { timeout: 60_000 }).catch((error: unknown) => {
      settled += 1;
      return error;
    }));
  let resume!: () => void;
  const resumed = new Promise<void>(resolve => { resume = resolve; });
  const late = resumed.then(() => bundled.runPortableCommand(process.execPath,
    ["-e", `require('node:fs').writeFileSync(${JSON.stringify(lateMarker)}, 'unexpected')`], { timeout: 5000 }));
  const lateResult = late.catch(error => error);
  try {
    await expect.poll(() => pidFiles.every(file => existsSync(file)), { timeout: 5000 }).toBe(true);
    const groups = pidFiles.map(file => JSON.parse(readFileSync(file, "utf8")) as number[]);
    const originalKill = process.kill.bind(process);
    // A shutdown promise must settle even if signaling cannot close its pipes.
    vi.spyOn(process, "kill").mockImplementation((pid, signal) =>
      pid === -groups[1]![0]! ? true : originalKill(pid, signal));
    shutdownPortableCommands();
    await Promise.resolve();
    expect(settled).toBe(2);
    for (const result of await Promise.all(operations)) expect(result).toMatchObject({ message: "Portable commands are shutting down" });
    expect(groups[1]!.every(isAlive)).toBe(true);
    vi.restoreAllMocks();
    await expect.poll(() => groups[0]!.every(pid => !isAlive(pid)), { timeout: 5000 }).toBe(true);

    shutdownPortableCommands();
    resume();
    expect(await lateResult).toMatchObject({ message: "Portable commands are shutting down" });
    await expect(runPortableCommand(process.execPath, [], { timeout: 5000 })).rejects.toThrow("shutting down");
    expect(existsSync(lateMarker)).toBe(false);
  } finally {
    vi.restoreAllMocks();
    resume();
    for (const file of pidFiles) {
      if (!existsSync(file)) continue;
      for (const pid of JSON.parse(readFileSync(file, "utf8")) as number[]) {
        try { process.kill(pid, "SIGKILL"); } catch { /* Already reaped. */ }
      }
    }
    await Promise.all(operations);
    rmSync(directory, { recursive: true, force: true });
  }
});
