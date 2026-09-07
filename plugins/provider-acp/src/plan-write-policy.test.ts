import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { isPlanAcpMode, isPlanArtifactWritePath } from "./plan-write-policy.js";

describe("plan write policy", () => {
  it("treats plan as the only gated ACP mode", () => {
    expect(isPlanAcpMode("plan")).toBe(true);
    expect(isPlanAcpMode("Plan")).toBe(true);
    expect(isPlanAcpMode("agent")).toBe(false);
    expect(isPlanAcpMode(undefined)).toBe(false);
  });

  it("allows markdown under .zcc/plans and denies escapes", () => {
    const cwd = "/tmp/workspace";
    expect(isPlanArtifactWritePath(cwd, join(cwd, ".zcc", "plans", "ship.plan.md"))).toBe(true);
    expect(isPlanArtifactWritePath(cwd, join(cwd, ".zcc", "plans", "legacy.md"))).toBe(true);
    expect(isPlanArtifactWritePath(cwd, join(cwd, "src", "foo.ts"))).toBe(false);
    expect(isPlanArtifactWritePath(cwd, join(cwd, ".zcc", "plans", "..", "secret.ts"))).toBe(false);
    expect(isPlanArtifactWritePath(cwd, join(cwd, ".zcc", "plans", "notes.txt"))).toBe(false);
  });
});
