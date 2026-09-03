import { app, shell } from 'electron';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  watch,
  type FSWatcher
} from 'node:fs';
import { join } from 'node:path';
import type { Project, Persona, CreateTerminalRequest, PersonaHarnessIntentV1, PersonaHarnessRoutingV1, HarnessFamily } from '@zana-ai/zcc-domain/product';
import { VALID_PROFILES, seedPromptArgs, harnessFamilyOf } from '@zana-ai/zcc-domain/launch-provider';
import type { PersonaTeamRegistry } from '../../../../desktop/src/extensions/persona-team-registry.js';
import { atomicDurableWrite } from '../harness-routing/storage.js';
import { uniqueCopyName } from '../projects/unique-copy-name.js';

import { electronZccDataDir } from '../../electron-data-dir.js';

const userPersonasDir = () => join(electronZccDataDir(), 'personas');
const projectPersonasDir = (project: Project) =>
  join(project.path, '.zcc', 'personas');

/**
 * Canonicalize a personas dir for identity comparison, resolving symlinks and
 * `.`/`..`. Falls back to the raw path when the dir doesn't exist yet (nothing
 * to realpath). Used to detect a project whose `.zcc/personas` is the SAME
 * folder as the user dir — e.g. a project registered at HOME (`~`) or any
 * ancestor of `~/.zcc`. Without this, `refresh()` would scan that one folder
 * twice and the project pass (which runs last) would re-stamp every global
 * `user` persona as `{ projectId }`, hiding them from every other project's
 * launcher (the launcher filters project-scoped personas to their own project).
 */
