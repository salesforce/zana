import { describe, expect, it } from "vitest";
import { LINEAR_TIME_BUDGET_MS } from "../linear-time-testing.js";
import { derivePluginId } from "./plugin-id.js";

describe("bb-thread derivePluginId", () => {
  it.each([
    ["bb-plugin-linear", "linear"],
    ["@scope/bb-plugin-linear", "linear"],
    ["--Weird__Name--", "weird--name"],
  ])("derives %j", (input, expected) => {
    expect(derivePluginId(input)).toBe(expected);
  });

  it("rejects names with nothing left after sanitizing", () => {
    expect(() => derivePluginId("---")).toThrow(/cannot derive a plugin id/);
  });

  it("stays linear on a long run of dashes", () => {
    const started = performance.now();
    expect(derivePluginId(`${"-".repeat(200_000)}x`)).toBe("x");
    expect(derivePluginId(`x${"-".repeat(200_000)}y`)).toBe(`x${"-".repeat(200_000)}y`);
    expect(performance.now() - started).toBeLessThan(LINEAR_TIME_BUDGET_MS);
  });
});
