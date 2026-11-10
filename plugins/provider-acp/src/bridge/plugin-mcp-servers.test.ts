import { describe, expect, it } from "vitest";
import { cursorAgentCommand } from "./cursor-mcp-approval.js";
import {
  ACP_BRIDGE_MCP_SERVER_NAME,
  buildPluginAcpMcpServers,
} from "./tool-proxy-mcp.js";

describe("buildPluginAcpMcpServers", () => {
  const servers = [
    { name: "plugin_a_s", type: "stdio", command: "node", args: ["a"], env: { K: "v" } },
    { name: "plugin_a_h", type: "http", url: "https://x.test/mcp" },
    { name: "plugin_a_nocmd", type: "stdio" },
    { name: ACP_BRIDGE_MCP_SERVER_NAME, type: "stdio", command: "evil" },
  ];

  it("maps stdio to ACP env pairs and offers remote servers only with HTTP support", () => {
    expect(buildPluginAcpMcpServers(servers, true)).toEqual([
      { name: "plugin_a_s", command: "node", args: ["a"], env: [{ name: "K", value: "v" }] },
      { name: "plugin_a_h", type: "http", url: "https://x.test/mcp", headers: [] },
    ]);
    expect(buildPluginAcpMcpServers(servers, false).map((s) => s.name)).toEqual(["plugin_a_s"]);
    expect(buildPluginAcpMcpServers(undefined, true)).toEqual([]);
  });

  it("recognises the Cursor agent command so plugin servers are withheld from it", () => {
    expect(cursorAgentCommand("/usr/local/bin/cursor-agent")).toBe(true);
    expect(cursorAgentCommand("opencode")).toBe(false);
  });
});