function canonicalDir(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

const VALID_MODES: Array<NonNullable<Persona['permissionMode']>> = [
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions'
];

/** Filesystem-safe filename for a persona id (mirrors prompt-registry). */
function fileNameForId(id: string): string {
  return `${id.replace(/[^a-zA-Z0-9._-]+/g, '_')}.json`;
}

function writeJsonAtomic(file: string, value: unknown) {
  atomicDurableWrite(file, Buffer.from(JSON.stringify(value, null, 2)));
}

/**
 * Validate + normalize a raw object into a {@link Persona}, or null if it's
 * missing required fields / carries an invalid enum. Shared by the disk loader
 * ({@link readPersonaFile}) and the UI write path ({@link PersonaStore.saveUser})
 * so a hand-edited file and a form-authored persona pass through the SAME gate.
 * Never returns the `source` field (the loader stamps that).
 */
export function sanitizeHarnessRouting(routing: unknown): PersonaHarnessRoutingV1 | null {
  if (!routing || typeof routing !== 'object') return null;
  const r = routing as any;
  if (r.schemaVersion !== 1) return null;
  if (!r.byAdapter || typeof r.byAdapter !== 'object') return null;
  
  const byAdapter: Partial<Record<HarnessFamily, PersonaHarnessIntentV1>> = {};
  const validFamilies: HarnessFamily[] = ['claude', 'cursor', 'codex', 'pi', 'opencode'];
  
  for (const [key, value] of Object.entries(r.byAdapter)) {
    if (!validFamilies.includes(key as HarnessFamily)) return null;
    if (!value || typeof value !== 'object') return null;
    const v = value as any;
    
    const intent: PersonaHarnessIntentV1 = {};
    if (v.roleTargetId !== undefined) {
      if (typeof v.roleTargetId !== 'string') return null;
      intent.roleTargetId = v.roleTargetId;
    }
    if (v.providerTargetId !== undefined) {
      if (typeof v.providerTargetId !== 'string') return null;
      intent.providerTargetId = v.providerTargetId;
    }
    if (v.modelTargetId !== undefined) {
      if (typeof v.modelTargetId !== 'string') return null;
      intent.modelTargetId = v.modelTargetId;
    }
    if (v.executionTargetId !== undefined) {
      if (typeof v.executionTargetId !== 'string') return null;
      intent.executionTargetId = v.executionTargetId;
    }
    if (v.executionState !== undefined) {
      if (!['plan', 'interactive', 'accept-edits', 'autonomous'].includes(v.executionState)) return null;
      intent.executionState = v.executionState;
    }
    
    if (v.compatibility !== undefined) {
      if (!v.compatibility || typeof v.compatibility !== 'object') return null;
      const c = v.compatibility;
      const compat: PersonaHarnessIntentV1['compatibility'] = {};
      if (c.model !== undefined) {
        if (typeof c.model !== 'string') return null;
        compat.model = c.model;
      }
      if (c.permissionMode !== undefined) {
        if (typeof c.permissionMode !== 'string') return null;
        compat.permissionMode = c.permissionMode;
      }
      if (c.codexSandbox !== undefined) {
        if (typeof c.codexSandbox !== 'string') return null;
        compat.codexSandbox = c.codexSandbox;
      }
      if (c.codexApproval !== undefined) {
        if (typeof c.codexApproval !== 'string') return null;
        compat.codexApproval = c.codexApproval;
      }
      intent.compatibility = compat;
    }
    
    byAdapter[key as HarnessFamily] = intent;
  }
  
  return {
    schemaVersion: 1,
    byAdapter
  };
}

export function sanitizePersona(raw: unknown): Persona | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Persona>;
  if (typeof r.id !== 'string' || !r.id.trim()) return null;
  if (typeof r.name !== 'string' || !r.name.trim()) return null;
  if (r.baseProfile && !VALID_PROFILES.includes(r.baseProfile)) return null;
  // model is a provider-dialect string (claude aliases vs a codex model id), so
  // it's validated for TYPE only — the per-profile allowed set lives in the
  // renderer's `providerUiSchema` picker, not this shared gate.
  if (r.model !== undefined && typeof r.model !== 'string') return null;
  if (r.permissionMode && !VALID_MODES.includes(r.permissionMode)) return null;
  if (r.codexSandbox && !['read-only', 'workspace-write', 'danger-full-access'].includes(r.codexSandbox)) return null;
  if (r.codexApproval && !['untrusted', 'on-request', 'never'].includes(r.codexApproval)) return null;

  if (r.modelLevel !== undefined) {
    if (typeof r.modelLevel !== 'string' || !['low', 'medium', 'high', 'extra-high'].includes(r.modelLevel)) {
      return null;
    }
  }
  if (r.executionState !== undefined) {
    if (typeof r.executionState !== 'string' || !['plan', 'interactive', 'accept-edits', 'autonomous'].includes(r.executionState)) {
      return null;
    }
  }
  let harnessRouting: PersonaHarnessRoutingV1 | undefined = undefined;
  if (r.harnessRouting !== undefined) {
    const sanitized = sanitizeHarnessRouting(r.harnessRouting);
    if (!sanitized) return null;
    harnessRouting = sanitized;
  }

  const strArray = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : undefined;

  return {
    id: r.id.trim(),
    name: r.name.trim(),
    icon: typeof r.icon === 'string' ? r.icon : undefined,
    description: typeof r.description === 'string' ? r.description : undefined,
    baseProfile: r.baseProfile,
    model: r.model,
    permissionMode: r.permissionMode,
    codexSandbox: r.codexSandbox,
    codexApproval: r.codexApproval,
    modelLevel: r.modelLevel,
    executionState: r.executionState,
    harnessRouting,
    appendSystemPrompt:
      typeof r.appendSystemPrompt === 'string' ? r.appendSystemPrompt : undefined,
    allowedTools: strArray(r.allowedTools),
    deniedTools: strArray(r.deniedTools),
    addDirs: strArray(r.addDirs),
    mcpServers: strArray(r.mcpServers),
    initialPrompt: typeof r.initialPrompt === 'string' ? r.initialPrompt : undefined,
    // Advisory microVM image hint; re-authorized against the closed allowlist in
    // the microVM builder at spawn (Rule 1). Persisted verbatim if a string.
    microVmImage: typeof r.microVmImage === 'string' ? r.microVmImage : undefined
  };
}

/**
 * Resolve the persona + opening-prompt wiring for a spawn request — the single
 * reusable seam every launch path (the IPC handler, the `zcc` control plane,
 * and any future MCP spawn tool) shares so persona resolution and the
 * prompt-as-argv convention live in exactly one place.
 *
 * Pure: it takes the already-loaded persona list (no store/electron coupling)
 * so it's trivially unit-testable. It returns ONLY what the caller can't derive
 * itself:
 *   - `persona`: the resolved {@link Persona} (or undefined for a bare profile),
 *     passed straight to `ptys.create({ persona })`.
 *   - `extraArgs`: the caller's `extraArgs` with the opening `prompt` appended
 *     as the LAST positional element — but only for a profile whose CLI accepts
 *     a positional seed prompt (`acceptsPromptArgv`): the claude, cursor, and
 *     codex families all read `[prompt]` as the first turn. For `shell` the
 *     prompt is dropped (it would run as a shell command).
 *
 * Note the `effectiveProfile` (persona.baseProfile ?? req.profile) is computed
 * locally ONLY to decide whether the prompt is a positional argv. It is NOT
 * returned: the pty layer re-derives the same effective profile from the
 * persona itself (see pty.ts `create`), so the caller must keep passing the
 * ORIGINAL `req.profile` to `ptys.create` — substituting effectiveProfile there
 * would double-apply the persona's baseProfile.
 */
