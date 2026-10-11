import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@zana-ai/zcc-plugin-sdk/testing";
import { GITHUB_REMOTE_ENV_NAMES, GhRunError } from "../credentials.mjs";
import plugin from "../server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "gho_FakeTokenForTestsOnly0123456789abcdef";
const IDENTITY = { login: "octocat", id: 583231, email: null };

type Entry = { name: string; value: string; group?: string; requires?: string[] };

function signedIn() {
  return vi.fn(async (args: string[]) => (args[0] === "auth" ? `${TOKEN}\n` : JSON.stringify(IDENTITY)));
}

async function activate(runGh: (args: string[]) => Promise<string>, overrides: { log?: Record<string, unknown> } = {}) {
  const fake = createFakePluginHost({ pluginId: "github" });
  const logs: string[] = [];
  const log = {
    debug: (m: string) => logs.push(m),
    info: (m: string) => logs.push(m),
    warn: (m: string) => logs.push(m),
    error: (m: string) => logs.push(m),
    ...overrides.log
  };
  await plugin({ ...fake.zcc, log } as never, { ghJson: async () => { throw new Error("gh offline"); }, runGh });
  const resolve = () => fake.harness.remoteEnvironment.resolve() as Promise<Entry[]>;
  const settle = () => new Promise((done) => setImmediate(done));
  return { fake, logs, resolve, settle };
}

