import { describe, expect, it } from "vitest";
import { formatAcpLaunchFailure } from "./agent-connection.js";

describe("formatAcpLaunchFailure", () => {
  it("maps spawn ENOENT to a missing-on-this-machine message", () => {
    const missing = Object.assign(new Error("spawn opencode ENOENT"), {
      code: "ENOENT",
    });
    expect(formatAcpLaunchFailure("opencode", missing)).toBe(
      'OpenCode is not installed on this machine (command "opencode" was not found). Install it on this host, or pick another agent.',
    );
    expect(formatAcpLaunchFailure("opencode", new Error("exited 64"))).toBe(
      'Failed to launch ACP agent "opencode": exited 64',
    );
  });
});
