import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GITHUB_REMOTE_ENV_NAMES,
  GhRunError,
  buildGithubRemoteEnvironment,
  createCredentialSource,
  createGhRunner,
  loadGithubCredentials,
  parseGithubIdentity,
  parseGithubToken
} from "../credentials.mjs";

// Never the real `gh`: these tests drive either a stub or `node` as the child.
const TOKEN = "gho_FakeTokenForTestsOnly0123456789abcdef";
const IDENTITY = { login: "octocat", id: 583231, email: "octo@example.com" };

const node = (script: string) => ["-e", script];

describe("parseGithubToken", () => {
  it("trims the CLI output and accepts a single opaque token", () => {
    expect(parseGithubToken(`${TOKEN}\n`)).toBe(TOKEN);
    expect(parseGithubToken(`  ${TOKEN}  `)).toBe(TOKEN);
  });

  it.each([
    ["empty", ""],
    ["whitespace only", " \n\t"],
    ["inner whitespace", "gho abc"],
    ["multiple lines", "a\nb"],
    ["NUL byte", "abc\u0000def"],
    ["over-long", "x".repeat(4097)],
    ["not a string", 42],
    ["undefined", undefined]
  ])("rejects %s", (_label, input) => {
    expect(parseGithubToken(input as never)).toBeNull();
  });
});

describe("parseGithubIdentity", () => {
  it("accepts the user payload and ignores extra fields", () => {
    expect(parseGithubIdentity(JSON.stringify({ ...IDENTITY, name: "The Octocat", bio: "x" }))).toEqual(IDENTITY);
  });

  it("keeps a private email as null", () => {
    expect(parseGithubIdentity(JSON.stringify({ ...IDENTITY, email: null }))).toEqual({ ...IDENTITY, email: null });
    expect(parseGithubIdentity(JSON.stringify({ login: "octocat", id: 1 }))).toEqual({ login: "octocat", id: 1, email: null });
  });

  it.each([
    ["not json", "{nope"],
    ["not an object", "[]"],
    ["login with a space", JSON.stringify({ ...IDENTITY, login: "bad login" })],
    ["login with a slash", JSON.stringify({ ...IDENTITY, login: "a/b" })],
    ["login with a newline", JSON.stringify({ ...IDENTITY, login: "a\nb" })],
    ["empty login", JSON.stringify({ ...IDENTITY, login: "" })],
    ["zero id", JSON.stringify({ ...IDENTITY, id: 0 })],
    ["fractional id", JSON.stringify({ ...IDENTITY, id: 1.5 })],
    ["string id", JSON.stringify({ ...IDENTITY, id: "7" })],
    ["invalid email", JSON.stringify({ ...IDENTITY, email: "not an email" })],
    ["email with a newline", JSON.stringify({ ...IDENTITY, email: "a@b.co\nBcc: x@y.z" })],
    ["numeric email", JSON.stringify({ ...IDENTITY, email: 5 })]
  ])("rejects %s", (_label, input) => {
    expect(parseGithubIdentity(input)).toBeNull();
  });
});

