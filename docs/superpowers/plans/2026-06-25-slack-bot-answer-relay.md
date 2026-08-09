# Slack Bot Answer-Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a bot-launched Claude session finishes a turn (transitions to `idle`), post a short LLM summary of that turn into the session's Slack thread, turning the thread into a real back-and-forth.

**Architecture:** Three parts, each respecting an existing trust boundary. The renderer (`SlackBot.tsx`) forwards the `idle` agentStatus edge to main over the existing `sessionEvent` IPC — no summary text crosses the renderer. Core (`index.ts`) wires a new generic, Slack-agnostic `ctx.summarizeSession` capability that confines the session id to a live session, reads its last turn, and runs a new `builtin:turn-summary` haiku micro-call (`CloseSummaryService.summarizeTurn`). slack-main (`BotRuntime`) handles the `idle` event: finds the bot thread, calls `ctx.summarizeSession`, dedups same-turn re-fires by the summary-text signature, and posts via the prefix-stamping `postBotReply`.

**Tech Stack:** TypeScript, Electron (main), React (renderer), Vitest. The `@zana-ai/zcc-extension-sdk` package defines the main/renderer module contracts. LLM micro-calls run via `claude --print` (provider `claude-cli`) driven by `PromptRegistry` + `LlmService`.

## Global Constraints

- **CLAUDE.md Rule 1 — the renderer is untrusted; main authorizes.** `ctx.summarizeSession` takes a renderer/extension-supplied `sessionId` and must NOT trust it: core resolves the id to a LIVE session and derives `projectId` from that session itself, then `summarizeTurn` re-confines (`session.projectId === projectId && isClaude(profile)`) before reading any transcript. A foreign/stale/non-claude id is a silent no-op.
- **CLAUDE.md Rule 6 — core never names a specific extension in logic.** The new `ctx.summarizeSession` capability is generic and Slack-agnostic (it mirrors the existing optional `ctx.resolveProjectRoot`). Core never references "slack" when wiring or calling it. The string `slack` appears only in the `MAIN_MODULES`/`APP_MODULES` registration, never in this feature's logic.
- **Every failure path is a silent no-op.** No thread row, unreadable/empty transcript, failed micro-call, or failed post → post nothing. The relay is a courtesy and must never surface an error into the thread or block any other bot behavior.
- **Always-on for bot sessions — no toggle/UI** (locked decision 3). No config flag, no settings surface.
- **Summary text never crosses into the renderer** (locked decision 4). It is produced in main and posted from main.
- **Dedup keys on the returned summary text, not the source last turn.** The locked `summarizeSession`/`summarizeTurn` return shape is `{ ok: boolean; text?: string }` — it carries no source transcript, and slack-main architecturally cannot read transcripts. So `BotRuntime` dedups same-turn idle re-fires on a cheap signature (`length + tail`) of the `text` it receives back. Truly-concurrent idle edges collapse to identical text via `LlmService`'s in-flight `dedupeKey`; time-separated flicker re-fires of an unchanged turn produce a matching signature and are skipped.

---

### Task 1: `ctx.summarizeSession` SDK type + core ctx wiring

Adds the generic, optional `summarizeSession` capability to the main module context and wires `MainModuleHost.setupAll` to forward it onto every built-in module's ctx when the host was given the dep (mirrors how `resolveProjectRoot` is conditionally spread). This is the foundation: it's what slack-main reads in Task 6 and what `index.ts` backs in Task 4.

**Files:**
- Modify: `packages/extension-sdk/src/main.ts` (add field to `MainModuleContext`, after the `teams?` member, ~line 118)
- Modify: `src/main/modules/registry.ts` (add `summarizeSession?` to `ModuleHostDeps` ~line 201; conditional spread in `setupAll` ctx ~line 274)
- Test: `src/main/modules/__tests__/registry-ctx-shape.test.ts` (extend)

**Interfaces:**
- Produces: `MainModuleContext.summarizeSession?(sessionId: string, opts?: { scope?: 'lastTurn' }): Promise<{ ok: boolean; text?: string }>` — consumed by slack-main (Task 6).
- Produces: `ModuleHostDeps.summarizeSession?` (same signature) — backed by `index.ts` (Task 4).

- [ ] **Step 1: Extend the A7 ctx-shape fence (failing test)**

In `src/main/modules/__tests__/registry-ctx-shape.test.ts`, add to the first `it` (after the `resolveProjectRoot` present-or-undefined assertion, before its closing `});` at line 59):

```typescript
    // summarizeSession (Slack-relay feature): additive optional cap — present
    // as a function OR undefined, never required, so this stays green whether or
    // not the host was given the dep.
    expect(
      captured!.summarizeSession === undefined ||
        typeof captured!.summarizeSession === 'function'
    ).toBe(true);
```

Then add a new `it` inside the same `describe` (after the existing first `it`, before the slack `it`):

```typescript
  it('forwards ctx.summarizeSession when the host was given the dep', async () => {
    const summarizeSession = vi.fn(async () => ({ ok: true, text: 'did a thing' }));
    const host = new MainModuleHost({ log: () => {}, summarizeSession });
    let captured: MainModuleContext | undefined;
    const probe: MainModule = {
      id: 'probe',
      async setup(ctx) {
        captured = ctx;
        return {};
      }
    };

    await host.setupAll([probe]);

    expect(typeof captured!.summarizeSession).toBe('function');
    await captured!.summarizeSession!('S1', { scope: 'lastTurn' });
    expect(summarizeSession).toHaveBeenCalledWith('S1', { scope: 'lastTurn' });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/modules/__tests__/registry-ctx-shape.test.ts`
