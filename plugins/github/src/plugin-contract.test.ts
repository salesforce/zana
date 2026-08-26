import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectTestPluginApp } from "@zana-ai/zcc-plugin-sdk/testing/app";
import { derivePluginId } from "@zana-ai/zcc-domain";
import app from "../app.js";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
describe("github plugin", () => {
  it("derives a stable id and registers a nav panel", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(derivePluginId(pkg.name)).toBe("github");
    const set = collectTestPluginApp(app, "github");
    expect(set.navPanels[0]?.title).toBe("GitHub");
  });
});
