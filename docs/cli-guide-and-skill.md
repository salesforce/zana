# CLI, guide, and skill

Keep the discoverable surfaces in sync whenever you add or change a `zcc` CLI
command, flag, or a user-facing configuration knob (env var, data-dir flag):

1. Update the command implementation under `packages/cli/src/lib` (and
   `packages/cli/src/lib/commands/` for product-API groups).
2. Update the `zcc-cli` skill at
   `apps/server/src/plugins/builtin-skills/zcc-cli/SKILL.md` (overflow belongs in
   `references/`, not a mega-file).
3. Update the matching `zcc guide` chapter in
   `packages/cli/src/lib/guide-chapters.ts`.

`zcc guide` is the only fully offline command. Everything else needs the app
(product HTTP at `ZCC_SERVER_URL`, default `http://127.0.0.1:8780`).

Plugin-owned verbs (`zcc tasks`, later automations) are documented in that
plugin's `skills/*/SKILL.md`, not in `zcc-cli`. The generated `plugin-commands`
skill lists contributed names.

A reserved-name / help / skill-heading guard lives in
`packages/cli/src/lib/plugin-cli-proxy.test.ts` and
`packages/cli/src/lib/cli-guide-and-skill.test.ts`.