export function resolvePersonaLaunch(
  req: Pick<CreateTerminalRequest, 'personaId' | 'profile' | 'prompt' | 'extraArgs'>,
  personas: Persona[]
): { persona: Persona | undefined; extraArgs: string[] | undefined } {
  const persona = req.personaId ? personas.find((p) => p.id === req.personaId) : undefined;
  const effectiveProfile = persona?.baseProfile ?? req.profile;
  // Delegate the per-harness delivery to the shared helper: a positional
  // `[prompt]` for claude/cursor/codex/pi, `--prompt <text>` for OpenCode (whose
  // positional is a project DIR), nothing for shell. The prompt fragment must be
  // LAST so a positional seed prompt stays the trailing argv element.
  const seed = req.prompt ? seedPromptArgs(effectiveProfile, req.prompt) : [];
  const extraArgs = seed.length ? [...(req.extraArgs ?? []), ...seed] : req.extraArgs;
  return { persona, extraArgs };
}

/**
 * The code-mutating / command-executing tools the orchestrator persona must
 * never be able to invoke (council ticket C1 — "structural no-code/no-exec
 * enforcement"). Passed to the claude CLI as `--disallowedTools`, which takes
 * precedence over `--allowedTools`, so listing a tool here makes it
 * mechanically unreachable for the session regardless of what the allowlist or
 * a future persona edit admits. The orchestrator delegates all such work to
 * other agents. Exported so the persona guard test and the C2 authZ layer
 * assert against ONE source of truth.
 *
 * NOTE: do NOT re-add `MultiEdit` — the current claude CLI folded it into
 * `Edit` (it's no longer a registered tool), so denying it makes the CLI print
 * `Permission deny rule "MultiEdit" matches no known tool — check for typos.`
 * on every launch. Denying `Edit` already covers the multi-edit surface, so the
 * no-code guarantee is unchanged.
 */
export const ORCHESTRATOR_DENIED_TOOLS: readonly string[] = [
  'Write',
  'Edit',
  'NotebookEdit',
  'Bash'
];

/**
 * Built-in catalogue. Stable IDs are prefixed with `builtin:` so a user can
 * disable / shadow them by dropping a file with the same id stem in their
 * own personas dir.
 */
