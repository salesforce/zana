# Skills service coupling notes

## Plugin-contributed agent capabilities (skills + MCP)

Invariants:
- New plugins declare in `package.json` → `zcc.skills` / `zcc.mcpServers` (`PluginManifest`).
- Leftover disk extensions declare on `ExtensionManifest.skills`/`mcpServers` in `extension.json`.
- Skills (`SKILL.md`) and MCP server definitions are filesystem artifacts consumed by `claude` CLI processes outside ZCC control.
- Two sync functions, both gated identically (enabled ∧ consented ∧ `agent:contribute` declared).

Why: Unlike personas/teams (pure in-memory), skills/MCP are static-config artifacts. Declared in manifest, not registered live.

Where: Called from boot, install/uninstall/enable/disable, disk-sync reconcile, "Reload skills & MCP" button:
- `rebuildExtensionServers` (`apps/host-daemon/src/mcp-config.ts`) REPLACES module-scoped `ext:<id>:<name>` slice of MCP registry. `alwaysOn: true` server merges into every project's `.mcp.json`; others resolve when persona names via `extraServerNames`. `command` is basename-only (same `execAllowlist` guard).
- `syncExtensionSkills` (`apps/server/src/services/skills/skill-installer.ts`) deploys to `~/.claude/skills/ext-<id>-<slug>/SKILL.md` after PRUNING previously-deployed `ext-<id>-*` dirs. `path` confined via `resolveContainedReal` (Rule 2, symlink-escape-safe). Uninstall calls `removeSkillsForExtension` directly (absent extension never pruned again).

Both best-effort + never throw (one malformed contributor doesn't block rest). Consent screen (`ConsentBody.tsx agentCapabilityLines`) names CONCRETE skill slugs/server names+alwaysOn — never bare permission token, never env VALUES (`ExtensionMcpServerContributionView` strips to `envKeys` before projection reaches renderer, Rule 1).

When changing: Sync both `rebuildExtensionServers` and `syncExtensionSkills` at same choke points; verify consent screen shows concrete names, not tokens; ensure env values never reach renderer.

## Bundled skills + per-project MCP config

Invariants:
- Product skills live in `apps/server/src/plugins/builtin-skills/`; injected at thread spawn (project > plugin > builtin).
- Only `zcc-cli` also copied into `~/.claude/skills` at boot and via "Reload skills & MCP" button.
- Roster lives in ONE place: `skill-installer.ts BUNDLED_SKILLS`.
- `redeployBundledSkills()` iterates roster (boot fan-out + button); deploys idempotent + edit-respecting.
- `redeployCapabilities` handler also re-runs `ensureMcpConfigForProject` for every project and fires `skills:onChanged`.

Why: Deploys only rewrite when shipped content differs; user's local skill tweak survives until version bump. Plugin-contributed skills/MCP sync through same choke points (`syncExtensionSkills` / `rebuildExtensionServers`).

Where: Add new global CLI skill to `BUNDLED_SKILLS` once (not in the `apps/desktop/src/host.ts` boot block). `harness-authoring` stays in `resources/` for maintainers; not injected into user threads.

Guard: `apps/server/src/services/skills/__tests__/redeploy-bundled-skills.test.ts`. Keep `zcc-cli`, `zcc guide` chapters, CLI `--help` in lockstep (`docs/cli-guide-and-skill.md`).

When changing: Add to `BUNDLED_SKILLS` for new global skill; run test; update guide + CLI help if CLI skill.

## Skill load policy (on / manual / off)

Invariants:
- Every skill defaults to **on**; manual/off are operator opt-outs. Never ship a default that hides a freshly installed plugin's skills.
- ZCC-injected skills (`zcc:<owner>/<name>` rows) store state in `<dataDir>/skill-policy.json` (`skill-policy.ts`, atomic + serialized). Claude Code user/project skills store it in `skillOverrides` (`manual` = `user-invocable-only`). Routing lives in `skill-state.ts`; anything else is read-only.
- Enforcement is in the host daemon at snapshot time (`apps/host-daemon/src/skill-snapshots.ts`): `off` drops the skill dir; `manual` rewrites `SKILL.md` with `disable-model-invocation: true` (Claude, Pi) and adds `agents/openai.yaml` `allow_implicit_invocation: false` (Codex); ACP's instruction listing omits manual skills. Claude ignores `skillOverrides` for plugin-sourced skills, so injected skills must be filtered there, not via settings.
- Policy is keyed by skill directory name, and `hashInjectedSkillCatalog` includes it. Changes apply to new threads; running threads keep their immutable snapshot.

When changing: keep `readSkillPolicy` (server) and `readInjectedSkillPolicy` (host daemon) validation identical; run `skill-snapshots.test.ts`, `injected-skill-roots.test.ts`, and the `apps/server/src/services/skills` suite.
