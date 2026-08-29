# Agent gate

Inside a Zana agent terminal the app sets `ZCC_SESSION_ID`. The CLI forwards it
on the control plane and the product API classifies the caller as an **agent**.

Mutating ops then fail with `FORBIDDEN_AGENT` and exit 5:

- `zcc thread spawn` / `zcc run`
- `zcc thread tell` / `zcc agent send`
- `zcc thread stop` / archive / unarchive / open / fork
- `zcc terminal create|send|close`
- `zcc machine rename|remove`
- `zcc settings` writes
- `zcc schedule run-now|enable|disable`

Reads stay allowed: `status`, `thread list|show|log|wait`, `machine list|show`,
`project list|show`, `guide`, inbox/followup/schedule/personas list.

The **host-stamped orchestrator** is the exception: the app itself may spawn and
close worker threads. Agents must not impersonate it by exporting `ZCC_SESSION_ID`.
