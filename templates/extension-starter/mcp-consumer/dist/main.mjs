const MCP_SERVER_ID = 'REPLACE_WITH_MCP_SERVER_ID';
const TOOL_NAME = 'REPLACE_WITH_MCP_TOOL_NAME';

export default {
  setup(ctx) {
    return {
      async listItems() {
        try {
          const result = await ctx.mcp(MCP_SERVER_ID, TOOL_NAME, {});
          return Array.isArray(result) ? result : [];
        } catch {
          return [];
        }
      }
    };
  }
};
