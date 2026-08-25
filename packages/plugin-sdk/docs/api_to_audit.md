# API surfaces to audit

New plugin SDK surfaces ship as `experimental_*` until they have a second
in-tree consumer and a documented contract.

| Surface | Status | Notes |
|---|---|---|
| `agents.experimental_registerProvider` | experimental | Thread provider catalog. May change without a major bump. |
| Typed RPC (`rpc.method` + Standard Schema) | not yet | Untyped handlers are the day-one contract. |
| `zcc.host` workers | deferred | Manifest field exists; no authoring loop yet. |
| Product SDK (`zcc.sdk` spawn/HTTP) | deferred | Use the CLI / public HTTP instead. |

Do not promote an experimental surface to stable from a single plugin.
