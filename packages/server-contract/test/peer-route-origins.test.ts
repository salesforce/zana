import { describe, expect, it } from "vitest";
import * as contract from "../src/index.js";

describe("peer route origin contracts", () => {
  it("accepts a bounded strict origin request and list response", () => {
    expect(contract.peerRouteOriginRequestSchema.parse({ origin: "https://peer.example" })).toEqual({ origin: "https://peer.example" });
    expect(contract.peerRouteOriginListResponseSchema.parse({ origins: ["https://peer.example"] })).toEqual({ origins: ["https://peer.example"] });
  });

  it("rejects empty, oversized, extra-field and over-cap payloads", () => {
    for (const body of [{}, { origin: "" }, { origin: "x".repeat(257) }, { origin: 1 }, { origin: "https://a.example", extra: true }]) {
      expect(contract.peerRouteOriginRequestSchema.safeParse(body).success).toBe(false);
    }
    expect(contract.peerRouteOriginListResponseSchema.safeParse({ origins: Array.from({ length: 33 }, (_, i) => `https://p${i}.example`) }).success).toBe(false);
  });

  it("includes the awaiting installation status", () => {
    expect(contract.peerInstallationSchema.shape.status.options).toContain("awaiting");
  });
});
