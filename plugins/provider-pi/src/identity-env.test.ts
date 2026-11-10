import { describe, expect, it } from "vitest";
import { pickPiIdentityEnv } from "./identity-env.js";

describe("pickPiIdentityEnv", () => {
  it("keeps project and environment identity only", () => {
    expect(
      pickPiIdentityEnv({ ZCC_PROJECT_ID: "p", ZCC_ENVIRONMENT_ID: "e", ZCC_THREAD_ID: "t", X: "1" }),
    ).toEqual({ ZCC_PROJECT_ID: "p", ZCC_ENVIRONMENT_ID: "e" });
  });
  it("skips empty values and a missing environment", () => {
    expect(pickPiIdentityEnv({ ZCC_PROJECT_ID: "" })).toEqual({});
    expect(pickPiIdentityEnv(undefined)).toEqual({});
  });
});