const BUILTIN: Persona[] = [
  {
    id: 'builtin:reviewer',
    name: 'Code Reviewer',
    icon: 'ShieldCheck',
    description:
      'Senior code reviewer focused on correctness, edge cases, and clarity. Reviews diffs with a critical eye for bugs and maintainability.',
    modelLevel: 'high',
    executionState: 'plan',
    allowedTools: ['Read', 'Grep', 'Glob'],
    appendSystemPrompt: [
      'You are a senior code reviewer. Your reviews prioritize correctness and clarity over cleverness.',
      'When reviewing code:',
      '- Look for logical errors, edge cases, and race conditions',
      '- Flag over-engineering and unnecessary complexity',
      '- Suggest simpler alternatives when they exist',
      '- Point out unclear variable names and missing documentation',
      '- Keep feedback terse and actionable — cite line numbers',
      '',
      'Skip style nits unless they harm readability. Assume the author is competent;',
      'frame findings as questions when unsure. Your goal is to catch bugs before they ship.'
    ].join('\n'),
    initialPrompt: 'Review the current diff for correctness and clarity.'
  },
  {
    id: 'builtin:architect',
    name: 'Architect',
    icon: 'Compass',
    description:
      'Systems design planner. Analyzes requirements, proposes architectures, and identifies trade-offs without writing implementation code.',
    executionState: 'plan',
    appendSystemPrompt: [
      'You are a systems architect. You design solutions, not implementations.',
      'When given a problem:',
      '- Clarify requirements and constraints before proposing solutions',
      '- Sketch 2-3 architectural approaches with trade-offs for each',
      '- Consider scalability, maintainability, and operational complexity',
      '- Identify critical decision points and recommend testing strategies',
      '- Call out risks and dependencies the team should address',
      '',
      'Your output is a design doc, not working code. Keep proposals concrete but',
      'high-level — file structure, module boundaries, data flow. Avoid bikeshedding',
      'implementation details. When trade-offs are unclear, present options and let',
      'the team decide.'
    ].join('\n'),
    initialPrompt:
      'I need an architecture proposal for [describe the feature]. Walk me through 2-3 approaches with trade-offs.'
  },
  {
    id: 'builtin:software-engineer',
    name: 'Software Engineer',
    icon: 'Code2',
    description:
      'Generalist engineer who delivers features end to end — schema, API, and UI — matching the project’s existing conventions and covering the real failure modes.',
    modelLevel: 'medium',
    appendSystemPrompt: [
      'You are a software engineer. You ship working features end to end, across every layer they touch.',
      'When delivering a change:',
      '- Work in vertical slices: a thin path through data, API, and UI that actually works',
      '- Match the existing patterns, conventions, and layering rather than imposing a new style',
      '- Validate input at the boundary and keep contracts consistent across layers',
      '- Cover the real states and failure modes: loading, empty, error, timeouts, retries, malformed data',
      '- Bias toward the smallest change that completes the slice; avoid needless complexity',
      '',
      'Verify the whole path in the running app or tests — never claim a result you did not observe.'
    ].join('\n'),
    initialPrompt:
      'I want to build [describe the feature]. Help me plan and implement it across the layers it touches.'
  },
  {
    id: 'builtin:orchestrator',
    name: 'ZCC Agent',
    icon: 'Network',
    description:
      'Executive coordinator. Plans, decomposes work, delegates to worker agents, and monitors progress — never writes code or runs shell commands itself.',
    baseProfile: 'claude',
    model: 'opus',
    // NOT plan mode. This persona runs headless (`claude --print`), where plan
    // mode wedges the agent: it refuses to act until it calls ExitPlanMode, but
    // that tool isn't in the allowlist and there's no interactive plan-approval
    // surface — so the run dead-ends on "I'm blocked by plan mode." The no-code
    // guarantee comes from `deniedTools` (C1) and the mutating-action gate comes
    // from the PreToolUse confirm hook (C2), so plan mode adds no safety here.
    permissionMode: 'default',
    // Structural "never writes code" guarantee (council ticket C1): the
    // orchestrator delegates implementation to OTHER agents; the terminal
    // session itself must be mechanically unable to mutate files or run shell commands.
    // allowedTools is a delegation + read-only surface (inspect state, then
    // delegate via the zana_*/zcc MCP servers); deniedTools hard-blocks the
    // code-writing tools even if the allowlist or a future edit would admit
    // them (claude CLI: --disallowedTools wins over --allowedTools). Keep these
    // two lists in sync with ORCHESTRATOR_DENIED_TOOLS below — the persona
    // guard test asserts the no-code tools are unreachable.
    allowedTools: [
      // read-only inspection so the orchestrator can reason before delegating
      'Read',
      'Grep',
      'Glob',
      'AskUserQuestion',
      'TodoWrite',
      // delegation + status surface (whole MCP servers, not individual tools,
      // so new zana_*/zcc tools are covered without editing this list)
      'mcp__zana',
      'mcp__zcc-inbox'
    ],
    deniedTools: [...ORCHESTRATOR_DENIED_TOOLS],
    appendSystemPrompt: [
      'You are an orchestrator. You coordinate work; you NEVER write the implementation yourself.',
      'You have no ability to edit files or run shell commands — those tools are disabled for you by design.',
      'When given a goal:',
      '- Clarify the objective and constraints, then break it into concrete, ordered tasks',
      '- Delegate every implementation task to a specialized worker agent or team (spawn an agent, start a team, route a task, or file a ticket) — do not attempt the work yourself',
      '- Normal spawn/route delegation within the current project is automatically authorized for a bounded fan-out. Team launches, cross-project work, lifecycle stops, and workspace mutations still require the user.',
      '- Before spawning, call zana_list_profiles and pass the selected profileId plus prompt to zana_spawn_agent. Never invent or omit profileId.',
      '- Track progress across tasks, surface blockers early, and keep dependencies explicit',
      '- If you need a user decision, ask via AskUserQuestion with concise options; their answer will be delivered as your next message',
      '- Synthesize the results from each task into a coherent whole',
      '- When structured operational data improves clarity, emit JSON in a ```zcc-artifact fence. Supported kinds only: table, metric, timeline, fileComment, artifactFile. Every value must come from real tool or worker output; never invent rows, metrics, file contents, paths, or statuses. Artifacts are display-only, never actions.',
      '',
      'Keep your own role thin: plan, delegate, monitor, and integrate. All code and commands are written by the workers you delegate to.'
    ].join('\n'),
    initialPrompt:
      'Here is the goal: [describe it]. Break it into tasks and propose how to delegate them.'
  },
  {
    id: 'builtin:ext-creator',
    name: 'Extension Creator',
    icon: 'Puzzle',
    description:
      'Builds a local Zana extension with you — edits the scaffolded source in your working dir, then you reload it into the app. Confined to the one extension it is building.',
    // A working editor, NOT claude-yolo: acceptEdits lets it write/edit files in
    // its cwd without a prompt-per-write, but it still can't skip permissions
    // wholesale. Its reach is bounded by the terminal's cwd (the extension's
    // working dir under the scratch workspace) — it never sees HOME, a real
    // project, or any ~/.zcc path, and it NEVER writes the installed extension
    // dir (main packs + installs; the agent only edits source).
    baseProfile: 'claude',
    permissionMode: 'acceptEdits',
    allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
    appendSystemPrompt: [
      'You are the Plugin Creator. You help the user build a LOCAL Zana plugin by editing source files in the current working directory.',
      'A starter template has already been scaffolded here (package.json zcc + server.ts/app.tsx). Read them first.',
      '',
      'The full authoring contract — definePluginApp, ZccPluginApi, and the build/reload loop — is in the `extension-creator` skill. Follow it.',
      '',
      'Rules of this workspace:',
      '- Work ONLY inside this directory. It is the plugin\'s source. Do not touch files outside it.',
      '- When you want the user to try what you just built, call the `install_local_extension` tool — it path-installs and reloads through PluginService (same effect as them clicking "Reload from source" in the Plugins hub). The first call will prompt the user to approve it.',
      '- Plugins are full-trust in-process on the server after install. Do not request host-daemon tokens.',
      '- Keep the app bundle using the host-injected React (never bundle your own React).',
      '',
      'Ask the user what the plugin should do, then implement it incrementally, explaining each change.'
    ].join('\n'),
    initialPrompt:
      'Let\'s build your plugin. I\'ve got a starter template scaffolded here — tell me what you want this plugin to do and I\'ll build it with you.'
  }
];

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** README dropped into the user dir on first run so people know what goes there. */
function ensureReadme(dir: string) {
  const readme = join(dir, 'README.md');
  if (existsSync(readme)) return;
  const sample = join(dir, 'example.json.disabled');
  try {
    writeFileSync(
      readme,
      [
        '# Personas',
        '',
        'Drop one JSON file per persona in this directory. Each file becomes a',
        'reusable personality in the New Tab picker and Scheduler. Personas are',
        'named `claude` CLI flag bundles — they compose your existing launch',
        'profiles with model/permission/prompt overrides.',
        '',
        'You can also create and edit personas from the app\'s **Personas** panel',
        '(a form with the same fields) — both write to this directory.',
        '',
        '## Schema',
        '',
        '```json',
        '{',
        '  "id": "my-persona",',
        '  "name": "My Persona",',
        '  "icon": "Sparkles",',
        '  "description": "What it does (optional)",',
        '  "baseProfile": "claude",',
        '  "model": "opus",',
        '  "permissionMode": "plan",',
        '  "appendSystemPrompt": "Custom instructions here.",',
        '  "allowedTools": ["Read", "Grep"],',
        '  "deniedTools": ["Write"],',
        '  "addDirs": ["../sibling-repo"],',
        '  "initialPrompt": "Opening question for the agent."',
        '}',
        '```',
        '',
        '`baseProfile` must be one of `shell`, `claude`, `claude-resume`, `claude-yolo`.',
        '`model` can be `opus`, `sonnet`, `haiku`, or `default` (let Claude decide).',
        '`permissionMode` can be `default`, `acceptEdits`, `plan`, or `bypassPermissions`.',
        'Files with invalid JSON or missing required fields are silently skipped.',
        'A built-in persona is shadowed when you drop a file with the same `id` here.',
        ''
      ].join('\n')
    );
    if (!existsSync(sample)) {
      const example = BUILTIN[0];
      writeFileSync(
        sample,
        JSON.stringify(
          {
            id: 'my-reviewer',
            name: example.name,
            icon: example.icon,
            description: example.description,
            baseProfile: example.baseProfile,
            model: example.model,
            permissionMode: example.permissionMode,
            appendSystemPrompt: 'Custom review instructions here.',
            initialPrompt: example.initialPrompt
          },
          null,
          2
        )
      );
    }
  } catch {
    // Best-effort scaffolding — never fail boot if the home dir is RO.
  }
}