Expected: FAIL — the new `it` fails because `MainModuleHost` doesn't accept a `summarizeSession` dep / doesn't forward it (`typeof captured!.summarizeSession` is `'undefined'`).

- [ ] **Step 3: Add the SDK type**

In `packages/extension-sdk/src/main.ts`, add this member to `MainModuleContext` immediately after the `teams?: { ... }` block (after line 118, before the closing `}` of the interface):

```typescript
  /**
   * Summarize a live session's latest turn into a short, human-readable note.
   * Generic and capability-shaped like {@link resolveProjectRoot}: the HOST
   * resolves the supplied `sessionId` to a live session it owns and confines it
   * (Rule 1) before reading any transcript — a foreign/stale/ineligible id
   * resolves to `{ ok: false }`, never an error and never a cross-session read.
   * The returned `text` is a 1–3 sentence plain-text summary; absent on failure.
   *
   * Optional like exec/fs/fetch: a `{ storage, log }`-only module still
   * typechecks, and a host that doesn't supply a summarizer omits it.
   */
  summarizeSession?: (
    sessionId: string,
    opts?: { scope?: 'lastTurn' }
  ) => Promise<{ ok: boolean; text?: string }>;
```

- [ ] **Step 4: Add the host dep + conditional spread**

In `src/main/modules/registry.ts`, add to the `ModuleHostDeps` interface (after the `registry?` member, before the closing `}` at line 202):

```typescript
  /**
   * Backs the built-in `ctx.summarizeSession` capability. Optional / additive:
   * when absent (e.g. a test host) the ctx omits it. Unlike personas/teams this
   * does NOT use `mod.id` — it takes a sessionId directly and the core impl
   * confines it — so it's a flat dep, forwarded verbatim.
   */
  summarizeSession?: (
    sessionId: string,
    opts?: { scope?: 'lastTurn' }
  ) => Promise<{ ok: boolean; text?: string }>;
```

Then in `setupAll`, add a conditional spread to the `ctx` object — immediately after the `...(this.deps.registry ? { personas, teams } : {})` block (after line 274, before the closing `}` of the ctx literal at line 275):

```typescript
        ,
        // Generic, Slack-agnostic turn summarizer (Rule 6: core never names the
        // consumer). Forwarded verbatim when the host was given it; the core
        // impl resolves + confines the sessionId before reading (Rule 1).
        ...(this.deps.summarizeSession
          ? { summarizeSession: this.deps.summarizeSession }
          : {})
```

