/** Plans written for the pre-`Prefer role` grammar; none uses a new label or needs a normalization. */
export const COMPATIBILITY_CORPUS: Record<string, string> = {
  'vault-contract': `# Plan

## Launch
- Worktree: true
- Checks: check:lint, check:tests

## Execution Plan

### design: Design it <!-- executable-step -->
- **Depends on:** None
- **Execution class:** Standard
- **Required role:** Architect
- **Mode:** Read-only
- **Read scope:** \`src/**\`
- **Write scope:** None
- **Excludes:** \`node_modules/**\`
- **Work:** Sketch the design.
- **Verification:** Reviewer agrees.
- **Completion criteria:** check:lint
- **Outputs / handoff:** A design note.

### build: Build it <!-- executable-step -->
- **Depends on:** design
- **Execution class:** Expert
- **Required role:** \`builtin:squad-worker-high\`
- **Mode:** Mutating
- **Write scope:** \`src/**\`, \`docs/**\`
- **Work:** Implement.
  Second line.
- **Verification:** Tests pass.
- **On failure:** retry build up to 2 with feedback
`,
  'bare-labels-and-requires': `### U1: First <!-- executable-step -->
**Work:** inspect only
**Mode:** read-only
**Verification:** v

### U2: Second <!-- executable-step -->
- Depends on: U1
- Requires: Skills: alpha, beta; MCP servers: repo
- Execution class: Routine.
- Write scope: a.ts
- Work: change a
- Verification: run tests
- Loop: u1 until PASS, max 3
`,
  'near-miss-labels': `### a: A <!-- executable-step -->
- **Write scopes:** x.ts
- **Depend on:** None
- **Work:** do
- **Verification:** v
`
};