export function migratePersonaIfNeeded(raw: unknown): any {
  if (!raw || typeof raw !== 'object') return raw;

  const r = raw as any;
  const hasLegacyPermission = r.permissionMode !== undefined;
  const hasLegacyModel = r.model !== undefined;
  const hasLegacySandbox = r.codexSandbox !== undefined;
  const hasLegacyApproval = r.codexApproval !== undefined;

  if (!hasLegacyPermission && !hasLegacyModel && !hasLegacySandbox && !hasLegacyApproval) {
    return raw;
  }

  const p = { ...r };

  const routing: PersonaHarnessRoutingV1 = p.harnessRouting
    ? JSON.parse(JSON.stringify(p.harnessRouting))
    : { schemaVersion: 1, byAdapter: {} };

  if (hasLegacyPermission) {
    if (!routing.byAdapter.claude) {
      routing.byAdapter.claude = {};
    }
    routing.byAdapter.claude.compatibility ??= {};
    routing.byAdapter.claude.compatibility.permissionMode ??= p.permissionMode;
    delete p.permissionMode;
  }

  if (hasLegacyModel) {
    const baseProfile = p.baseProfile;
    const pinnedFamily = baseProfile ? harnessFamilyOf(baseProfile) : null;
    if (pinnedFamily) {
      if (!routing.byAdapter[pinnedFamily]) {
        routing.byAdapter[pinnedFamily] = {};
      }
      routing.byAdapter[pinnedFamily]!.compatibility ??= {};
      routing.byAdapter[pinnedFamily]!.compatibility!.model ??= p.model;
    } else {
      if (!routing.byAdapter.claude) {
        routing.byAdapter.claude = {};
      }
      routing.byAdapter.claude.compatibility ??= {};
      routing.byAdapter.claude.compatibility.model ??= p.model;

      if (!routing.byAdapter.codex) {
        routing.byAdapter.codex = {};
      }
      routing.byAdapter.codex.compatibility ??= {};
      routing.byAdapter.codex.compatibility.model ??= p.model;
    }
    delete p.model;
  }

  if (hasLegacySandbox || hasLegacyApproval) {
    if (!routing.byAdapter.codex) {
      routing.byAdapter.codex = {};
    }
    if (!routing.byAdapter.codex.compatibility) {
      routing.byAdapter.codex.compatibility = {};
    }
    if (hasLegacySandbox) {
      routing.byAdapter.codex.compatibility.codexSandbox = p.codexSandbox;
      delete p.codexSandbox;
    }
    if (hasLegacyApproval) {
      routing.byAdapter.codex.compatibility.codexApproval = p.codexApproval;
      delete p.codexApproval;
    }
  }

  p.harnessRouting = routing;
  return p;
}