describe("buildGithubRemoteEnvironment", () => {
  const byName = (entries: ReturnType<typeof buildGithubRemoteEnvironment>) => new Map(entries.map((entry) => [entry.name, entry]));
  const configOf = (entries: ReturnType<typeof byName>) => {
    const count = Number(entries.get("GIT_CONFIG_COUNT")?.value);
    return Array.from({ length: count }, (_, index) => [entries.get(`GIT_CONFIG_KEY_${index}`)?.value, entries.get(`GIT_CONFIG_VALUE_${index}`)?.value]);
  };

  it("by default forwards the token and a github.com-only credential helper, nothing else", () => {
    const entries = byName(buildGithubRemoteEnvironment({ token: TOKEN, identity: IDENTITY }));
    expect(entries.get("GH_TOKEN")?.value).toBe(TOKEN);
    expect([...entries.keys()].filter((name) => /^GIT_(AUTHOR|COMMITTER)_/.test(name))).toEqual([]);
    const config = configOf(entries);
    // Scoped to the URL: the machine's own helpers for other hosts are neither reset nor bypassed.
    expect(config.map(([key]) => key)).toEqual(["credential.https://github.com.helper", "credential.https://github.com.helper"]);
    expect(config[0]?.[1]).toBe("");
    expect(config.some(([key]) => key?.startsWith("url.") || key === "credential.helper")).toBe(false);
  });

  it("adds the commit identity only when asked", () => {
    const entries = byName(buildGithubRemoteEnvironment({ token: TOKEN, identity: IDENTITY }, { commitIdentity: true }));
    expect(entries.get("GIT_AUTHOR_NAME")?.value).toBe("octocat");
    expect(entries.get("GIT_COMMITTER_NAME")?.value).toBe("octocat");
    expect(entries.get("GIT_AUTHOR_EMAIL")?.value).toBe("octo@example.com");
    expect(entries.get("GIT_COMMITTER_EMAIL")?.value).toBe("octo@example.com");
    expect(byName(buildGithubRemoteEnvironment({ token: TOKEN, identity: null }, { commitIdentity: true })).has("GIT_AUTHOR_NAME")).toBe(false);
  });

  it("adds the ssh-to-https remote rewrite only when asked", () => {
    const config = configOf(byName(buildGithubRemoteEnvironment({ token: TOKEN, identity: null }, { sshRemotes: true })));
    expect(config).toHaveLength(4);
    expect(config[2]).toEqual(["url.https://github.com/.insteadOf", "git@github.com:"]);
    expect(config[3]).toEqual(["url.https://github.com/.insteadOf", "ssh://git@github.com/"]);
  });

  it("falls back to the GitHub noreply address when the profile email is private", () => {
    const entries = byName(buildGithubRemoteEnvironment({ token: TOKEN, identity: { ...IDENTITY, email: null } }, { commitIdentity: true }));
    expect(entries.get("GIT_AUTHOR_EMAIL")?.value).toBe("583231+octocat@users.noreply.github.com");
    expect(entries.get("GIT_COMMITTER_EMAIL")?.value).toBe("583231+octocat@users.noreply.github.com");
  });

  it("makes the credential helper read GH_TOKEN at run time and never embed the token", () => {
    const entries = buildGithubRemoteEnvironment({ token: TOKEN, identity: IDENTITY }, { commitIdentity: true, sshRemotes: true });
    const helper = entries.find((entry) => entry.name === "GIT_CONFIG_VALUE_1")?.value ?? "";
    expect(helper).toContain("$GH_TOKEN");
    expect(helper).toContain("github.com");
    const holders = entries.filter((entry) => entry.value.includes(TOKEN));
    expect(holders.map((entry) => entry.name)).toEqual(["GH_TOKEN"]);
  });

  it.each([
    ["defaults", {}, 2],
    ["with the ssh rewrite", { sshRemotes: true }, 4]
  ])("applies the git configuration as one unit and only when a token is present on the machine (%s)", (_label, options, count) => {
    const entries = buildGithubRemoteEnvironment({ token: TOKEN, identity: IDENTITY }, options);
    const config = entries.filter((entry) => entry.name.startsWith("GIT_CONFIG_"));
    expect(config).toHaveLength(1 + count * 2);
    expect(new Set(config.map((entry) => entry.group)).size).toBe(1);
    expect(config.every((entry) => entry.group && entry.requires?.includes("GH_TOKEN"))).toBe(true);
    expect(entries.find((entry) => entry.name === "GH_TOKEN")?.group).toBeUndefined();
    expect(entries.find((entry) => entry.name === "GH_TOKEN")?.requires).toBeUndefined();
  });

  it("only uses names the manifest declares", () => {
    const patterns = [...GITHUB_REMOTE_ENV_NAMES];
    const allowed = (name: string) => patterns.some((pattern) => pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : pattern === name);
    for (const entry of buildGithubRemoteEnvironment({ token: TOKEN, identity: IDENTITY }, { commitIdentity: true, sshRemotes: true })) {
      expect(allowed(entry.name), entry.name).toBe(true);
    }
  });
});

