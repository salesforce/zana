import { describe, expect, it } from "vitest";
import {
  agentAdvertisesSessionFork,
  narrowAcpForkCapability,
} from "./fork-capability.js";

describe("narrowAcpForkCapability", () => {
  it("narrows tip to none when the agent does not advertise fork", () => {
    expect(
      narrowAcpForkCapability({ declared: "tip", agentAdvertisesFork: false }),
    ).toBe("none");
  });

  it("keeps tip when the agent advertises fork", () => {
    expect(
      narrowAcpForkCapability({ declared: "tip", agentAdvertisesFork: true }),
    ).toBe("tip");
  });

  it("never widens a declared none", () => {
    expect(
      narrowAcpForkCapability({ declared: "none", agentAdvertisesFork: true }),
    ).toBe("none");
    expect(
      narrowAcpForkCapability({ declared: "none", agentAdvertisesFork: false }),
    ).toBe("none");
  });

  it("reads ACP initialize sessionCapabilities.fork", () => {
    expect(agentAdvertisesSessionFork({ agentCapabilities: {} })).toBe(false);
    expect(
      agentAdvertisesSessionFork({
        agentCapabilities: { sessionCapabilities: { fork: {} } },
      }),
    ).toBe(true);
  });
});
