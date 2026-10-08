import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { runPortableCommand } from "../src/index.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

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

it.runIf(process.platform === "win32")("runs npm-style cmd shims from PATH with spaces", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "portable cmd "));
  dirs.push(cwd);
  writeFileSync(join(cwd, "zcc-probe.cmd"), "@echo off\r\necho shim-ok\r\n");
  const output = await runPortableCommand("zcc-probe", [], { timeout: 5000, env: { ...process.env, PATH: `${cwd};${process.env.PATH}` } });
  expect(output.stdout.trim()).toBe("shim-ok");
});
