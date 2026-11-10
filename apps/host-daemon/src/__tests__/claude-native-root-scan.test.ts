import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { normalizeProviderNativeRoots } from "@zana-ai/zcc-domain/thread-runtime";
import { experimental_nativeRootsHostContract } from "@zana-ai/zcc-plugin-sdk/host";
import { resolveDeclaredScanRoots } from "../native-root-scan.js";
import { CLAUDE_NATIVE_ROOTS_DECLARATION, resolveClaudeNativeRoots } from "../../../../plugins/provider-claude-code/src/native-roots.js";

let home: string | undefined;
afterEach(async () => { if (home) await rm(home, { recursive: true, force: true }); });

it.each([false, true])("scans the selected user config and preserves project roots (custom=%s)", async (custom) => {
  home = await mkdtemp(join(tmpdir(), "zcc-claude-scan-"));
  const cwd = join(home, "project");
  const defaultSkills = join(home, ".claude", "skills");
  const config = custom ? join(home, "custom-claude") : join(home, ".claude");
  const projectSkills = join(cwd, ".claude", "skills");
  for (const root of [defaultSkills, join(config, "skills"), projectSkills]) await mkdir(root, { recursive: true });
  const resolved = experimental_nativeRootsHostContract.resolveNativeRoots.output.parse(
    await resolveClaudeNativeRoots({ homeDir: home, cwd, env: custom ? { CLAUDE_CONFIG_DIR: config } : {} }),
  );
  const roots = await resolveDeclaredScanRoots({ homeDir: home, cwd, providerId: "claude-code", nativeRoots: {
    skills: normalizeProviderNativeRoots(CLAUDE_NATIVE_ROOTS_DECLARATION.experimental_nativeSkillRoots ?? {}),
    commands: normalizeProviderNativeRoots(CLAUDE_NATIVE_ROOTS_DECLARATION.experimental_nativeCommandRoots ?? {}),
    resolved,
  } });
  const paths = roots.flatMap(root => "rootPath" in root ? [root.rootPath] : []);
  expect(paths).toContain(join(config, "skills"));
  expect(paths).toContain(projectSkills);
  expect(paths.filter(path => path === defaultSkills)).toHaveLength(custom ? 0 : 1);
});
