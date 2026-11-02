import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  automatedConfigParent,
  automatedSourceGlobalConfig,
  buildSeedSettings,
  sanitizeMcpServers,
  createAutomatedConfigDir,
  removeAutomatedConfigDir,
  seedAutomatedConfigDir,
  sweepAutomatedConfigDirs,
} from "../automated-config-dir.js";

describe("automated config dir lifecycle", () => {
  let dataDir: string;
  let sourceDir: string;
  let priorConfigDir: string | undefined;
  let priorApiKey: string | undefined;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "zcc-cfgdir-"));
    sourceDir = mkdtempSync(join(tmpdir(), "zcc-cfgsrc-"));
    // Keep the lifecycle tests off the developer's real ~/.claude.
    priorConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = sourceDir;
    // Isolation only applies when the isolated dir can authenticate.
    priorApiKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";
  });
  afterEach(() => {
    if (priorConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = priorConfigDir;
    if (priorApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = priorApiKey;
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  });

  it("creates 0700 parent and leaf under the data dir", () => {
    const leaf = createAutomatedConfigDir(dataDir, "thread-1")!;
    expect(leaf).toBe(join(automatedConfigParent(dataDir), "thread-1"));
    expect(statSync(leaf).mode & 0o777).toBe(0o700);
    expect(statSync(automatedConfigParent(dataDir)).mode & 0o777).toBe(0o700);
  });

  describe("authentication gate", () => {
    it("blocks and removes the leaf for an OAuth-only home", () => {
      writeFileSync(join(sourceDir, "settings.json"), JSON.stringify({ hooks: {} }));
      writeFileSync(
        join(sourceDir, ".claude.json"),
        JSON.stringify({ oauthAccount: { emailAddress: "a@b.c" } }),
      );
      expect(() => createAutomatedConfigDir(dataDir, "oauth", { sourceConfigDir: sourceDir, env: {} }))
        .toThrow(/authentication-unavailable/);
      expect(existsSync(join(automatedConfigParent(dataDir), "oauth"))).toBe(false);
    });

    it.each([
      ["apiKeyHelper", { apiKeyHelper: "h" }],
      ["awsCredentialExport", { awsCredentialExport: "e" }],
      ["seeded ANTHROPIC_API_KEY", { env: { ANTHROPIC_API_KEY: "k" } }],
      ["seeded CLAUDE_CODE_USE_VERTEX", { env: { CLAUDE_CODE_USE_VERTEX: "1" } }],
    ])("keeps the leaf when settings carry %s", (_label, settings) => {
      writeFileSync(join(sourceDir, "settings.json"), JSON.stringify(settings));
      expect(createAutomatedConfigDir(dataDir, "a", { sourceConfigDir: sourceDir, env: {} })).not.toBeNull();
    });

    it("ignores empty env credentials", () => {
      expect(() => createAutomatedConfigDir(dataDir, "b", {
          env: { CLAUDE_CONFIG_DIR: sourceDir, ANTHROPIC_API_KEY: "" },
        }))
        .toThrow(/authentication-unavailable/);
    });
  });

  it("reuses the same leaf for the same owner and a new one after delete", () => {
    const first = createAutomatedConfigDir(dataDir, "thread-1")!;
    expect(createAutomatedConfigDir(dataDir, "thread-1")).toBe(first);
    removeAutomatedConfigDir(dataDir, first);
    expect(existsSync(first)).toBe(false);
    expect(createAutomatedConfigDir(dataDir, "thread-1")).toBe(first);
    expect(existsSync(first)).toBe(true);
  });

  it("sanitizes owner ids so a path cannot escape the parent", () => {
    const leaf = createAutomatedConfigDir(dataDir, "../../etc")!;
    expect(leaf.startsWith(`${automatedConfigParent(dataDir)}/`)).toBe(true);
    expect(() => createAutomatedConfigDir(dataDir, "..")).toThrow(/config-unavailable/);
    expect(() => createAutomatedConfigDir(dataDir, "")).toThrow(/config-unavailable/);
  });

  it("refuses to remove a path outside the parent", () => {
    expect(() => removeAutomatedConfigDir(dataDir, dataDir)).toThrow(/escapes/);
    expect(() =>
      removeAutomatedConfigDir(dataDir, join(dataDir, "elsewhere")),
    ).toThrow(/escapes/);
  });

  it("seeds only auth and gateway keys, never hooks, plugins or telemetry env", () => {
    writeFileSync(
      join(sourceDir, "settings.json"),
      JSON.stringify({
        apiKeyHelper: "/bin/helper",
        hooks: { PreToolUse: [{ command: "evil" }] },
        enabledPlugins: { "x@y": true },
        permissions: { allow: ["Bash(*)"] },
        env: {
          ANTHROPIC_BASE_URL: "https://gw.example",
          CLAUDE_CODE_USE_BEDROCK: "1",
          NODE_EXTRA_CA_CERTS: "/ca.pem",
          OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example",
          SOME_OTHER: "x",
        },
      }),
    );
    const leaf = createAutomatedConfigDir(dataDir, "thread-1")!;
    const seeded = JSON.parse(readFileSync(join(leaf, "settings.json"), "utf8"));
    expect(seeded).toEqual({
      apiKeyHelper: "/bin/helper",
      env: {
        ANTHROPIC_BASE_URL: "https://gw.example",
        CLAUDE_CODE_USE_BEDROCK: "1",
        NODE_EXTRA_CA_CERTS: "/ca.pem",
      },
    });
    expect(statSync(join(leaf, "settings.json")).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(join(leaf, ".claude.json"), "utf8"))).toEqual({
      hasCompletedOnboarding: true,
    });
  });

  it("seeds nothing when the source settings are missing, invalid or carry no auth keys", () => {
    const leaf = createAutomatedConfigDir(dataDir, "thread-1")!;
    expect(seedAutomatedConfigDir(leaf)).toBe("none");
    writeFileSync(join(sourceDir, "settings.json"), "{not json");
    expect(seedAutomatedConfigDir(leaf)).toBe("none");
    writeFileSync(join(sourceDir, "settings.json"), "[]");
    expect(seedAutomatedConfigDir(leaf)).toBe("none");
    writeFileSync(
      join(sourceDir, "settings.json"),
      JSON.stringify({ hooks: {}, env: { OTEL_X: "1" } }),
    );
    expect(seedAutomatedConfigDir(leaf)).toBe("none");
    expect(existsSync(join(leaf, "settings.json"))).toBe(false);
  });

  it("honours explicit seed options over the process env", () => {
    const other = mkdtempSync(join(tmpdir(), "zcc-cfgsrc2-"));
    writeFileSync(join(other, "settings.json"), JSON.stringify({ apiKeyHelper: "h2" }));
    const leaf = createAutomatedConfigDir(dataDir, "thread-2", { sourceConfigDir: other })!;
    expect(JSON.parse(readFileSync(join(leaf, "settings.json"), "utf8"))).toEqual({
      apiKeyHelper: "h2",
    });
    rmSync(other, { recursive: true, force: true });
  });

  it("sweeps expired unowned leaves and keeps live or fresh ones", () => {
    const now = Date.now();
    const old = createAutomatedConfigDir(dataDir, "old")!;
    const live = createAutomatedConfigDir(dataDir, "live")!;
    const fresh = createAutomatedConfigDir(dataDir, "fresh")!;
    const past = new Date(now - 10_000);
    utimesSync(old, past, past);
    utimesSync(live, past, past);

    const removed = sweepAutomatedConfigDirs({
      dataDir,
      liveOwnerIds: new Set(["live"]),
      ttlMs: 5_000,
      now,
    });

    expect(removed).toEqual(["old"]);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(fresh)).toBe(true);
  });

  it("sweep is a no-op when the parent does not exist", () => {
    mkdirSync(join(dataDir, "x"));
    expect(
      sweepAutomatedConfigDirs({ dataDir, liveOwnerIds: new Set(), ttlMs: 0 }),
    ).toEqual([]);
  });
});

