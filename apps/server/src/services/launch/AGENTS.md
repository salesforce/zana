# launch service — preflight routing notes

## OpenCode role preflight

`preflightStructuredRouting` / `discoverRoleTargets` in `execution-routing.ts` validates OpenCode `--agent` roles at launch time, blocking spawns for non-launchable (subagent/hidden) roles with `role target unavailable` error. Full OpenCode role/model rules, discovery mechanism, and required E2E tests are in `../../../../host-daemon/AGENTS.md` (OpenCode role/model coupling section).
