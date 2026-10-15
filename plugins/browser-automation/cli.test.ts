import { describe, expect, it } from "vitest";
import { cliFailure, cliHelp, parseCli } from "./cli.js";
import { rpcContract } from "./contracts.js";

const id = "1a12a3f1-12de-4fbb-a011-df0905678757";
describe("CLI boundaries", () => {
  it("requires explicit backend, host, and headless selection", () => {
    expect(() =>
      parseCli(["open", "--backend", "local", "--machine", "host"], "thread"),
    ).toThrow("--headless");
    expect(
      parseCli(
        ["open", "--backend", "local", "--machine", "host", "--headless"],
        "thread",
      ).input.selection,
    ).toEqual({ backend: "local", hostId: "host" });
    expect(() => parseCli(["open", "--backend", "cloud"], "thread")).toThrow();
  });
  it("rejects cross-thread and ignored flags", () => {
    expect(() => parseCli(["list", "--thread", "other"], "thread")).toThrow(
      "another thread",
    );
    expect(() => parseCli(["list", "--headless"], "thread")).toThrow("Unknown");
    expect(() =>
      parseCli(["run", id, "--script", "1", "--script-file", "a.js"], "thread"),
    ).toThrow("exactly one");
    expect(() => parseCli(["list", "--json", "--json"], "thread")).toThrow(
      "duplicate",
    );
  });
  it("preserves script strings and validates timeout at the common boundary", () => {
    const parsed = parseCli(
      [
        "run",
        id,
        "--script",
        "await browser.getPage('main')",
        "--timeout-ms",
        "1",
      ],
      "thread",
    );
    expect(parsed.input.script).toBe("await browser.getPage('main')");
    expect(() => rpcContract.run.input.parse(parsed.input)).toThrow();
  });
});

describe("agent command discovery and recovery", () => {
  it.each([{ argv: [] }, { argv: ["--help"] }, { argv: ["-h", "--json"] }])("lists commands without a thread: $argv", ({ argv }) => {
    expect(cliHelp(argv)).toContain("zcc browser-automation open");
    expect(cliHelp(argv)).toContain("zcc browser-automation close");
    expect(cliHelp(argv)).toContain("500 KB");
  });
  it("shows relevant command usage and does not swallow execution arguments", () => {
    expect(cliHelp(["run", "--help"])).toContain("--script-host");
    expect(cliHelp(["run", "--help"])).toContain("--timeout");
    expect(cliHelp(["open", "-h"])).toContain("--desktop");
    expect(cliHelp(["open", "-h"])).not.toContain("500 KB");
    expect(cliHelp(["list"])).toBeUndefined();
    expect(() => cliHelp(["unknown", "--help"])).toThrow("Unknown command");
    expect(() => cliHelp(["run", id, "--help"])).toThrow("command name");
  });
  it.each([
    ["90s", 90_000], ["2m", 120_000], ["1500ms", 1500],
    ["1", 1000], ["120", 120_000], ["1000", 1000], ["120000", 120_000],
    ["1.5s", 1500],
  ])("normalizes timeout %s to %i milliseconds", (value, timeoutMs) => {
    const parsed = parseCli(["run", id, "--script", "1", "--timeout", value], "thread");
    expect(rpcContract.run.input.parse(parsed.input).timeoutMs).toBe(timeoutMs);
  });
  it.each(["0", "121", "999", "120001", "121s", "0.5s", "1.0001s", "bad", "1h", "-1", "Infinity"])("rejects invalid timeout %s", value => {
    expect(() => parseCli(["run", id, "--script", "1", "--timeout", value], "thread")).toThrow();
  });
  it("rejects contradictory timeouts and preserves millisecond/default behavior", () => {
    expect(() => parseCli(["run", id, "--script", "1", "--timeout", "1s", "--timeout-ms", "1000"], "thread")).toThrow("only one");
    expect(parseCli(["run", id, "--script", "1"], "thread").input.timeoutMs).toBe(30_000);
    expect(parseCli(["run", id, "--script", "1", "--timeout-ms", "2000"], "thread").input.timeoutMs).toBe(2000);
  });
  it("returns actionable JSON errors while preserving text failures", () => {
    for (const message of ["Browser session stopped or expired", "Session does not belong to this thread"]) {
      const failure = cliFailure(new Error(message), true);
      expect(failure).toMatchObject({ exitCode: 1, stderr: message });
      expect(JSON.parse(failure.stdout!)).toMatchObject({ ok: false, error: { code: "session_unavailable", hint: expect.stringContaining("new browser session") } });
    }
    expect(JSON.parse(cliFailure(new Error("Too many JPEG screenshots"), true).stdout!)).toMatchObject({ error: { code: "screenshot_limit" } });
    expect(JSON.parse(cliFailure(new Error("Unknown flag"), true).stdout!)).toEqual({ ok: false, error: { code: "command_failed", message: "Unknown flag" } });
    expect(cliFailure(null, false)).toEqual({ exitCode: 1, stderr: "Browser command failed" });
  });
  it("validates command scope and explicit script source hosts", () => {
    expect(() => parseCli(["list"])).toThrow("pass --thread");
    expect(() => parseCli(["list", "extra"], "thread")).toThrow("Unexpected");
    expect(() => parseCli(["pages"], "thread")).toThrow("one session ID");
    expect(() => parseCli(["run", id, "--script-file", "check.js"], "thread")).toThrow("--script-host");
    expect(() => parseCli(["run", id, "--script"], "thread")).toThrow("Missing value");
    expect(() => parseCli(["open", "--machine", "host", "--backend", "cloud"], "thread")).toThrow("--backend");
    expect(() => parseCli(["open", "--backend", "desktop", "--machine", "host"], "thread")).toThrow("--desktop");
    expect(() => parseCli(["open", "--backend", "desktop", "--machine", "host", "--desktop", "instance", "--headless"], "thread")).toThrow("--headless");
    expect(parseCli(["open", "--backend", "desktop", "--machine", "host", "--desktop", "instance", "--tab", "existing"], "thread").input.selection).toEqual({ backend: "desktop", hostId: "host", instanceId: "instance", tabId: "existing" });
    expect(parseCli(["preview", id, "--after", "2"], "thread").input.afterSequence).toBe(2);
    expect(parseCli(["preview", id], "thread").input.afterSequence).toBe(0);
    expect(parseCli(["screenshot", id, "--page", "other"], "thread").input.page).toBe("other");
    expect(parseCli(["screenshot", id], "thread").input.page).toBe("main");
  });
});
