import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAutomatedConfigDirWithWarnings,
  mcpLaunchWarningDeltas,
} from "../automated-config-dir.js";
import { claudeThreadStartParamsSchema } from "../commands.js";
import { buildClaudeSessionParams } from "../../session-params.js";

const SECRET = "sk-super-secret-value-123";

describe("persona MCP allowlist launch warnings (bridge)", () => {
  let dataDir: string;
  let sourceDir: string;
  const env = () => ({ CLAUDE_CONFIG_DIR: sourceDir, ANTHROPIC_API_KEY: "test-key" });
  const seed = (mcpServers: unknown) =>
    writeFileSync(join(sourceDir, ".claude.json"), JSON.stringify({ mcpServers }));

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "zcc-mcpw-data-"));
    sourceDir = mkdtempSync(join(tmpdir(), "zcc-mcpw-src-"));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  });

  it("AC-15: the warning names the allowlisted server whose credentials were stripped, without the secret", () => {
    seed({
      github: { command: "gh-mcp", env: { GITHUB_TOKEN: SECRET } },
      other: { command: "x" },
    });
    const { configDir, warnings } = createAutomatedConfigDirWithWarnings(dataDir, "t", {
      sourceConfigDir: sourceDir,
      env: env(),
      mcpAllowlist: ["zcc-inbox", "github"],
    });
    const deltas = mcpLaunchWarningDeltas(warnings);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ kind: "provider.warning" });
    expect(deltas[0]!.summary).toContain("github");
    expect(deltas[0]!.details).toMatch(/stripped/);
    expect(JSON.stringify(deltas)).not.toContain(SECRET);
    // The non-allowlisted user server is not carried into the isolated config.
    const seeded = JSON.parse(readFileSync(join(configDir, ".claude.json"), "utf8"));
    expect(Object.keys(seeded.mcpServers)).toEqual(["github"]);
  });

  it("names an allowlisted server that is missing from the user config", () => {
    seed({ other: { command: "x" } });
    const { warnings } = createAutomatedConfigDirWithWarnings(dataDir, "t", {
      sourceConfigDir: sourceDir,
      env: env(),
      mcpAllowlist: ["zcc-inbox", "ghost"],
    });
    const [delta] = mcpLaunchWarningDeltas(warnings);
    expect(delta!.summary).toContain("ghost");
    expect(delta!.details).toMatch(/not found/);
  });

  it("does not warn for a server Zana injects as a plugin server (externally provided)", () => {
    seed({});
    const { warnings } = createAutomatedConfigDirWithWarnings(dataDir, "t", {
      sourceConfigDir: sourceDir,
      env: env(),
      mcpAllowlist: ["zcc-inbox", "search"],
      externallyProvidedMcps: ["search"],
    });
    expect(mcpLaunchWarningDeltas(warnings)).toEqual([]);
  });

  it("an unrestricted seed (no allowlist) yields no warnings", () => {
    seed({ a: { command: "x", env: { K: SECRET } } });
    const { warnings } = createAutomatedConfigDirWithWarnings(dataDir, "t", {
      sourceConfigDir: sourceDir,
      env: env(),
    });
    expect(warnings).toEqual([]);
    expect(mcpLaunchWarningDeltas([])).toEqual([]);
  });
});

describe("persona MCP allowlist wire params", () => {
  const base = {
    threadId: "t",
    cwd: "/x",
    baseInstructions: "",
    permissionMode: "default",
    approvedPlanPermissionMode: "default",
    permissionScope: "workspace",
    permissionEscalation: "ask",
    workflowsEnabled: false,
    idleQueryReleaseEnabled: false,
    chromeEnabled: false,
    instructionMode: "append",
  };
  const build = (providerOptions?: Record<string, unknown>) =>
    buildClaudeSessionParams({
      threadId: "t",
      cwd: "/x",
      instructionMode: "append",
      options: {
        permissionScope: "workspace",
        permissionEscalation: "ask",
        ...(providerOptions ? { providerOptions } : {}),
      } as never,
    });

  it("carries the allowlist and externally-provided names, names only, no credential fields", () => {
    const params = build({ mcpAllowlist: ["zcc-inbox", "github"], mcpExternallyProvided: ["search"] });
    expect(params.mcpAllowlist).toEqual(["zcc-inbox", "github"]);
    expect(params.mcpExternallyProvided).toEqual(["search"]);
    expect(Object.keys(params).filter((key) => /token|secret|env|header|credential/i.test(key))).toEqual([]);
  });

  it("an empty restriction list is preserved; absent allowlist emits neither field", () => {
    expect(build({ mcpAllowlist: [] }).mcpAllowlist).toEqual([]);
    expect(build({ mcpAllowlist: [] }).mcpExternallyProvided).toEqual([]);
    const none = build();
    expect("mcpAllowlist" in none).toBe(false);
    expect("mcpExternallyProvided" in none).toBe(false);
  });

  it("the strict start schema accepts the fields and bounds them", () => {
    const ok = claudeThreadStartParamsSchema.safeParse({ ...base, mcpAllowlist: ["zcc-inbox"], mcpExternallyProvided: [] });
    expect(ok.success).toBe(true);
    expect(claudeThreadStartParamsSchema.safeParse({ ...base, mcpAllowlist: [""] }).success).toBe(false);
    expect(claudeThreadStartParamsSchema.safeParse({ ...base, mcpAllowlist: Array(129).fill("a") }).success).toBe(false);
  });
});
