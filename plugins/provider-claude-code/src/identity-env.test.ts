import { describe, expect, it } from "vitest";
import { pickIdentityEnv, resolveSessionIdentityEnv } from "./identity-env.js";

describe("pickIdentityEnv", () => {
  it("keeps only non-empty identity variables", () => {
    expect(
      pickIdentityEnv({ ZCC_PROJECT_ID: "p", ZCC_THREAD_ID: "", PATH: "/bin", ZCC_ENVIRONMENT_ID: "e" }),
    ).toEqual({ ZCC_PROJECT_ID: "p", ZCC_ENVIRONMENT_ID: "e" });
  });
  it("handles a missing environment", () => {
    expect(pickIdentityEnv(undefined)).toEqual({});
  });
});

describe("resolveSessionIdentityEnv", () => {
  it("lets the running session win over a per-turn override", () => {
    expect(
      resolveSessionIdentityEnv(
        { ZCC_THREAD_ID: "t1", ZCC_PROJECT_ID: "p1" },
        { ZCC_THREAD_ID: "t2", ZCC_PROJECT_ID: "p2", OTHER: "x" },
      ),
    ).toEqual({ ZCC_THREAD_ID: "t1", ZCC_PROJECT_ID: "p1" });
  });
  it("fills a key the session never had from the override", () => {
    expect(
      resolveSessionIdentityEnv({ ZCC_THREAD_ID: "t1" }, { ZCC_PROJECT_ID: "p2" }),
    ).toEqual({ ZCC_PROJECT_ID: "p2", ZCC_THREAD_ID: "t1" });
  });
});