describe("automated config dir carry-over (MCP + bypass consent)", () => {
  const SECRET = "sk-super-secret-value-123";
  let dataDir: string;
  let sourceDir: string;
  const env = () => ({ CLAUDE_CONFIG_DIR: sourceDir, ANTHROPIC_API_KEY: "test-key" });
  const writeGlobal = (value: unknown) =>
    writeFileSync(join(sourceDir, ".claude.json"), JSON.stringify(value));
  const seededGlobal = (leaf: string) =>
    JSON.parse(readFileSync(join(leaf, ".claude.json"), "utf8"));
  const seededSettings = (leaf: string) =>
    JSON.parse(readFileSync(join(leaf, "settings.json"), "utf8"));

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "zcc-cfgmcp-data-"));
    sourceDir = mkdtempSync(join(tmpdir(), "zcc-cfgmcp-src-"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  });

  it("carries only type/command/args/url and never env, headers or unknown fields", () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "info"), vi.spyOn(console, "debug")];
    writeGlobal({
      oauthAccount: { emailAddress: "a@b.c" },
      projects: { "/x": { hasTrustDialogAccepted: true } },
      mcpServers: {
        local: {
          type: "stdio",
          command: "npx",
          args: ["-y", "server-fs", "/tmp"],
          env: { GITHUB_TOKEN: SECRET },
          extra: SECRET,
        },
        remote: {
          type: "http",
          url: "https://mcp.example/mcp",
          headers: { Authorization: `Bearer ${SECRET}` },
          headersHelper: "/bin/h",
          oauth: { clientId: SECRET },
        },
      },
    });
    const leaf = createAutomatedConfigDir(dataDir, "t", { sourceConfigDir: sourceDir, env: env() });
    expect(seededGlobal(leaf)).toEqual({
      hasCompletedOnboarding: true,
      mcpServers: {
        local: { type: "stdio", command: "npx", args: ["-y", "server-fs", "/tmp"] },
        remote: { type: "http", url: "https://mcp.example/mcp" },
      },
    });
    // MCP alone still writes a (credential-free) settings.json.
    expect(seededSettings(leaf)).toEqual({});
    for (const file of ["settings.json", ".claude.json"]) {
      expect(statSync(join(leaf, file)).mode & 0o777).toBe(0o600);
      expect(readFileSync(join(leaf, file), "utf8")).not.toContain(SECRET);
    }
    expect(statSync(leaf).mode & 0o777).toBe(0o700);
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ["--token=x", ["--token=abc"]],
    ["bare --api-key flag", ["--api-key", "abc"]],
    ["--client-secret", ["--client-secret=abc"]],
    ["-password", ["-password=abc"]],
    ["Bearer header", ["--header", "Bearer abc"]],
    ["Authorization header", ["Authorization: abc"]],
    ["url arg with userinfo", ["--endpoint", "https://u:p@host.example/x"]],
    ["url arg with token query", ["connect=wss://host.example/ws?access_token=abc"]],
  ])("drops a server whose args carry %s", (_label, args) => {
    expect(sanitizeMcpServers({ bad: { command: "x", args }, ok: { command: "y" } })).toEqual({
      ok: { command: "y" },
    });
  });

  it.each([
    ["userinfo", "https://user:pass@mcp.example/mcp"],
    ["username only", "https://user@mcp.example/mcp"],
    ["api_key query", "https://mcp.example/mcp?api_key=abc"],
    ["token query", "https://mcp.example/mcp?token=abc"],
    ["unparseable", "not a url"],
  ])("drops a server whose url carries %s", (_label, url) => {
    expect(sanitizeMcpServers({ bad: { type: "http", url } })).toBeNull();
  });

  it("keeps harmless url args and query params", () => {
    expect(
      sanitizeMcpServers({
        a: { command: "x", args: ["--base", "https://host.example/api?region=us", "--port=3000"] },
        b: { url: "https://mcp.example/mcp?region=eu" },
      }),
    ).toEqual({
      a: { command: "x", args: ["--base", "https://host.example/api?region=us", "--port=3000"] },
      b: { url: "https://mcp.example/mcp?region=eu" },
    });
  });

  it.each([
    ["non-object mcpServers", "x"],
    ["array mcpServers", [{ command: "x" }]],
    ["null mcpServers", null],
  ])("seeds no MCP for %s", (_label, mcpServers) => {
    expect(sanitizeMcpServers(mcpServers)).toBeNull();
  });

  it("skips malformed entries silently and bounds counts and sizes", () => {
    const long = "x".repeat(5000);
    const many = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`s${i}`, { command: "c" }]));
    expect(Object.keys(sanitizeMcpServers(many)!)).toHaveLength(64);
    expect(
      sanitizeMcpServers({
        arr: [],
        str: "x",
        nul: null,
        noLaunch: { type: "stdio" },
        badType: { type: 5, command: "c" },
        emptyCommand: { command: "" },
        badArgs: { command: "c", args: "x" },
        nonStringArg: { command: "c", args: [1] },
        longArg: { command: "c", args: [long] },
        tooManyArgs: { command: "c", args: Array.from({ length: 200 }, () => "a") },
        longCommand: { command: long },
        badUrl: { url: 5 },
        [long.slice(0, 200)]: { command: "c" },
        "": { command: "c" },
        __proto__: { command: "c" },
        good: { command: "c", args: [] },
      }),
    ).toEqual({ good: { command: "c", args: [] } });
  });

  it("does not let a __proto__ server name pollute the prototype", () => {
    const parsed = JSON.parse('{"__proto__":{"command":"c"}}');
    const result = sanitizeMcpServers(parsed)!;
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
  });

  it("never throws out of seeding on hostile global config", () => {
    writeFileSync(join(sourceDir, ".claude.json"), "{not json");
    writeFileSync(join(sourceDir, "settings.json"), JSON.stringify({ apiKeyHelper: "h" }));
    const leaf = createAutomatedConfigDir(dataDir, "t", { sourceConfigDir: sourceDir, env: env() });
    expect(seededGlobal(leaf)).toEqual({ hasCompletedOnboarding: true });
    writeGlobal({ mcpServers: { a: { command: "c", args: [{}] } } });
    expect(seedAutomatedConfigDir(leaf, { sourceConfigDir: sourceDir, env: env() })).toBe("seeded");
    expect(seededGlobal(leaf)).toEqual({ hasCompletedOnboarding: true });
  });

  it("ignores an oversized global config", () => {
    writeGlobal({ mcpServers: { a: { command: "c" } }, pad: "x".repeat(16 * 1024 * 1024) });
    const leaf = createAutomatedConfigDir(dataDir, "t", { sourceConfigDir: sourceDir, env: env() });
    expect(existsSync(join(leaf, ".claude.json"))).toBe(false);
  });

  it("reads the global config from ~/.claude.json when no config dir is set", () => {
    // Without CLAUDE_CONFIG_DIR or an explicit source dir the real file lives in
    // HOME; resolution is asserted without reading it.
    expect(automatedSourceGlobalConfig("/s", {}, false)).toBe(join(homedir(), ".claude.json"));
    expect(automatedSourceGlobalConfig("/s", { CLAUDE_CONFIG_DIR: "/s" }, false)).toBe(join("/s", ".claude.json"));
    expect(automatedSourceGlobalConfig("/s", {}, true)).toBe(join("/s", ".claude.json"));
  });

  it.each([
    [true, { skipDangerousModePermissionPrompt: true }],
    [false, null],
    ["true", null],
    [1, null],
    [null, null],
  ])("carries skipDangerousModePermissionPrompt only when literally true (%j)", (value, expected) => {
    expect(buildSeedSettings({ skipDangerousModePermissionPrompt: value })).toEqual(expected);
  });

  it("writes settings.json and .claude.json when only the skip flag is carried", () => {
    writeFileSync(
      join(sourceDir, "settings.json"),
      JSON.stringify({ skipDangerousModePermissionPrompt: true, hooks: {} }),
    );
    const leaf = createAutomatedConfigDir(dataDir, "t", { sourceConfigDir: sourceDir, env: env() });
    expect(seededSettings(leaf)).toEqual({ skipDangerousModePermissionPrompt: true });
    expect(seededGlobal(leaf)).toEqual({ hasCompletedOnboarding: true });
  });

  it("MCP and the skip flag never make an OAuth-only home authenticate", () => {
    writeFileSync(join(sourceDir, "settings.json"), JSON.stringify({ skipDangerousModePermissionPrompt: true }));
    writeGlobal({ oauthAccount: { emailAddress: "a@b.c" }, mcpServers: { a: { command: "c" } } });
    expect(() =>
      createAutomatedConfigDir(dataDir, "oauth", {
        sourceConfigDir: sourceDir,
        env: { CLAUDE_CONFIG_DIR: sourceDir },
      }),
    ).toThrow(/authentication-unavailable/);
    expect(existsSync(join(automatedConfigParent(dataDir), "oauth"))).toBe(false);
  });
});