describe("loadGithubCredentials", () => {
  it("asks gh only for the token of the github.com account by default", async () => {
    const run = vi.fn(async (args: string[]) => args[0] === "auth" ? `${TOKEN}\n` : JSON.stringify(IDENTITY));
    const entries = await loadGithubCredentials(run);
    expect(run.mock.calls.map(([args]) => args)).toEqual([["auth", "token", "--hostname", "github.com"]]);
    expect(entries.find((entry) => entry.name === "GH_TOKEN")?.value).toBe(TOKEN);
  });

  it("also asks for the profile when the commit identity is wanted", async () => {
    const run = vi.fn(async (args: string[]) => args[0] === "auth" ? `${TOKEN}\n` : JSON.stringify(IDENTITY));
    const entries = await loadGithubCredentials(run, undefined, { commitIdentity: true });
    expect(run.mock.calls.map(([args]) => args)).toEqual([
      ["auth", "token", "--hostname", "github.com"],
      ["api", "--hostname", "github.com", "user"]
    ]);
    expect(entries.find((entry) => entry.name === "GIT_AUTHOR_NAME")?.value).toBe("octocat");
  });

  it("forwards nothing when gh is signed out, missing or malformed", async () => {
    const reasons: string[] = [];
    const failures: Array<[string, (args: string[]) => Promise<string>]> = [
      ["not signed in", async () => { throw new GhRunError("exit"); }],
      ["missing binary", async () => { throw new GhRunError("spawn"); }],
      ["timeout", async () => { throw new GhRunError("timeout"); }],
      ["blank token", async () => " \n"],
      ["garbled profile", async (args) => args[0] === "auth" ? TOKEN : "<html>"],
      ["unexpected throw", async () => { throw new TypeError(`leaks ${TOKEN}`); }]
    ];
    for (const [, run] of failures) {
      expect(await loadGithubCredentials(run, (reason) => reasons.push(reason), { commitIdentity: true })).toEqual([]);
    }
    expect(reasons).toEqual(["exit", "spawn", "timeout", "invalid-token", "invalid-profile", "error"]);
    expect(reasons.join(" ")).not.toContain(TOKEN);
  });

  it("never returns the token alone when the profile lookup fails", async () => {
    const run = async (args: string[]) => {
      if (args[0] === "auth") return TOKEN;
      throw new GhRunError("exit");
    };
    expect(await loadGithubCredentials(run, undefined, { commitIdentity: true })).toEqual([]);
  });
});

