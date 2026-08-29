import { describe, expect, it } from "vitest";
import { collectTestPluginApp } from "@zana-ai/zcc-plugin-sdk/testing/app";
import { readPluginManifest, derivePluginId } from "@zana-ai/zcc-domain";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import app from "../app.js";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
describe("keep-awake plugin", () => {
  it("declares a host entry and settings section", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(derivePluginId(pkg.name)).toBe("keep-awake");
    expect(readPluginManifest(pkg).hostEntry).toBe("./host.mjs");
    expect(collectTestPluginApp(app, "keep-awake").settingsSections[0]?.id).toBe("keep-awake");
  });
});