describe("automated config dir projects link", () => {
  it("links transcripts to the real projects dir and removal never follows the link", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "zcc-cfglink-data-"));
    const sourceDir = mkdtempSync(join(tmpdir(), "zcc-cfglink-src-"));
    try {
      mkdirSync(join(sourceDir, "projects"), { recursive: true });
      writeFileSync(join(sourceDir, "projects", "keep.jsonl"), "x");
      const leaf = createAutomatedConfigDir(dataDir, "thread-1", {
        sourceConfigDir: sourceDir,
        env: { ANTHROPIC_API_KEY: "test-key" },
      })!;
      expect(lstatSync(join(leaf, "projects")).isSymbolicLink()).toBe(true);
      removeAutomatedConfigDir(dataDir, leaf);
      expect(existsSync(leaf)).toBe(false);
      expect(existsSync(join(sourceDir, "projects", "keep.jsonl"))).toBe(true);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it("does not conjure a Claude home that does not exist", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "zcc-cfglink-data-"));
    const missing = join(dataDir, "no-claude-home");
    try {
      expect(() => createAutomatedConfigDir(dataDir, "thread-1", { sourceConfigDir: missing, env: {} }))
        .toThrow(/authentication-unavailable/);
      expect(existsSync(missing)).toBe(false);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
