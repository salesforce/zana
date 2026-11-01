import { once } from "node:events";
import { afterEach, expect, it, vi } from "vitest";

const crossSpawnCalls = vi.hoisted(() => [] as Array<{ command: string; options: Record<string, unknown> }>);

vi.mock("cross-spawn", async (importOriginal) => {
  const actual = await importOriginal<{ default: (...args: unknown[]) => unknown }>();
  const wrapped = (command: string, args: string[], options: Record<string, unknown>) => {
    crossSpawnCalls.push({ command, options });
    return actual.default(command, args, options);
  };
  return { ...actual, default: wrapped };
});

const { runPortableCommand, spawnPortableOutputProcess, spawnPortablePipedProcess, spawnPortableProcess } =
  await import("../src/index.js");

afterEach(() => {
  crossSpawnCalls.length = 0;
});

// Electron is a GUI process: on Windows a console child without windowsHide
// (including the cmd.exe that wraps `.cmd` shims) opens a visible console.
it("hides the console window for every portable spawn entry point", async () => {
  const script = ["-e", "process.stdout.write('ok')"];
  const plain = spawnPortableProcess({ command: process.execPath, args: script, stdio: "ignore" });
  const piped = spawnPortablePipedProcess({ command: process.execPath, args: script });
  const output = spawnPortableOutputProcess({ command: process.execPath, args: script });
  await Promise.all([once(plain, "exit"), once(piped, "exit"), once(output, "exit")]);
  await expect(runPortableCommand(process.execPath, script, { timeout: 10_000 })).resolves.toMatchObject({ stdout: "ok" });

  expect(crossSpawnCalls).toHaveLength(4);
  for (const call of crossSpawnCalls) expect(call.options.windowsHide).toBe(true);
});
