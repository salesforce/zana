# Skills And Approvals

Plugins teach agents through manifest `package.json` `zcc.skills`, runtime `zcc.agents.contributeSkills(rootPaths)`, and generated `plugin-commands` from `zcc.cli.register`. A plugin verb must provide usable command guidance in a new thread catalog.

For publish, activate, delete, or similarly forged/replayed UI actions, use `experimental_requestApproval` in renderer and `zcc.ui.experimental_consumeApproval` in server. Bind exact action, trusted target, target label, subject, and optional revision/confirmText. Rebuild binding from server data, never request payload. Token is plugin-scoped, single-use, and short-lived. Web, mobile, and headless return unavailable: fail closed. Agent actions use `sdk.confirm` plus thread guardrail.
