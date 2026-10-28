import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

/**
 * The spawned-process suite (`bridge-worker-entry.test.ts`) proves the real
 * bootstrap; this one loads the same entry in-process so its shutdown path is
 * measured. The line reader is replaced so the test can close stdin itself.
 */

const reader = vi.hoisted(() => ({
  onClose: null as null | (() => void),
}));

vi.mock("./bridge-kit/bounded-line-reader.js", () => ({
  readBoundedLines: (options: { onClose: () => void }) => {
    reader.onClose = options.onClose;
  },
}));

let base: string;
let userSkills: string;
const argv = process.argv;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "zcc-bootstrap-in-process-"));
  userSkills = join(base, "user-skills");
  await mkdir(join(userSkills, "my-skill"), { recursive: true });
  await writeFile(join(userSkills, "my-skill", "SKILL.md"), "keep me\n");
  const bridgeModulePath = join(base, "artifact.mjs");
  await writeFile(
    bridgeModulePath,
    [
      "import { mkdirSync, symlinkSync } from 'node:fs';",
      "import { join } from 'node:path';",
      "export const experimental_providerBridge = {",
      "  experimental_apiVersion: 1,",
      "  start(context) {",
      "    globalThis.__bridgeTempDir = context.tempDir;",
      "    mkdirSync(join(context.tempDir, 'skills', 'plugin'), { recursive: true });",
      `    symlinkSync(${JSON.stringify(userSkills)}, join(context.tempDir, 'skills', 'plugin', 'skills'), 'junction');`,
      "  },",
      "  handleLine() {},",
      "  onClose() { globalThis.__bridgeClosed = true; },",
      "};",
    ].join("\n"),
  );
  process.argv = [
    argv[0] ?? process.execPath,
    fileURLToPath(new URL("./bridge-worker-entry.ts", import.meta.url)),
    bridgeModulePath,
    "provider-fixture",
    base,
  ];
  await import("./bridge-worker-entry.js");
});

afterAll(async () => {
  process.argv = argv;
  await rm(base, { recursive: true, force: true });
});

it("closing stdin removes the temp dir and leaves linked folders intact", async () => {
  const tempDir = (globalThis as { __bridgeTempDir?: string }).__bridgeTempDir;
  expect(tempDir).toBeDefined();
  expect(existsSync(join(tempDir!, "skills", "plugin", "skills"))).toBe(true);

  reader.onClose?.();

  expect(existsSync(tempDir!)).toBe(false);
  expect((globalThis as { __bridgeClosed?: boolean }).__bridgeClosed).toBe(true);
  expect(await readFile(join(userSkills, "my-skill", "SKILL.md"), "utf8")).toBe(
    "keep me\n",
  );
});
