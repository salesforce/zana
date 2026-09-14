import { describe, expect, it } from "vitest";
import {
  PLUGIN_METADATA_MAX_BYTES,
  deepFreezePluginMetadata,
  exceedsPluginMetadataLimit,
  parsePersistedPluginMetadata,
  validatePluginMetadata,
} from "./plugin-metadata.js";

describe("plugin metadata", () => {
  it("accepts a plain JSON object under the 256 KiB cap", () => {
    expect(validatePluginMetadata({ ticket: "W-1", nested: { ok: true } })).toEqual({
      ticket: "W-1",
      nested: { ok: true },
    });
    expect(exceedsPluginMetadataLimit("{}")).toBe(false);
  });

  it("rejects arrays, custom prototypes, cycles, and oversized payloads", () => {
    expect(() => validatePluginMetadata([])).toThrow(/plain JSON object/);
    expect(() => validatePluginMetadata(null)).toThrow(/plain JSON object/);
    expect(() => validatePluginMetadata(Object.create({ a: 1 }))).toThrow(/plain JSON data/);
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => validatePluginMetadata(cyclic)).toThrow(/cycle/);
    const oversized = { blob: "x".repeat(PLUGIN_METADATA_MAX_BYTES) };
    expect(() => validatePluginMetadata(oversized)).toThrow(/256 KiB/);
  });

  it("recovers corrupt persisted JSON to undefined without throwing", () => {
    expect(parsePersistedPluginMetadata("{")).toBeUndefined();
    expect(parsePersistedPluginMetadata("[]")).toBeUndefined();
    expect(parsePersistedPluginMetadata("null")).toBeUndefined();
    expect(parsePersistedPluginMetadata('{"a":1}')).toEqual({ a: 1 });
  });

  it("deep-freezes the namespace so configure callers cannot mutate it", () => {
    const frozen = deepFreezePluginMetadata({ nested: { n: 1 } });
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.nested)).toBe(true);
    expect(() => {
      (frozen as { extra?: string }).extra = "no";
    }).toThrow();
  });
});