describe("createCredentialSource (stale while revalidate)", () => {
  let clock = 0;
  const now = () => clock;
  beforeEach(() => { clock = 1_000_000; });

  function deferredLoader() {
    const waiting: Array<(entries: unknown[]) => void> = [];
    const load = vi.fn(() => new Promise<unknown[]>((resolve) => { waiting.push(resolve); }));
    return { load, settle: (entries: unknown[]) => waiting.shift()?.(entries) };
  }
  const withToken = (value: string) => [{ name: "GH_TOKEN", value }];
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it("answers immediately with nothing on a cold cache, loads in the background and announces the result", async () => {
    const { load, settle } = deferredLoader();
    const onChange = vi.fn();
    const source = createCredentialSource({ load: load as never, now, onChange });
    expect(source.current()).toEqual([]);
    expect(source.current()).toEqual([]);
    expect(load).toHaveBeenCalledTimes(1);
    settle(withToken("a"));
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(source.current()).toEqual(withToken("a"));
  });

  it("serves a fresh value for 60 seconds without loading again", async () => {
    const load = vi.fn(async () => withToken("a"));
    const source = createCredentialSource({ load: load as never, now });
    source.current();
    await flush();
    clock += 59_999;
    expect(source.current()).toEqual(withToken("a"));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("serves the stale value while it revalidates once, then switches to the new value", async () => {
    const { load, settle } = deferredLoader();
    const onChange = vi.fn();
    const source = createCredentialSource({ load: load as never, now, onChange });
    source.current();
    settle(withToken("a"));
    await flush();
    clock += 60_001;
    expect(source.current()).toEqual(withToken("a"));
    expect(source.current()).toEqual(withToken("a"));
    expect(load).toHaveBeenCalledTimes(2);
    settle(withToken("b"));
    await flush();
    expect(source.current()).toEqual(withToken("b"));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("does not announce an unchanged result", async () => {
    const load = vi.fn(async () => withToken("a"));
    const onChange = vi.fn();
    const source = createCredentialSource({ load: load as never, now, onChange });
    source.current();
    await flush();
    clock += 60_001;
    source.current();
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("degrades to no forwarding when a revalidation fails, retries after 5 seconds and recovers", async () => {
    const results: unknown[][] = [withToken("a"), [], withToken("c")];
    const load = vi.fn(async () => results.shift() ?? []);
    const onChange = vi.fn();
    const source = createCredentialSource({ load: load as never, now, onChange });
    source.current();
    await flush();
    clock += 60_001;
    expect(source.current()).toEqual(withToken("a"));
    await flush();
    expect(source.current()).toEqual([]);
    clock += 4_999;
    source.current();
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    clock += 2;
    expect(source.current()).toEqual([]);
    await flush();
    expect(source.current()).toEqual(withToken("c"));
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("shares one in-flight load and honours an explicit refresh", async () => {
    const { load, settle } = deferredLoader();
    const source = createCredentialSource({ load: load as never, now });
    const first = source.refresh();
    const second = source.refresh();
    expect(load).toHaveBeenCalledTimes(1);
    settle(withToken("a"));
    await Promise.all([first, second]);
    const forced = source.refresh();
    expect(load).toHaveBeenCalledTimes(2);
    settle(withToken("b"));
    await forced;
    expect(source.current()).toEqual(withToken("b"));
  });

  it("forgets the value on clear and ignores a load that was already running", async () => {
    const { load, settle } = deferredLoader();
    const onChange = vi.fn();
    const source = createCredentialSource({ load: load as never, now, onChange });
    source.current();
    source.clear();
    settle(withToken("late"));
    await flush();
    expect(source.current()).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
    settle(withToken("fresh"));
    await flush();
    expect(source.current()).toEqual(withToken("fresh"));
  });

  it("reloads on demand while still serving the current value, ignoring the load it superseded", async () => {
    const { load, settle } = deferredLoader();
    const onChange = vi.fn();
    const source = createCredentialSource({ load: load as never, now, onChange });
    source.current();
    settle(withToken("a"));
    await flush();
    const stale = source.refresh();
    const reloaded = source.reload();
    expect(load).toHaveBeenCalledTimes(3);
    expect(source.current()).toEqual(withToken("a"));
    settle(withToken("superseded"));
    await stale;
    expect(source.current()).toEqual(withToken("a"));
    settle(withToken("b"));
    await reloaded;
    expect(source.current()).toEqual(withToken("b"));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("hands out copies so a caller cannot change the cached value", async () => {
    const source = createCredentialSource({ load: (async () => withToken("a")) as never, now });
    source.current();
    await flush();
    const copy = source.current() as Array<{ value: string }>;
    copy[0]!.value = "mutated";
    copy.push({ value: "extra" });
    expect(source.current()).toEqual(withToken("a"));
  });

  it("is inert after dispose and tolerates a throwing onChange", async () => {
    const load = vi.fn(async () => withToken("a"));
    const source = createCredentialSource({ load: load as never, now, onChange: () => { throw new Error("boom"); } });
    source.current();
    await flush();
    expect(source.current()).toEqual(withToken("a"));
    source.dispose();
    expect(source.current()).toEqual([]);
    load.mockClear();
    source.current();
    await source.refresh();
    expect(load).not.toHaveBeenCalled();
  });
});

describe("createGhRunner (bounded temp-file capture)", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "zcc-gh-runner-test-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  const runner = (options: Record<string, unknown> = {}) => createGhRunner({ command: process.execPath, tmpRoot: root, ...options });

  it("returns what the child wrote and removes every temporary file", async () => {
    const out = await runner()(node("process.stdout.write('token-value')"));
    expect(out).toBe("token-value");
    expect(readdirSync(root)).toEqual([]);
  });

  it("returns output larger than a pipe's first 8192 bytes in full", async () => {
    const out = await runner()(node("process.stdout.write('x'.repeat(200000))"));
    expect(out).toHaveLength(200000);
  });

  it("rejects output over the cap and cleans up", async () => {
    const run = runner({ outputLimit: 1024 });
    await expect(run(node("process.stdout.write('x'.repeat(50000))"))).rejects.toMatchObject({ name: "GhRunError", reason: "output-limit" });
    expect(readdirSync(root)).toEqual([]);
  });

  it("stops a runaway child before it finishes writing", async () => {
    const run = runner({ outputLimit: 2048, timeoutMs: 5000 });
    const started = Date.now();
    await expect(run(node("const b='x'.repeat(65536); setInterval(()=>process.stdout.write(b),1)"))).rejects.toMatchObject({ reason: "output-limit" });
    expect(Date.now() - started).toBeLessThan(4000);
    expect(readdirSync(root)).toEqual([]);
  });

  it("kills a child that outlives the timeout", async () => {
    const run = runner({ timeoutMs: 200 });
    const started = Date.now();
    await expect(run(node("setInterval(()=>{},1000)"))).rejects.toMatchObject({ reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(readdirSync(root)).toEqual([]);
  });

  it("reports a failing exit without echoing anything the child printed", async () => {
    const run = runner();
    const error = await run(node(`process.stdout.write('${TOKEN}'); process.stderr.write('${TOKEN}'); process.exit(3)`)).catch((e) => e);
    expect(error).toBeInstanceOf(GhRunError);
    expect(error.reason).toBe("exit");
    expect(String(error.message)).not.toContain(TOKEN);
    expect(readdirSync(root)).toEqual([]);
  });

  it("reports a missing executable", async () => {
    const run = createGhRunner({ command: join(root, "no-such-gh"), tmpRoot: root });
    await expect(run(["auth", "token"])).rejects.toMatchObject({ reason: "spawn" });
    expect(readdirSync(root)).toEqual([]);
  });

  it("runs one command at a time and bounds the queue", async () => {
    const run = runner({ maxQueued: 1 });
    const script = node("const s=Date.now(); setTimeout(()=>process.stdout.write(s+','+Date.now()),150)");
    const first = run(script);
    const second = run(script);
    await expect(run(script)).rejects.toMatchObject({ reason: "busy" });
    const [a, b] = (await Promise.all([first, second])).map((text) => text.split(",").map(Number)) as [number[], number[]];
    expect(b[0]!).toBeGreaterThanOrEqual(a[1]!);
    expect(readdirSync(root)).toEqual([]);
  });

  it("keeps working after a failed run", async () => {
    const run = runner({ timeoutMs: 150 });
    await expect(run(node("setInterval(()=>{},1000)"))).rejects.toBeInstanceOf(GhRunError);
    await expect(run(node("process.stdout.write('ok')"))).resolves.toBe("ok");
  });

  it("captures stdout in a private directory and leaves no named file while the child runs", async () => {
    const run = runner({ timeoutMs: 400 });
    const pending = run(node("setInterval(()=>{},1000)")).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const dirs = readdirSync(root);
    expect(dirs).toHaveLength(1);
    const dir = join(root, dirs[0]!);
    if (process.platform !== "win32") {
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(readdirSync(dir)).toEqual([]);
    }
    await pending;
    expect(existsSync(dir)).toBe(false);
  });

  it("does not let the child prompt, page or colour its output", async () => {
    const out = await runner()(node("process.stdout.write([process.env.GH_PROMPT_DISABLED,process.env.GH_NO_UPDATE_NOTIFIER,process.env.NO_COLOR].join(','))"));
    expect(out).toBe("1,1,1");
  });

  it("cannot be tricked into a shell by an argument", async () => {
    const marker = join(root, "pwned");
    const out = await runner()(node(`process.stdout.write(process.argv[1])`).concat([`; touch ${marker}`]));
    expect(out).toBe(`; touch ${marker}`);
    expect(existsSync(marker)).toBe(false);
  });
});
