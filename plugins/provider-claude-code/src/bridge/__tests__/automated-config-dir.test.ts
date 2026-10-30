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
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  automatedConfigParent,
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
