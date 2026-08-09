/**
 * Main-process entry for the zana DISK extension.
 *
 * The host spawns a per-extension utilityProcess and `import()`s this module
 * there; its `default` export must be a {@link MainModule}. We re-export
 * `zanaMainModule`, which maps zana's 7 renderer-facing capabilities
 * (getSnapshot / getTicket / getArtifact / listProfiles / getProfile /
 * assignTicket / getVersionInfo) onto zana's MCP server via the brokered
 * `ctx.mcp('zana', tool, args)` capability — so in the isolated child every data
 * call forwards over the broker port to the host-managed MCP child pool
 * (permission-gated against the manifest's `mcp` grant + `mcpAllowlist: ['zana']`).
 * `getVersionInfo` additionally uses the brokered `ctx.exec`/`ctx.fetch` caps
 * (npm + registry query), gated by the `exec`/`net` grants.
 *
 * The build externalizes only `electron` + node builtins; zana-main imports
 * neither (it's pure JS + ctx capabilities + shared types), so the bundle is
 * self-contained.
 */
import { zanaMainModule } from './main/zana-main.js';

export default zanaMainModule;