Note: the existing ctx literal ends at line 275 with `};` immediately after the personas/teams spread. Place the new spread before that `};` — the leading `,` above closes the personas/teams spread expression. If the editor shows the personas/teams spread already ends without a trailing comma, add the comma; the object-literal spread sequence must remain comma-separated.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/main/modules/__tests__/registry-ctx-shape.test.ts`
Expected: PASS — both the extended first test and the new forwarding test are green.

- [ ] **Step 6: Commit**

```bash
git add packages/extension-sdk/src/main.ts src/main/modules/registry.ts src/main/modules/__tests__/registry-ctx-shape.test.ts
git commit -m "feat(slack-relay): add generic ctx.summarizeSession capability + host wiring"
```

---

### Task 2: `builtin:turn-summary` prompt

Adds the new haiku prompt that turns a session's last transcript turn into a 1–3 sentence Slack-facing summary. Sits between `close-summary` (terse did/left JSON) and `session-summary` (rich whole-arc, sonnet).

**Files:**
- Modify: `src/main/prompt-registry.ts` (add entry to the `BUILTIN` array, after the `builtin:close-summary` entry ~line 88)
- Test: `src/main/__tests__/prompt-registry.test.ts` (add a test)

**Interfaces:**
- Produces: a `LlmPromptEntry` with `id: 'builtin:turn-summary'`, `provider: 'claude-cli'`, `model: 'haiku'`, `userTemplate` containing `{{lastTurn}}`, `maxOutputChars: 600`, `timeoutMs: 30_000` — looked up by `index.ts` via `promptRegistry.get('builtin:turn-summary')` (Task 4).

- [ ] **Step 1: Write the failing test**

In `src/main/__tests__/prompt-registry.test.ts`, add this `it` inside the `describe('PromptRegistry', ...)` block (after the `ships the built-in tab-namer` test, ~line 42):

```typescript
  it('ships the built-in turn-summary (haiku, last-turn input)', () => {
    const entry = registry.get('builtin:turn-summary');
    expect(entry).not.toBeNull();
    expect(entry?.source).toBe('builtin');
    expect(entry?.provider).toBe('claude-cli');
    expect(entry?.model).toBe('haiku');
    expect(entry?.userTemplate).toContain('{{lastTurn}}');
    expect(entry?.maxOutputChars).toBe(600);
    expect(entry?.timeoutMs).toBe(30_000);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/__tests__/prompt-registry.test.ts -t turn-summary`
Expected: FAIL — `registry.get('builtin:turn-summary')` returns `null`.

- [ ] **Step 3: Add the prompt entry**

In `src/main/prompt-registry.ts`, add this object to the `BUILTIN` array immediately after the `builtin:close-summary` entry (after its closing `},` at line 88, before the `builtin:session-summary` entry):

```typescript
  {
    id: 'builtin:turn-summary',
    label: 'Turn summary',
    description:
      'Summarizes what a bot-launched agent just said in its latest turn, for relaying back into its Slack thread. Runs each time such a session finishes a turn (haiku — kept cheap).',
    provider: 'claude-cli',
    model: 'haiku',
    systemPrompt: [
      'You summarize what a coding agent just said or did in its LATEST turn, for a',
      'teammate reading on Slack. Reply with 1 to 3 terse, plain-text sentences —',
      'no preamble, no code fences, no Markdown headings or bullets, no tool use.',
      'If the agent asked the user a question or is waiting on a decision, LEAD with',
      'that question. Summarize only what the turn shows — never invent steps, files,',
      'or outcomes. If the turn is too thin to tell what happened, say so in one',
      'short honest sentence instead of padding.'
    ].join(' '),
    userTemplate: 'The agent last said:\n\n{{lastTurn}}\n\nSummary:',
    maxOutputChars: 600,
    timeoutMs: 30_000
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/__tests__/prompt-registry.test.ts -t turn-summary`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/prompt-registry.ts src/main/__tests__/prompt-registry.test.ts
git commit -m "feat(slack-relay): add builtin:turn-summary prompt"
```

---

### Task 3: `CloseSummaryService.summarizeTurn` + `runTurnSummary` dep

Adds a sibling to `summarizeOne` that returns the turn summary text (instead of pushing to the inbox), reusing the existing `readLastTurn` reader and a new injected `runTurnSummary` micro-call dep. Same confinement gate as `summarizeOne`.

**Files:**
- Modify: `src/main/close-summary.ts` (add `runTurnSummary` to `CloseSummaryDeps` ~line 47; add `summarizeTurn` method to `CloseSummaryService` after `summarizeOne` ~line 303)
- Test: `src/main/__tests__/close-summary.test.ts` (add `runTurnSummary` to `makeDeps`; add a `summarizeTurn` describe block)

**Interfaces:**
- Consumes: `CloseSummaryDeps.getSession`, `.isClaude`, `.readLastTurn` (existing, from the file).
- Produces: `CloseSummaryDeps.runTurnSummary(lastTurn: string, dedupeKey: string): Promise<LlmRunResult>` — backed by `index.ts` (Task 4).
- Produces: `CloseSummaryService.summarizeTurn(projectId: string, sessionId: string): Promise<{ ok: boolean; text?: string }>` — called by `index.ts`'s `ctx.summarizeSession` impl (Task 4).

- [ ] **Step 1: Write the failing test**

In `src/main/__tests__/close-summary.test.ts`, first add `runTurnSummary` to the `makeDeps` factory so the deps object stays complete after the type gains a required field. Inside `makeDeps` (the object returned ~line 96), add this line after the `runSummary: vi.fn(...)` line:

```typescript
      runTurnSummary: vi.fn(async () => okResult('It finished the refactor and asked whether to delete the old file.')),
```

Then add a new top-level `describe` block at the end of the file (after the final closing `});` of the existing `summarizeOne` describe):

```typescript
describe('CloseSummaryService.summarizeTurn', () => {
  const session = (over: Partial<CloseSummarySessionInfo> = {}): CloseSummarySessionInfo => ({
    projectId: 'p1',
    profile: 'claude',
    cwd: '/proj',
    claudeSessionId: 'cs',
    title: 'Agent',
    ...over
  });
  const okResult = (text: string): LlmRunResult => ({ ok: true, text, provider: 'claude-cli', ms: 1 });

  function makeDeps(over: Partial<CloseSummaryDeps> = {}): CloseSummaryDeps {
    return {
      getSession: () => session(),
      isClaude: (p) => p === 'claude',
      readLastTurn: vi.fn(async () => 'I finished the refactor. Should I delete the old file?'),
      runSummary: vi.fn(async () => okResult('{"did":"x","left":""}')),
      runTurnSummary: vi.fn(async () => okResult('Finished the refactor. Asks whether to delete the old file.')),
      readDigest: vi.fn(async () => 'digest'),
      runSessionSummary: vi.fn(async () => okResult('summary')),
      appendInbox: vi.fn(async () => ({ id: 'e1' })),
      projectLabel: () => 'Proj One',
      ...over
    };
  }

  it('returns the turn summary text on success (reads last turn, runs turn prompt, no inbox)', async () => {
    const deps = makeDeps();
    const res = await new CloseSummaryService(deps).summarizeTurn('p1', 's1');
    expect(res).toEqual({ ok: true, text: 'Finished the refactor. Asks whether to delete the old file.' });
    expect(deps.readLastTurn).toHaveBeenCalled();
    expect(deps.runTurnSummary).toHaveBeenCalledWith(
      'I finished the refactor. Should I delete the old file?',
      'turn-summary:s1'
    );
    // Pure read+summarize — never the inbox or the whole-session digest path.
    expect(deps.appendInbox).not.toHaveBeenCalled();
    expect(deps.readDigest).not.toHaveBeenCalled();
    expect(deps.runSessionSummary).not.toHaveBeenCalled();
  });

  it('returns {ok:false} for a foreign / gone / non-claude session (no read)', async () => {
    const foreign = makeDeps({ getSession: () => session({ projectId: 'other' }) });
    expect(await new CloseSummaryService(foreign).summarizeTurn('p1', 's1')).toEqual({ ok: false });
    expect(foreign.readLastTurn).not.toHaveBeenCalled();

    const gone = makeDeps({ getSession: () => null });
    expect(await new CloseSummaryService(gone).summarizeTurn('p1', 's1')).toEqual({ ok: false });

    const shell = makeDeps({ getSession: () => session({ profile: 'shell' }) });
    expect(await new CloseSummaryService(shell).summarizeTurn('p1', 's1')).toEqual({ ok: false });
  });

  it('returns {ok:false} on an empty/unreadable last turn (no micro-call spent)', async () => {
    const deps = makeDeps({ readLastTurn: vi.fn(async () => '   ') });
    expect(await new CloseSummaryService(deps).summarizeTurn('p1', 's1')).toEqual({ ok: false });
    expect(deps.runTurnSummary).not.toHaveBeenCalled();
  });

  it('returns {ok:false} when the micro-call fails or yields empty text', async () => {
    const failed = makeDeps({
      runTurnSummary: vi.fn(async () => ({ ok: false, text: '', error: 'boom', provider: 'claude-cli', ms: 1 }))
    });
    expect(await new CloseSummaryService(failed).summarizeTurn('p1', 's1')).toEqual({ ok: false });

    const blank = makeDeps({ runTurnSummary: vi.fn(async () => okResult('   ')) });
    expect(await new CloseSummaryService(blank).summarizeTurn('p1', 's1')).toEqual({ ok: false });
  });

  it('swallows a thrown reader/micro-call to {ok:false} (never throws)', async () => {
    const deps = makeDeps({
      readLastTurn: vi.fn(async () => {
        throw new Error('disk');
      })
    });
    await expect(new CloseSummaryService(deps).summarizeTurn('p1', 's1')).resolves.toEqual({ ok: false });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/__tests__/close-summary.test.ts -t summarizeTurn`
Expected: FAIL — `summarizeTurn` is not a function on `CloseSummaryService` (and TS flags the missing `runTurnSummary` dep until Step 3).

- [ ] **Step 3: Add the dep + method**

In `src/main/close-summary.ts`, add the new dep to `CloseSummaryDeps` immediately after the `runSummary` member (after line 47):

```typescript
  /**
   * Run the (Slack-facing, 1–3 sentence) turn-summary prompt over one agent's
   * last turn, returning the prose to relay; never throws. Backs
   * {@link CloseSummaryService.summarizeTurn}. Distinct from {@link runSummary}
   * (which emits terse did/left JSON for the inbox digest).
   */
  runTurnSummary: (lastTurn: string, dedupeKey: string) => Promise<LlmRunResult>;
```

Then add the `summarizeTurn` method to `CloseSummaryService`, immediately after the `summarizeOne` method's closing `}` (after line 303, before `summarizeAndClose`):

```typescript
  /**
   * Summarize ONE live session's latest turn into short prose for relaying
   * elsewhere (e.g. a Slack thread) — NO inbox push. Reads just the last turn
   * (not the whole-session digest) and runs the cheap `turn-summary` prompt, so
   * it's safe to call on every idle edge.
   *
   * Same confinement as {@link summarizeOne} (CLAUDE.md #1): the id must resolve
   * to a live claude-family session in `projectId` or the call is a no-op.
   * Never throws; every failure (ineligible id, empty/unreadable turn, failed
   * micro-call) returns `{ ok: false }` so the caller posts nothing.
   */
  async summarizeTurn(
    projectId: string,
    sessionId: string
  ): Promise<{ ok: boolean; text?: string }> {
    const session = this.deps.getSession(sessionId);
    if (!session || session.projectId !== projectId || !this.deps.isClaude(session.profile)) {
      return { ok: false };
    }
    try {
      const lastTurn = await this.deps.readLastTurn(session.cwd, session.claudeSessionId);
      if (!lastTurn.trim()) return { ok: false }; // nothing to summarize — skip, don't spend a call
      const result = await this.deps.runTurnSummary(lastTurn, `turn-summary:${sessionId}`);
      if (!result.ok || !result.text.trim()) return { ok: false };
      return { ok: true, text: result.text.trim() };
    } catch {
      return { ok: false };
    }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/__tests__/close-summary.test.ts`
Expected: PASS — the new `summarizeTurn` block is green and the existing `summarizeOne`/render tests still pass (the `makeDeps` in the existing block also needs `runTurnSummary`; add the same `runTurnSummary: vi.fn(...)` line there too if TS flags it — see Step 1, which updates the existing factory).

- [ ] **Step 5: Commit**

```bash
git add src/main/close-summary.ts src/main/__tests__/close-summary.test.ts
git commit -m "feat(slack-relay): add CloseSummaryService.summarizeTurn + runTurnSummary dep"
```

Note: `src/main/index.ts` does not yet pass `runTurnSummary` to `CloseSummaryService`, so a full-project `tsc` is intentionally red between this commit and Task 4. The unit test above runs under Vitest (which does not typecheck `index.ts`) and is green; the full typecheck gate is Task 4 Step 4.

---

### Task 4: Wire the core composition root (`index.ts`)

Backs the two new seams: injects `runTurnSummary` into the `CloseSummaryService` construction and supplies `summarizeSession` to `MainModuleHost`. The `summarizeSession` impl resolves the supplied id to a LIVE session and derives `projectId` from it before delegating to `summarizeTurn` (Rule 1 confinement).

**Files:**
- Modify: `src/main/index.ts` (add `runTurnSummary` to the `CloseSummaryService` deps ~line 584; add `summarizeSession` to the `MainModuleHost` deps ~line 640)

**Interfaces:**
- Consumes: `promptRegistry.get('builtin:turn-summary')` (Task 2), `llmService.run` (existing), `closeSummary.summarizeTurn` (Task 3), `MainModuleHost`'s `summarizeSession?` dep (Task 1), `ptys.getSession(sessionId)` → `{ projectId, ... } | null` (existing).
- Produces: a live, confined `ctx.summarizeSession` for the built-in module tier.

- [ ] **Step 1: Add the `runTurnSummary` dep to `CloseSummaryService`**

In `src/main/index.ts`, inside the `new CloseSummaryService({ ... })` literal, add this dep immediately after the `runSummary: (lastTurn, dedupeKey) => { ... },` block (after line 584, before `readDigest`):

```typescript
  runTurnSummary: (lastTurn, dedupeKey) => {
    const entry = promptRegistry.get('builtin:turn-summary');
    if (!entry) {
      return Promise.resolve({
        ok: false,
        text: '',
        error: 'no turn-summary prompt',
        provider: 'claude-cli',
        ms: 0
      });
    }
    return llmService.run(entry, { lastTurn }, dedupeKey);
  },
```

- [ ] **Step 2: Add the `summarizeSession` dep to `MainModuleHost`**

In `src/main/index.ts`, inside the `new MainModuleHost({ ... })` literal, add this dep immediately after the `registry: personaTeamRegistry` line (after line 639, before the closing `});` at line 640). Add a trailing comma to the `registry: personaTeamRegistry` line first:

```typescript
  registry: personaTeamRegistry,
  // Back the generic built-in `ctx.summarizeSession` (Slack answer-relay et al.).
  // Confinement (CLAUDE.md #1): resolve the supplied id to a LIVE session and
  // take projectId FROM that session — never from the caller — then summarizeTurn
  // re-confines before reading. An unknown id → {ok:false}, never a read.
  summarizeSession: async (sessionId) => {
    const s = ptys.getSession(sessionId);
    if (!s) return { ok: false };
    return closeSummary.summarizeTurn(s.projectId, sessionId);
  }
```

- [ ] **Step 3: Run the full typecheck**

Run: `npm run typecheck`
Expected: PASS — `index.ts` now satisfies the `CloseSummaryDeps` (required `runTurnSummary`) and passes a valid `summarizeSession` to `ModuleHostDeps`. (If `npm run typecheck` is not a script, use `npx tsc --noEmit -p tsconfig.json`.)

- [ ] **Step 4: Run the affected unit suites (regression)**

Run: `npx vitest run src/main/__tests__/close-summary.test.ts src/main/modules/__tests__/registry-ctx-shape.test.ts src/main/__tests__/prompt-registry.test.ts`
Expected: PASS — all green.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(slack-relay): wire runTurnSummary + confined ctx.summarizeSession in core"
```

---

### Task 5: `formatAnswer` pure helper

Adds the pure formatter that produces the relay message BODY (the poster stamps the `:robot_face:` prefix). Hard-caps the body at ~2 KB with a `…(truncated)` marker as a runaway-summary backstop.

**Files:**
- Modify: `plugins/slack/shared/notify-format.ts` (add `formatAnswer` + a cap constant)
- Test: `plugins/slack/shared/notify-format.test.ts` (add a `formatAnswer` describe block)

**Interfaces:**
- Produces: `formatAnswer(text: string): string` — returns the trimmed body, capped; imported by `slack-main.ts` (Task 6).

- [ ] **Step 1: Write the failing test**

In `plugins/slack/shared/notify-format.test.ts`, add the import (extend the existing import from `./notify-format.js` to include `formatAnswer`) and a new describe block:

```typescript
import { formatAnswer } from './notify-format.js';

describe('formatAnswer', () => {
  it('returns the trimmed body unchanged when within the cap (prefix is stamped by the poster)', () => {
    expect(formatAnswer('  Finished the refactor. Should I delete the old file?  ')).toBe(
      'Finished the refactor. Should I delete the old file?'
    );
  });

  it('hard-caps an oversized body with a truncation marker', () => {
    const huge = 'x'.repeat(5000);
    const out = formatAnswer(huge);
    expect(out.length).toBeLessThan(huge.length);
    expect(out.endsWith('…(truncated)')).toBe(true);
    expect(out.startsWith('x')).toBe(true);
  });

  it('does not stamp the robot prefix itself', () => {
    expect(formatAnswer('hello')).toBe('hello');
  });
});
```

(If the file imports `formatExitNotification`/`formatBlockedNotification` on a single line, add `formatAnswer` to that existing import instead of a second import statement.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run plugins/slack/shared/notify-format.test.ts -t formatAnswer`
Expected: FAIL — `formatAnswer` is not exported.

- [ ] **Step 3: Add the helper**

In `plugins/slack/shared/notify-format.ts`, append at the end of the file:

```typescript
/**
 * Hard cap on a relayed answer body (~2 KB). A backstop against a runaway
 * summary, not the primary length control (the `turn-summary` prompt is clamped
 * at the source). Past the cap we keep the head and append a marker.
 */
const ANSWER_MAX_CHARS = 2000;
const ANSWER_TRUNCATION_MARKER = '…(truncated)';

/**
 * Format a bot-launched session's turn summary for posting into its Slack
 * thread. Returns the message BODY only — `postBotReply` stamps the durable
 * `:robot_face:` self-filter prefix, so stamping here would double it. Trims
 * and hard-caps the body as a backstop.
 */
export function formatAnswer(text: string): string {
  const body = text.trim();
  if (body.length <= ANSWER_MAX_CHARS) return body;
  return body.slice(0, ANSWER_MAX_CHARS) + ANSWER_TRUNCATION_MARKER;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run plugins/slack/shared/notify-format.test.ts`
Expected: PASS — `formatAnswer` block green, existing formatter tests still green.

- [ ] **Step 5: Commit**

```bash
git add plugins/slack/shared/notify-format.ts plugins/slack/shared/notify-format.test.ts
git commit -m "feat(slack-relay): add formatAnswer helper"
```

---

### Task 6: slack-main `idle` relay + dedup

Extends `BotRuntime` to accept `ctx.summarizeSession`, handle the new `'idle'` event (find the bot thread, summarize, dedup same-turn re-fires by summary-text signature, post via `postBotReply`), and clear the dedup state on `exit`. Extends the `sessionEvent` capability + `handleSessionEvent` event unions to include `'idle'`.

**Files:**
- Modify: `plugins/slack/main/slack-main.ts` (import `formatAnswer`; add `relayedSig` map + `summarizeSession` ctor param to `BotRuntime`; widen `handleSessionEvent` union + add the `'idle'` branch; clear `relayedSig` on exit + in `stop()`; widen the `sessionEvent` cap type; pass `ctx.summarizeSession` to `new BotRuntime`)
- Test: `plugins/slack/main/slack-main.test.ts` (add idle tests in the `Phase 2` describe)

**Interfaces:**
- Consumes: `MainModuleContext.summarizeSession` (Task 1), `formatAnswer` (Task 5), `this.threadStore.findBySession` + `this.pollers.postBotReply` (existing).
- Produces: `handleSessionEvent(event: 'blocked' | 'exit' | 'idle', ...)` and the `sessionEvent('blocked'|'exit'|'idle', ...)` capability — consumed by `SlackBot.tsx` (Task 7).

- [ ] **Step 1: Write the failing tests**

In `plugins/slack/main/slack-main.test.ts`, the `startedBotWithThread` helper builds the ctx without a `summarizeSession`. Add an optional summarizer so idle tests can program the summary. Replace the `startedBotWithThread` function (lines 227–250) so it accepts an injectable summarizer:

```typescript
    /** A started bot with one linked thread (channel C1, parent P1, session S1). */
    async function startedBotWithThread(
      summarizeSession?: MainModuleContext['summarizeSession']
    ) {
      const fetch = vi.fn().mockResolvedValue({ status: 200, ok: true, headers: {}, body: '{"ok":true,"ts":"9.9"}' });
      const ctx: MainModuleContext = {
        storage: {
          get: vi.fn().mockResolvedValue({
            ...DEFAULT_SLACK_CONFIG,
            botToken: 'xoxb-test',
            bot: { ...DEFAULT_SLACK_CONFIG.bot, enabled: true, transport: 'web', channelId: 'C1', authedUserId: 'U1' }
          }),
          set: vi.fn()
        },
        log: vi.fn(),
        fetch,
        summarizeSession
      };
      const caps = await slackMainModule.setup(ctx);
      await caps.startBot();
      await caps.recordLaunchedSession('launch-1', 'S1', 'C1', 'P1');
      // Posts from the bot go to chat.postMessage; isolate those.
      const postMessages = () =>
        fetch.mock.calls
          .filter((c) => String(c[0]).endsWith('/chat.postMessage'))
          .map((c) => JSON.parse(c[1].body));
      return { caps, postMessages };
    }
```

Then add these tests at the end of the `Phase 2: session lifecycle → thread` describe (after the `does not handle events when the bot is stopped` test, before that describe's closing `});`):

```typescript
    it('relays an LLM turn summary into the thread on the first idle edge', async () => {
      const summarize = vi.fn(async () => ({ ok: true, text: 'Finished the refactor. Delete the old file?' }));
      const { caps, postMessages } = await startedBotWithThread(summarize);
      const res = (await caps.sessionEvent('idle', 'S1')) as { handled: boolean };
      expect(res.handled).toBe(true);
      expect(summarize).toHaveBeenCalledWith('S1', { scope: 'lastTurn' });
      const posts = postMessages();
      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({ channel: 'C1', thread_ts: 'P1' });
      expect(posts[0].text).toContain('Finished the refactor. Delete the old file?');
      expect(posts[0].text).toContain(':robot_face:'); // prefix stamped by postBotReply
    });

    it('skips a duplicate same-turn idle (dedup on the summary signature)', async () => {
      const summarize = vi.fn(async () => ({ ok: true, text: 'Same turn summary.' }));
      const { caps, postMessages } = await startedBotWithThread(summarize);
      await caps.sessionEvent('idle', 'S1');
      await caps.sessionEvent('idle', 'S1');
      expect(postMessages()).toHaveLength(1); // identical summary → one post
    });

    it('relays a genuinely new turn (different summary) again', async () => {
      const summarize = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, text: 'First turn.' })
        .mockResolvedValueOnce({ ok: true, text: 'Second, different turn.' });
      const { caps, postMessages } = await startedBotWithThread(summarize);
      await caps.sessionEvent('idle', 'S1');
      await caps.sessionEvent('idle', 'S1');
      expect(postMessages()).toHaveLength(2);
    });

    it('posts nothing when the summarizer returns {ok:false}', async () => {
      const summarize = vi.fn(async () => ({ ok: false }));
      const { caps, postMessages } = await startedBotWithThread(summarize);
      const res = (await caps.sessionEvent('idle', 'S1')) as { handled: boolean };
      expect(res.handled).toBe(true); // a bot session — handled, just nothing to say
      expect(postMessages()).toHaveLength(0);
    });

    it('does not relay idle for a session it did not launch', async () => {
      const summarize = vi.fn(async () => ({ ok: true, text: 'irrelevant' }));
      const { caps, postMessages } = await startedBotWithThread(summarize);
      const res = (await caps.sessionEvent('idle', 'UNKNOWN')) as { handled: boolean };
      expect(res.handled).toBe(false);
      expect(summarize).not.toHaveBeenCalled();
      expect(postMessages()).toHaveLength(0);
    });

    it('clears dedup state on exit so a relaunched/repeated turn relays again', async () => {
      const summarize = vi.fn(async () => ({ ok: true, text: 'Recurring summary.' }));
      const { caps, postMessages } = await startedBotWithThread(summarize);
      await caps.sessionEvent('idle', 'S1');
      expect(postMessages().filter((p) => p.text.includes('Recurring summary.'))).toHaveLength(1);
      await caps.sessionEvent('exit', 'S1', { code: 0 }); // clears relayedSig + thread link
      // Re-link the (same id) thread as if relaunched, then the same summary relays again.
      await caps.recordLaunchedSession('launch-2', 'S1', 'C1', 'P1');
      await caps.sessionEvent('idle', 'S1');
      expect(postMessages().filter((p) => p.text.includes('Recurring summary.'))).toHaveLength(2);
    });

    it('no-ops idle when no summarizer was wired (degrades safely)', async () => {
      const { caps, postMessages } = await startedBotWithThread(); // no summarizeSession
      const res = (await caps.sessionEvent('idle', 'S1')) as { handled: boolean };
      expect(res.handled).toBe(true);
      expect(postMessages()).toHaveLength(0);
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run plugins/slack/main/slack-main.test.ts -t idle`
Expected: FAIL — `handleSessionEvent` rejects the `'idle'` event / `BotRuntime` ignores `summarizeSession`; no relay posts appear.

- [ ] **Step 3: Import `formatAnswer`**

In `plugins/slack/main/slack-main.ts`, add the import near the other shared imports (find the existing import of `../shared/types.js` and add this after it):

```typescript
import { formatAnswer } from '../shared/notify-format.js';
```

- [ ] **Step 4: Add the dedup map + summarizer to `BotRuntime`**

In `plugins/slack/main/slack-main.ts`, add a field next to `pendingApprovals` (after the `pendingApprovals` map declaration, ~line 159):

```typescript
  /**
   * Per-session signature of the LAST turn summary relayed to the thread, so a
   * re-fired idle edge for the SAME turn (the title flickered working↔idle
   * without new work) doesn't double-post. Keyed by session id; cleared on exit
   * next to {@link pendingApprovals}. We dedup on the returned summary text (not
   * the source transcript — slack-main can't read it; see the relay design).
   */
  private readonly relayedSig = new Map<string, string>();
```

Widen the constructor to accept the summarizer (replace the constructor at lines 161–167):

```typescript
  constructor(
    private readonly fetch: NonNullable<MainModuleContext['fetch']>,
    private readonly storage: MainModuleContext['storage'],
    private readonly log: MainModuleContext['log'],
    private readonly summarizeSession?: MainModuleContext['summarizeSession']
  ) {
    this.threadStore = new ThreadStore(storage);
  }
```

In `stop()` (the method at lines 232–236), clear the new map alongside `pendingApprovals`:

```typescript
  stop(): void {
    this.pollers?.stop();
    this.pollers = null;
    this.pendingApprovals.clear();
    this.relayedSig.clear();
  }
```

- [ ] **Step 5: Widen `handleSessionEvent` + add the idle branch**

In `plugins/slack/main/slack-main.ts`, widen the `handleSessionEvent` signature (lines 329–333) to include `'idle'`:

```typescript
  async handleSessionEvent(
    event: 'blocked' | 'exit' | 'idle',
    sessionId: string,
    detail?: { code?: number }
  ): Promise<{ handled: boolean }> {
```

Add the `'idle'` branch immediately after the `if (event === 'blocked') { ... }` block closes (after line 366, before the `// exit` comment at line 368):

```typescript
    if (event === 'idle') {
      // Relay the turn's answer into the thread. No summarizer wired → nothing
      // to say (degrade safely). Every failure below is a silent no-op: the
      // relay is a courtesy, never a source of thread error chatter.
      if (!this.summarizeSession) return { handled: true };
      const r = await this.summarizeSession(sessionId, { scope: 'lastTurn' }).catch(() => undefined);
      if (!r?.ok || !r.text) return { handled: true };
      // Dedup same-turn re-fires by a cheap signature of the summary text.
      const sig = `${r.text.length}:${r.text.slice(-64)}`;
      if (this.relayedSig.get(sessionId) === sig) return { handled: true };
      const posted = await this.pollers
        .postBotReply(row.channel, row.parentTs, formatAnswer(r.text))
        .catch(() => undefined);
      if (posted !== undefined) this.relayedSig.set(sessionId, sig);
      return { handled: true };
    }
```

In the `// exit` block, clear the dedup state next to the existing `pendingApprovals.delete` (replace line 369):

```typescript
    // exit
    this.pendingApprovals.delete(sessionId);
    this.relayedSig.delete(sessionId);
```

- [ ] **Step 6: Widen the `sessionEvent` capability + pass the summarizer**

In `plugins/slack/main/slack-main.ts`, in `setup(ctx)`, pass the summarizer to the runtime (replace line 501):

```typescript
    const bot = new BotRuntime(fetch, storage, log, ctx.summarizeSession);
```

Widen the `sessionEvent` capability's event type (lines 598–604):

```typescript
      sessionEvent(
        event: 'blocked' | 'exit' | 'idle',
        sessionId: string,
        detail?: { code?: number }
      ): Promise<{ handled: boolean }> {
        return bot.handleSessionEvent(event, sessionId, detail);
      }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run plugins/slack/main/slack-main.test.ts`
Expected: PASS — the new idle tests and the existing Phase 2/3 tests are all green.

- [ ] **Step 8: Commit**

```bash
git add plugins/slack/main/slack-main.ts plugins/slack/main/slack-main.test.ts
git commit -m "feat(slack-relay): relay turn summary on idle + same-turn dedup in BotRuntime"
```

---

### Task 7: Forward the `idle` edge from the renderer

`SlackBot.tsx` already forwards `blocked`/`exit` to main via `host.call('sessionEvent', ...)`. Extend its `session:agentStatus` listener to also forward `idle`. Per the design, the relay is in-thread only — there is NO generic-channel notify fallback for idle (unlike `blocked`), so the forward is fire-and-forget.

**Files:**
- Modify: `plugins/slack/renderer/SlackBot.tsx` (widen `handledByBot` event type; branch the `offStatus` listener to forward `idle`)

**Interfaces:**
- Consumes: the `sessionEvent('idle', sessionId)` capability (Task 6).
- Produces: nothing downstream (terminal in the chain).

- [ ] **Step 1: Widen `handledByBot` to accept `idle`**

In `plugins/slack/renderer/SlackBot.tsx`, widen the `handledByBot` event parameter (line 123):

```typescript
    const handledByBot = async (
      event: 'blocked' | 'exit' | 'idle',
      sessionId: string,
      detail?: { code?: number }
    ): Promise<boolean> => {
```

- [ ] **Step 2: Branch the status listener to forward idle**

In `plugins/slack/renderer/SlackBot.tsx`, replace the `offStatus` listener (lines 158–165) so it forwards both `blocked` (with its existing notify fallback) and `idle` (forward only, no fallback):

```typescript
    const offStatus = host.on('session:agentStatus', ({ sessionId, state }) => {
      if (state === 'blocked') {
        void handledByBot('blocked', sessionId).then(async (handled) => {
          if (handled || !(await notifyOn()).sessionBlocked) return;
          const text = formatBlockedNotification(describe(sessionId));
          host.call('notify', text).catch((err) => console.error('Slack notify failed:', err));
        });
        return;
      }
      if (state === 'idle') {
        // Bot-launched sessions relay an in-thread answer summary on each idle
        // edge (main no-ops for non-bot sessions). No generic-channel notify
        // fallback for idle — the relay is in-thread only.
        void handledByBot('idle', sessionId);
      }
    });
```

- [ ] **Step 3: Typecheck the renderer change**

Run: `npm run typecheck`
Expected: PASS. (There is no unit-test harness for `SlackBot.tsx` — it is an effect-only headless component, and the design's test plan covers the relay end-to-end through the `slack-main` fake in Task 6. Verification here is the typecheck plus the Task 6 suite.)

- [ ] **Step 4: Run the full Slack suite (regression)**

Run: `npx vitest run plugins/slack`
Expected: PASS — the 19 `mcp-client` tests, `notify-format`, and `slack-main` suites all green.

- [ ] **Step 5: Commit**

```bash
git add plugins/slack/renderer/SlackBot.tsx
git commit -m "feat(slack-relay): forward idle agentStatus edge to the bot"
```

---

### Task 8: Full-suite regression + typecheck gate

A final whole-project gate before handoff — proves nothing else regressed and the build is clean.

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the whole project**

Run: `npm run typecheck`
Expected: PASS — no type errors across main, renderer, and the SDK package.

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all suites green (specifically: `prompt-registry`, `close-summary`, `registry-ctx-shape`, `notify-format`, `slack-main`, and the 19 `mcp-client` tests).

- [ ] **Step 3: Commit (only if any incidental fixups were needed)**

```bash
git add -A
git commit -m "test(slack-relay): full-suite green for answer-relay"
```

If Steps 1–2 were already green with no changes, skip this commit.

---

## Self-Review

**1. Spec coverage** — every row of the spec's "Components changed" table maps to a task:
- `packages/extension-sdk/src/main.ts` (`summarizeSession?`) → Task 1.
- `src/main/close-summary.ts` (`summarizeTurn` + `runTurnSummary`) → Task 3.
- `src/main/prompt-registry.ts` (`builtin:turn-summary`) → Task 2.
- `src/main/index.ts` (wire `runTurnSummary` + `ctx.summarizeSession`) → Task 4.
- `plugins/slack/main/slack-main.ts` (idle case + dedup map + ctor) → Task 6.
- `plugins/slack/renderer/SlackBot.tsx` (forward idle) → Task 7.
- `plugins/slack/shared/notify-format.ts` (`formatAnswer`) → Task 5.

Spec "Testing (TDD)" coverage: `formatAnswer` passthrough + truncation → Task 5; `summarizeTurn` success/empty/failed/foreign → Task 3; `handleSessionEvent('idle')` relay/dedup/non-bot/ok:false/exit-clears → Task 6; regression (19 mcp-client + full Slack suite + typecheck) → Tasks 7 & 8. The dedup-on-source-lastTurn from the design's pseudocode is reconciled in Global Constraints + Task 6 to dedup on the returned summary text (the locked `{ ok, text }` interface carries no source transcript and slack-main cannot read one).

**2. Placeholder scan** — no `TBD`/`TODO`/"add error handling" placeholders; every code step shows complete code. Error handling is concrete (the silent-no-op `.catch(() => undefined)` paths and `{ ok: false }` returns are spelled out).

**3. Type consistency** — `summarizeSession(sessionId, opts?: { scope?: 'lastTurn' }) → Promise<{ ok: boolean; text?: string }>` is identical across the SDK type (Task 1), `ModuleHostDeps` (Task 1), the `index.ts` impl (Task 4), and the `BotRuntime` ctor param (Task 6). `summarizeTurn(projectId, sessionId) → Promise<{ ok: boolean; text?: string }>` matches between Task 3 (definition) and Task 4 (call). `runTurnSummary(lastTurn, dedupeKey) → Promise<LlmRunResult>` matches between Task 3 (dep) and Task 4 (impl). `handleSessionEvent`/`sessionEvent` event unions are widened to the same `'blocked' | 'exit' | 'idle'` in Task 6, consumed with the same literal in Task 7. `formatAnswer(text: string): string` matches between Task 5 (definition) and Task 6 (call).