describe("github remote credentials", () => {
  it("declares exactly the variables it may set, and the setting that controls them", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pkg.zcc.extra.remoteEnvironment).toEqual([...GITHUB_REMOTE_ENV_NAMES]);
  });

  it("registers a provider and a default-on toggle without asking gh anything yet", async () => {
    const runGh = signedIn();
    const { fake } = await activate(runGh);
    expect(fake.harness.remoteEnvironment.provider).toBeTypeOf("function");
    expect(fake.harness.settings.machineGitCredentialsEnabled).toMatchObject({ type: "boolean", default: true });
    expect(fake.harness.settings.machineGitCredentialsEnabled?.label).toMatch(/GitHub/);
    expect(fake.harness.settings.machineGitCommitIdentity).toMatchObject({ type: "boolean", default: false });
    expect(fake.harness.settings.machineGitSshRemotes).toMatchObject({ type: "boolean", default: false });
    expect(runGh).not.toHaveBeenCalled();
  });

  it("answers at once with nothing on first use, then forwards after the background lookup", async () => {
    const runGh = signedIn();
    const { fake, resolve, settle } = await activate(runGh);
    expect(await resolve()).toEqual([]);
    await settle();
    await settle();
    expect(fake.harness.remoteEnvironment.refreshCount).toBe(1);
    const entries = await resolve();
    expect(entries.find((entry) => entry.name === "GH_TOKEN")?.value).toBe(TOKEN);
    expect(entries.some((entry) => entry.name.startsWith("GIT_AUTHOR_"))).toBe(false);
    expect(entries.some((entry) => entry.value.includes("insteadOf") || entry.name === "GIT_CONFIG_KEY_2")).toBe(false);
    expect(runGh).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the forwarded set when the commit identity or the ssh rewrite is turned on", async () => {
    const runGh = signedIn();
    const { fake, resolve, settle } = await activate(runGh);
    await resolve();
    await settle();
    await settle();
    const before = fake.harness.remoteEnvironment.refreshCount;
    fake.harness.setSettings({ machineGitCommitIdentity: true, machineGitSshRemotes: true });
    // The previous value keeps being served until the rebuilt one is ready.
    expect((await resolve()).some((entry) => entry.name === "GH_TOKEN")).toBe(true);
    await settle();
    await settle();
    const entries = await resolve();
    expect(entries.find((entry) => entry.name === "GIT_AUTHOR_EMAIL")?.value).toBe("583231+octocat@users.noreply.github.com");
    expect(entries.find((entry) => entry.name === "GIT_CONFIG_COUNT")?.value).toBe("4");
    expect(runGh.mock.calls.map(([args]) => args[0])).toEqual(["auth", "auth", "api"]);
    expect(fake.harness.remoteEnvironment.refreshCount).toBeGreaterThanOrEqual(before + 2);
  });

  it("asks the host to re-resolve when the login disappears", async () => {
    let signedInNow = true;
    const runGh = vi.fn(async (args: string[]) => {
      if (!signedInNow) throw new GhRunError("exit");
      return args[0] === "auth" ? TOKEN : JSON.stringify(IDENTITY);
    });
    const clock = vi.spyOn(Date, "now");
    clock.mockReturnValue(1_000_000);
    try {
      const { fake, resolve, settle } = await activate(runGh);
      await resolve();
      await settle();
      await settle();
      expect(fake.harness.remoteEnvironment.refreshCount).toBe(1);
      signedInNow = false;
      clock.mockReturnValue(1_000_000 + 61_000);
      expect((await resolve()).length).toBeGreaterThan(0); // stale value served while it revalidates
      await settle();
      await settle();
      expect(fake.harness.remoteEnvironment.refreshCount).toBe(2);
      expect(await resolve()).toEqual([]);
    } finally {
      clock.mockRestore();
    }
  });

  it("forwards nothing and never runs gh while the toggle is off", async () => {
    const runGh = signedIn();
    const { fake, resolve, settle } = await activate(runGh);
    fake.harness.setSettings({ machineGitCredentialsEnabled: false });
    expect(await resolve()).toEqual([]);
    await settle();
    expect(runGh).not.toHaveBeenCalled();
    expect(await resolve()).toEqual([]);
    expect(fake.harness.remoteEnvironment.refreshCount).toBe(1);
  });

  it("drops a cached token when the toggle is turned off and asks the host to withdraw it", async () => {
    const runGh = signedIn();
    const { fake, resolve, settle } = await activate(runGh);
    await resolve();
    await settle();
    await settle();
    expect((await resolve()).some((entry) => entry.name === "GH_TOKEN")).toBe(true);
    const before = fake.harness.remoteEnvironment.refreshCount;
    fake.harness.setSettings({ machineGitCredentialsEnabled: false });
    expect(fake.harness.remoteEnvironment.refreshCount).toBe(before + 1);
    expect(await resolve()).toEqual([]);
    fake.harness.setSettings({ machineGitCredentialsEnabled: true });
    expect(await resolve()).toEqual([]);
    await settle();
    await settle();
    expect((await resolve()).some((entry) => entry.name === "GH_TOKEN")).toBe(true);
  });

  it("degrades quietly when gh is missing and logs the reason once, without values", async () => {
    const runGh = vi.fn(async () => { throw new GhRunError("spawn"); });
    const { fake, logs, resolve, settle } = await activate(runGh);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await resolve()).toEqual([]);
      await settle();
    }
    expect(fake.harness.remoteEnvironment.refreshCount).toBe(0);
    const failureLogs = logs.filter((line) => /gh credentials/i.test(line));
    expect(failureLogs).toHaveLength(1);
    expect(failureLogs[0]).toContain("spawn");
  });

  it("never writes the token to settings, storage, rpc results or logs", async () => {
    const runGh = signedIn();
    const { fake, logs, resolve, settle } = await activate(runGh);
    await resolve();
    await settle();
    await settle();
    await resolve();
    expect(JSON.stringify([...fake.harness.kv.entries()])).not.toContain(TOKEN);
    expect(JSON.stringify(fake.harness.settings)).not.toContain(TOKEN);
    expect(JSON.stringify(await fake.harness.callRpc("status"))).not.toContain(TOKEN);
    expect(logs.join("\n")).not.toContain(TOKEN);
    expect(fake.harness.published).toEqual([]);
  });

  it("stops contributing when the plugin is disposed", async () => {
    const { fake } = await activate(signedIn());
    await fake.harness.dispose();
    expect(fake.harness.remoteEnvironment.provider).toBeNull();
  });

  it("keeps the rest of the plugin working when the host offers no remote environment", async () => {
    const fake = createFakePluginHost({ pluginId: "github" });
    const refused = {
      ...fake.zcc,
      remoteEnvironment: {
        provide() { throw new Error("remoteEnvironment is not available in this runtime"); },
        refresh() { throw new Error("not available"); }
      }
    };
    expect(() => plugin(refused as never, { runGh: signedIn() })).not.toThrow();
    expect(fake.harness.mentionProviders.map((row) => row.id)).toEqual(["issue", "pr"]);
    expect(() => fake.harness.setSettings({ machineGitCredentialsEnabled: false })).not.toThrow();
  });
});