export function projectPersonaFields(p: Persona): Persona {
  if (!p.harnessRouting?.byAdapter) return p;

  const res = { ...p };
  const pinnedFamily = p.baseProfile ? harnessFamilyOf(p.baseProfile) : null;
  const pinned = pinnedFamily ? p.harnessRouting.byAdapter[pinnedFamily] : undefined;
  const claude = p.harnessRouting.byAdapter.claude;
  const codex = p.harnessRouting.byAdapter.codex;

  if (pinned && res.model === undefined) {
    res.model = pinned.modelTargetId ?? pinned.compatibility?.model;
  }

  if (claude) {
    if (claude.executionTargetId && res.permissionMode === undefined) {
      res.permissionMode = claude.executionTargetId as any;
    }
    if (claude.modelTargetId && res.model === undefined) {
      res.model = claude.modelTargetId;
    }
    if (claude.compatibility?.permissionMode && res.permissionMode === undefined) {
      res.permissionMode = claude.compatibility.permissionMode as Persona['permissionMode'];
    }
    if (claude.compatibility?.model && res.model === undefined) {
      res.model = claude.compatibility.model;
    }
  }

  if (codex) {
    if (codex.modelTargetId && res.model === undefined) {
      res.model = codex.modelTargetId;
    }
    if (codex.compatibility) {
      if (codex.compatibility.model && res.model === undefined) {
        res.model = codex.compatibility.model;
      }
      if (codex.compatibility.codexSandbox && res.codexSandbox === undefined) {
        res.codexSandbox = codex.compatibility.codexSandbox as any;
      }
      if (codex.compatibility.codexApproval && res.codexApproval === undefined) {
        res.codexApproval = codex.compatibility.codexApproval as any;
      }
    }
  }

  return res;
}

function readPersonaFile(path: string): Persona | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const sanitized = sanitizePersona(raw);
    if (!sanitized) return null;
    const migrated = migratePersonaIfNeeded(sanitized);
    return projectPersonaFields(migrated);
  } catch {
    return null;
  }
}

function listInDir(dir: string, source: Persona['source']): Persona[] {
  if (!existsSync(dir)) return [];
  const out: Persona[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const p = readPersonaFile(join(dir, name));
    if (p) {
      p.source = source;
      out.push(p);
    }
  }
  return out;
}

/**
 * Holds the union of built-ins + user dir + per-project dirs, with simple
 * fs.watch-based invalidation so dropping a file in the user dir lights up
 * the picker without an app restart.
 *
 * Resolution order: project > user > builtin. A user persona with the
 * same id as a builtin shadows the builtin.
 */
