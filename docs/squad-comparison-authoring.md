# Authoring Squad Comparisons

Read this before comparing Zana Squads with Claude Unleashed (CU), proposing parity changes, or writing agent-facing guidance. This is internal product guidance, not a competitive feature scorecard.

## Intentional Style

Zana supplies a generic execution engine and declarable capabilities. Authors choose the shape of the work in their plans. A plan may implement a review/fix loop or a delivery pipeline; the engine does not make that pipeline mandatory.

The governing question is: **Does this mechanism authorize or guard a human decision, or does it impose a shape on the work?** Keep human authorization and escalation. Reject imposed workflow shape.

This does not mean unrestricted execution. Admission validation, ownership checks, deterministic checks, bounded retries, and human launch policy remain enforced. They constrain authority and correctness, not a prescribed sequence of roles.

## Comparison Rules

| Topic | Zana's deliberate choice | Do not infer |
| --- | --- | --- |
| Workflow | Review, verification, fixing, and delivery are authored plan content. | Missing mandatory review stages are a product defect. |
| Launch authority | Keep user-set launch approval and human escalation. An immediate request does not bypass policy. | Rejecting workflow gates means removing human approval. |
| Delivery | Declare push capability; plan steps perform delivery. Core remains vendor-neutral. | Core should own a delivery phase, PR creator, delivery enum, or SDK delivery event. |
| Checks | Owners configure named shell commands in Settings; plans reference names. | Plan text or persona files may supply trusted check commands. |
| Completion | Deterministic check references and explicit failure behavior. | Free-text promises are executable completion guarantees. |
| Retry | Bounded execution-layer retry with structured feedback and stall detection. | Prompt-only instructions enforce retry limits. |
| Defaults | Explicit launch overrides plan declarations, which override Squad defaults, then defaults. Effective settings are snapshotted at claim. | Changing Squad settings should change a running execution. |
| Checkout | Main validates registered checkout identity. User-owned targets remain leave-only. | Convenience justifies silently switching repositories or deleting user work. |
| Roles | Plans route work using available persona identities or labels. | Every run needs a hard-coded reviewer, verifier, fixer, or fixed stage taxonomy. |

An author may choose a CU-like workflow as a plan. That does not justify turning that plan into universal engine policy.

## Deliberate Non-Goals

- Do not adopt CU as Zana's runtime or dependency merely to achieve parity.
- Do not enforce a universal plan, implement, review, and PR sequence.
- Do not add an engine-owned delivery phase or core vendor-specific PR semantics.
- Do not make plan command text or persona configuration the trust anchor for named checks.
- Do not weaken default-deny push, launch approval, or non-destructive user-owned checkout handling to imitate another tool's defaults.
- Do not treat silently ignored free-text stop/completion declarations as compatibility.

These are choices, not evidence that every external system follows the opposite policy.

## Evidence And Status

Every comparison must distinguish:

1. **Verified Zana behavior:** cite code, tests, or runtime evidence and identify the branch or release. A tested worktree is not a shipped release.
2. **Planned behavior:** cite the proposal/plan and label it planned. Do not promote a Draft into a shipped capability.
3. **Intentional non-goal:** cite an explicit decision. Do not count it as a bug or parity gap.
4. **Genuine gap or regression:** cite a missing contract, failing test, or observed behavior. Design intent does not excuse defects.
5. **External behavior:** pin the external repository/version. Old research is not current evidence.

Historical examples of genuine Zana gaps included live run-end settings instead of claim snapshots, a dead push-authorization route, missing structured failure handoff, and launch options missing from public surfaces. Those were repair targets, not expressions of Zana's workflow philosophy. Verify their current status before repeating them.

The CU comparison informing this work was pinned to **Claude Unleashed `ff2b5e89c`**, not an evergreen statement about CU. Use wording such as "At the compared commit...". Claims about today's CU need fresh evidence. Likewise, historical findings about permission bypass, destructive pruning, dependency fan-in, daemon fallback, budgets, or prompt-only caps must retain their source pin; do not generalize them into claims that CU always behaves that way.

## Decision Sources

Canonical planning source: Doc Vault Topic `zana/squad-cu-updates`.

- `proposal.md`, **Decisions Made D1-D9**: keep Zana's engine; authors own review/workflow shape; preserve human launch authority; user-owned targets are non-destructive; delivery is a capability; checks are owner-gated; retry shares cap/feedback primitives rather than importing Goals orchestration.
- `proposal.md`, **Obligations OBL-001-OBL-009**: inherited defaults, claim snapshots, push capability, structured retry, deterministic checks, declaration rejection, routing, and launch-surface parity.
- `plan.md`, **AC18-AC22**: canonical existing-checkout selection, main validation, visible execution location, no silent fallback, and full-boundary verification.
- Both documents contain source/freshness metadata. Preserve that boundary when quoting historical findings; Draft status is not implementation or release approval.

For operational details, read [Teams and Personas](teams-and-personas-guide.md) and [CLI](cli.md). For authority and implementation invariants, read [AGENTS.md](../AGENTS.md). When operational docs conflict with code or old research, investigate the specific discrepancy rather than treating documentation drift as product architecture.

## Author Checklist

- Describe the user's need before proposing a parity feature.
- Separate transferable capability from imposed workflow.
- Name the human decision or correctness invariant a proposed guard protects.
- Preserve inheritance, snapshot semantics, owner command authority, bounded retry, and checkout ownership.
- Distinguish intentional non-goals from bugs and unfinished work.
- Pin external claims and label Zana's actual implementation/release status.
- Never convert this guidance into a mandatory execution pipeline.
