import { describe, expect, it } from "vitest";
import { LINEAR_TIME_BUDGET_MS } from "../__tests__/linear-time.js";
import { normalizeProjectPathInput } from "./project-path.js";

describe("normalizeProjectPathInput", () => {
  it.each([
    ["  /Users/me/app/  ", "/Users/me/app"],
    ["/Users/me/app///", "/Users/me/app"],
    ["/", "/"],
    ["   ", ""],
    ["relative//", "relative"],
  ])("normalizes %j", (input, expected) => {
    expect(normalizeProjectPathInput(input)).toBe(expected);
  });

  it("stays linear on a long run of slashes", () => {
    const started = performance.now();
    const input = `/a${"/".repeat(200_000)}b`;
    expect(normalizeProjectPathInput(input)).toBe(input);
    expect(normalizeProjectPathInput(`/a${"/".repeat(200_000)}`)).toBe("/a");
    expect(performance.now() - started).toBeLessThan(LINEAR_TIME_BUDGET_MS);
  });
});