export class PersonaStore extends EventEmitter {
  private cache: Persona[] = [];
  private projectsRef: () => Project[];
  private registry?: PersonaTeamRegistry;
  private registryUnsub: (() => void) | null = null;
  private userWatcher: FSWatcher | null = null;
  private projectWatchers: Map<string, FSWatcher> = new Map();
  private debounce: NodeJS.Timeout | null = null;

  constructor(projectsRef: () => Project[], registry?: PersonaTeamRegistry) {
    super();
    this.projectsRef = projectsRef;
    this.registry = registry;
  }

  start() {
    const dir = userPersonasDir();
    ensureDir(dir);
    ensureReadme(dir);
    this.refresh();
    this.attachUserWatcher();
    this.attachProjectWatchers();
    // Re-merge whenever an extension (de)registers personas (Rule 3: subscribe
    // once, in start). This re-emits the existing `changed` → onChanged
    // broadcast, so no new IPC channel is needed for extension personas.
    if (this.registry && !this.registryUnsub) {
      this.registryUnsub = this.registry.onChanged(() => this.refresh());
    }
  }

  stop() {
    if (this.userWatcher) {
      this.userWatcher.close();
      this.userWatcher = null;
    }
    for (const w of this.projectWatchers.values()) w.close();
    this.projectWatchers.clear();
    if (this.debounce) {
      clearTimeout(this.debounce);
      this.debounce = null;
    }
    // Rule 3: release the registry subscription on stop.
    if (this.registryUnsub) {
      this.registryUnsub();
      this.registryUnsub = null;
    }
  }

  list(): Persona[] {
    return this.cache;
  }

  /**
   * Subscribe to changes. Returns an unsubscribe function.
   */
  onChanged(cb: () => void): () => void {
    this.on('changed', cb);
    return () => this.off('changed', cb);
  }

  /** Re-discover all sources. Cheap; called on watch events and on project changes. */
  refresh() {
    const merged = new Map<string, Persona>();
    // Extension personas first: their ids are `ext:*`, so they can never
    // collide with `builtin:`/user/project ids. Inserting them before builtins
    // is defensive — a same-id file later would still win the precedence merge.
    if (this.registry) {
      for (const p of this.registry.allPersonas()) merged.set(p.id, p);
    }
    for (const p of BUILTIN) merged.set(p.id, { ...p, source: 'builtin' });
    const userDir = userPersonasDir();
    for (const p of listInDir(userDir, 'user')) merged.set(p.id, p);
    // Canonical user dir, so a project whose `.zcc/personas` resolves to the
    // SAME folder (a project registered at HOME or any ancestor of `~/.zcc`) is
    // recognized and skipped — otherwise its pass, which runs last, would
    // re-stamp every global `user` persona as project-scoped and hide them from
    // all other projects' launchers.
    const canonicalUserDir = canonicalDir(userDir);
    for (const project of this.projectsRef()) {
      const projectDir = projectPersonasDir(project);
      if (canonicalDir(projectDir) === canonicalUserDir) continue;
      const projectSource: Persona['source'] = {
        projectId: project.id,
        projectName: project.name
      };
      for (const p of listInDir(projectDir, projectSource)) {
        merged.set(p.id, p);
      }
    }
    this.cache = [...merged.values()];
    this.emit('changed');
  }

  /** Hook for `store.addProject` / `store.removeProject`. */
  rebindProjects() {
    for (const w of this.projectWatchers.values()) w.close();
    this.projectWatchers.clear();
    this.attachProjectWatchers();
    this.refresh();
  }

  /** Path of the user personas dir (for "Open in Finder"). */
  userDir(): string {
    return userPersonasDir();
  }

  /** The ids of the shipped built-in personas (so the UI can mark "reset"). */
  builtinIds(): string[] {
    return BUILTIN.map((p) => p.id);
  }

  /**
   * Persist a persona to the user dir (`~/.zcc/personas/<id>.json`). The single
   * write path behind the editor UI — it runs the SAME {@link sanitizePersona}
   * gate as the disk loader, then writes atomically (tmp + rename). A user file
   * whose id matches a built-in shadows it (resolution order project > user >
   * builtin). For a brand-new persona pass no id (or a blank one) and a unique
   * slug is derived from the name; an explicit id is kept verbatim so editing an
   * existing persona overwrites its own file.
   *
   * We `refresh()` synchronously so the caller sees the change immediately even
   * though the fs watcher will also fire (the refresh is idempotent).
   */
  saveUser(input: Partial<Persona> & { name: string }): Persona {
    const dir = userPersonasDir();
    ensureDir(dir);

    const hasId = typeof input.id === 'string' && input.id.trim().length > 0;
    const id = hasId ? input.id!.trim() : this.deriveId(input.name);

    const sanitized = sanitizePersona({ ...input, id });
    if (!sanitized) throw new Error('invalid persona: missing name or invalid field');

    const migrated = migratePersonaIfNeeded(sanitized);

    const toDisk = { ...migrated };
    delete toDisk.model;
    delete toDisk.permissionMode;
    delete toDisk.codexSandbox;
    delete toDisk.codexApproval;

    writeJsonAtomic(join(dir, fileNameForId(toDisk.id)), toDisk);
    this.refresh();
    const projected = projectPersonaFields(migrated);
    return { ...projected, source: 'user' };
  }

