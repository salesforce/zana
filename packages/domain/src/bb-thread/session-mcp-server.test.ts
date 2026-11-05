import { describe, expect, it } from "vitest";
import {
  SESSION_MCP_SERVERS_MAX,
  sanitizeSessionMcpServers,
} from "./provider-types.js";

describe("sanitizeSessionMcpServers", () => {
  it("keeps launchable servers and drops malformed ones", () => {
    const out = sanitizeSessionMcpServers([
      { name: "plugin_a_one", type: "stdio", command: "node", args: ["x.js"], env: { K: "v" } },
      { name: "plugin_a_remote", type: "http", url: "https://example.test/mcp" },
      { name: "plugin_a_nocmd", type: "stdio" },
      { name: "plugin_a_nourl", type: "http" },
      { name: "bad name", type: "stdio", command: "node" },
      { name: "plugin_a_extra", type: "stdio", command: "node", surprise: true },
      "not-an-object",
      null,
    ]);
    expect(out.map((s) => s.name)).toEqual(["plugin_a_one", "plugin_a_remote"]);
  });

  it("keeps the first of duplicate names and caps the list", () => {
    const dup = sanitizeSessionMcpServers([
      { name: "dup", type: "stdio", command: "a" },
      { name: "dup", type: "stdio", command: "b" },
    ]);
    expect(dup).toHaveLength(1);
    expect(dup[0]?.command).toBe("a");
    const many = Array.from({ length: SESSION_MCP_SERVERS_MAX + 10 }, (_, i) => ({
      name: `s${i}`,
      type: "stdio",
      command: "node",
    }));
    expect(sanitizeSessionMcpServers(many)).toHaveLength(SESSION_MCP_SERVERS_MAX);
  });

  it("rejects oversized env", () => {
    const env = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`K${i}`, "v"]));
    expect(sanitizeSessionMcpServers([{ name: "big", type: "stdio", command: "n", env }])).toEqual([]);
  });
});