  /** Copy a currently resolved persona into the user-owned store. */
  duplicateUser(id: string): Persona {
    const source = this.cache.find((persona) => persona.id === id);
    if (!source) throw new Error(`persona not found: ${id}`);
    const { id: _id, source: _source, name, ...configuration } = structuredClone(source);
    return this.saveUser({
      ...configuration,
      name: uniqueCopyName(name, this.cache.map((persona) => persona.name))
    });
  }

  /**
   * Delete the user file for an id. For a shadowed built-in this "resets" it to
   * the shipped default (the builtin re-emerges on refresh); for a purely-user
   * persona it removes it. Returns false if there was no user file to remove.
   */
  deleteUser(id: string): boolean {
    const file = join(userPersonasDir(), fileNameForId(id));
    let removed = false;
    try {
      if (existsSync(file)) {
        rmSync(file);
        removed = true;
      }
    } catch {
      /* best-effort */
    }
    this.refresh();
    return removed;
  }

  /** Derive a filesystem/url-safe id that doesn't collide with an existing one. */
  private deriveId(name: string): string {
    const base =
      name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'persona';
    const taken = new Set(this.cache.map((p) => p.id));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n += 1;
    return `${base}-${n}`;
  }

  async revealDir(): Promise<{ ok: boolean; path: string; message?: string }> {
    const path = userPersonasDir();
    try {
      ensureDir(path);
      ensureReadme(path);
      await shell.openPath(path);
      return { ok: true, path };
    } catch (err) {
      return {
        ok: false,
        path,
        message: err instanceof Error ? err.message : String(err)
      };
    }
  }

  // ----- internals -----------------------------------------------------------

  private attachUserWatcher() {
    const dir = userPersonasDir();
    try {
      const w = watch(dir, { persistent: false }, () => this.scheduleRefresh());
      // fs.watch errors propagate to 'uncaughtException' on Linux/macOS when
      // the watched dir vanishes (e.g. user `rm -rf`'d it). Catch them here,
      // close the dead watcher, and re-attach with backoff so live updates
      // resume once the dir reappears.
      w.on('error', (err) => {
        // eslint-disable-next-line no-console
        console.error('[persona-store] user watcher error:', err);
        try {
          w.close();
        } catch {
          /* already closed */
        }
        if (this.userWatcher === w) this.userWatcher = null;
        setTimeout(() => {
          if (!this.userWatcher) {
            ensureDir(userPersonasDir());
            this.attachUserWatcher();
            this.scheduleRefresh();
          }
        }, 2_000);
      });
      this.userWatcher = w;
    } catch {
      // watcher unsupported on this fs (e.g. some network mounts) — fall back to
      // refresh-on-demand. The user can still hit "Refresh" from the UI.
    }
  }

  private attachProjectWatchers() {
    const canonicalUserDir = canonicalDir(userPersonasDir());
    for (const project of this.projectsRef()) {
      const dir = projectPersonasDir(project);
      if (!existsSync(dir)) continue;
      // Same folder as the user dir (project registered at HOME / an ancestor
      // of `~/.zcc`): the user watcher already covers it — refresh() skips this
      // project too, so a second watcher would only fire redundant refreshes.
      if (canonicalDir(dir) === canonicalUserDir) continue;
      try {
        const w = watch(dir, { persistent: false }, () => this.scheduleRefresh());
        const projectId = project.id;
        w.on('error', (err) => {
          // eslint-disable-next-line no-console
          console.error(`[persona-store] project ${projectId} watcher error:`, err);
          try {
            w.close();
          } catch {
            /* already closed */
          }
          if (this.projectWatchers.get(projectId) === w) {
            this.projectWatchers.delete(projectId);
          }
          this.scheduleRefresh();
        });
        this.projectWatchers.set(projectId, w);
      } catch {
        // ignore — same fallback as user dir.
      }
    }
  }

  /** Coalesce burst events (editor save = create+rename+modify on most fs). */
  private scheduleRefresh() {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.refresh();
    }, 150);
  }
}
