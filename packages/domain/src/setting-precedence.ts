/**
 * Static precedence table: one place that says which layer of a setting wins,
 * and how layers combine. UI help text and order strips are generated from it
 * so the in-app prose cannot drift from the code.
 *
 * A setting is listed only if a user can set it at two or more layers through
 * a UI control. Layers are ordered highest priority first.
 *
 * This table describes behaviour; it does not drive it. Resolver-backed
 * `first` rows are pinned by contract tests that run each layer through the
 * real resolver. Argv-built rows carry `evidence` (file, line, snippet) and a
 * test fails when the cited line no longer contains the snippet.
 */

export type PrecedenceLayerId =
  | 'launch'
  | 'plan'
  | 'squad'
  | 'agent'
  | 'persona'
  | 'project'
  | 'global'
  | 'thread'
  | 'child-default'
  | 'default';

/**
 * `first`   the first layer that sets a value wins (strip is shown).
 * `last`    the last occurrence in the command line wins (no strip).
 * `union`   layers combine (no strip).
 * `floor`   the strictest layer wins and none can lower another (no strip).
 */
export type PrecedenceMergeRule = 'first' | 'last' | 'union' | 'floor';

export interface PrecedenceEvidence {
  /** Repo-relative path. */
  file: string;
  line: number;
  /** Text that must appear on that line. */
  contains: string;
}

export interface SettingPrecedence {
  key: string;
  label: string;
  layers: readonly PrecedenceLayerId[];
  mergeRule: PrecedenceMergeRule;
  /** One sentence shown when no arrowed strip applies, or after the strip. */
  note?: string;
  /** Present on argv-built rows, which have no resolver to test. */
  evidence?: readonly PrecedenceEvidence[];
}

export const LAYER_LABELS: Readonly<Record<PrecedenceLayerId, string>> = {
  launch: 'This launch',
  plan: 'Plan',
  squad: 'Squad',
  agent: 'Agent',
  persona: 'Persona',
  project: 'Project',
  global: 'Global',
  thread: 'Thread',
  'child-default': 'Child default',
  default: 'Built-in default'
};

export const SETTING_PRECEDENCE = [
  {
    key: 'launch.options',
    label: 'Squad launch options',
    layers: ['launch', 'plan', 'squad', 'default'],
    mergeRule: 'first',
    note: 'Worktree isolation falls back to the Project setting, then the Global default. Other launch options use built-in defaults. Choosing a checkout target skips the Squad on-complete setting.'
  },
  {
    key: 'launch.checkout',
    label: 'Checkout for a Squad launch',
    layers: ['launch', 'plan', 'squad', 'project', 'global'],
    mergeRule: 'first',
    note: 'Choosing Project checkout or an existing worktree sets this launch, skips the Squad on-complete setting, and the worktree stays yours: it cannot be merged or deleted.'
  },
  {
    key: 'squad.launchApproval',
    label: 'Squad launch approval',
    layers: ['squad', 'project'],
    mergeRule: 'floor',
    note: 'Review is required if the Squad or the Project asks for it. Neither can lower the other.'
  },
  {
    key: 'thread.notifications',
    label: 'Thread notification level',
    layers: ['thread', 'child-default', 'global'],
    mergeRule: 'first',
    note: 'A quieter parent thread caps the result. The cap only lowers the level.'
  },
  {
    key: 'harness.target',
    label: 'Provider, model, role and execution state',
    layers: ['agent', 'persona', 'project', 'global', 'default'],
    mergeRule: 'first',
    note: 'Applies to new threads and CLI agents. Provider and model resolve separately. Raw extra arguments on a tab can override every layer.'
  },
  {
    key: 'claude.permissionMode',
    label: 'Claude permission mode',
    layers: ['global', 'project', 'persona', 'agent'],
    mergeRule: 'last',
    note: 'The last permission-mode argument on the command line wins. Autonomous launches add acceptEdits near the end, and yolo profiles ignore the mode.',
    evidence: [
      { file: 'apps/host-daemon/src/pty.ts', line: 2098, contains: "['--permission-mode', 'acceptEdits']" }
    ]
  },
  {
    key: 'tools.allowedDenied',
    label: 'Allowed and denied tools',
    layers: ['global', 'project', 'persona', 'agent'],
    mergeRule: 'union',
    note: 'Layers add up with duplicates removed. Squad workers use the persona list only.'
  },
  {
    key: 'pi.thinking',
    label: 'PI thinking level',
    layers: ['agent', 'persona', 'project', 'global', 'default'],
    mergeRule: 'last',
    note: 'The last thinking argument on the command line wins: Global, then Project, then Persona, then the tab.',
    evidence: [
      { file: 'apps/host-daemon/src/harness/pi/provider.ts', line: 105, contains: "args.push('--thinking', config.piThinking)" },
      { file: 'apps/host-daemon/src/harness/pi/provider.ts', line: 125, contains: "args.push('--thinking', settings.piThinking)" }
    ]
  },
  {
    key: 'squad.routingEnforced',
    label: 'Routing enforcement',
    layers: ['squad', 'global'],
    mergeRule: 'first',
    evidence: [
      { file: 'apps/desktop/src/team-routing-enforcement.ts', line: 20, contains: 'team?.routingEnforced ?? globalEnabled' }
    ]
  },
  {
    key: 'squad.planning',
    label: 'Squad planning mode',
    layers: ['launch', 'squad', 'default'],
    mergeRule: 'first',
    note: 'The built-in default is Infer plan from goal when the orchestrator can write a plan, otherwise Plan provided in goal. In the composer, the Squad default applies until you pick a mode.',
    evidence: [
      { file: 'apps/desktop/src/squad-proposals/service.ts', line: 362, contains: "planningInput ?? team.defaultPlanning ?? (canInfer ? 'infer' : 'provided')" }
    ]
  },
  {
    key: 'squad.leanWorkers',
    label: 'Worker skills',
    layers: ['persona', 'squad', 'default'],
    mergeRule: 'first',
    note: 'A Persona with its own skills list keeps it. Lean workers only presets worker slots whose Persona sets none, and never the orchestrator. The built-in default is unrestricted.'
  },
  {
    key: 'extraArgs',
    label: 'Extra command arguments',
    layers: ['global', 'project', 'persona', 'agent'],
    mergeRule: 'last',
    note: 'Arguments apply in this order. When the same option appears more than once, the last one wins.'
  }
] as const satisfies readonly SettingPrecedence[];

export type SettingPrecedenceKey = (typeof SETTING_PRECEDENCE)[number]['key'];

export function getSettingPrecedence(key: SettingPrecedenceKey): SettingPrecedence {
  const row = SETTING_PRECEDENCE.find((entry) => entry.key === key);
  if (!row) throw new Error(`Unknown setting precedence key: ${key}`);
  return row;
}

/** An arrowed strip is honest only when the first defined layer wins. */
export function hasOrderStrip(row: SettingPrecedence): boolean {
  return row.mergeRule === 'first';
}

const MERGE_SENTENCE: Record<Exclude<PrecedenceMergeRule, 'first'>, string> = {
  last: 'The last value given wins.',
  union: 'Layers combine.',
  floor: 'The strictest layer wins.'
};

/**
 * Help text for a setting. First-defined rows read "Checked first: A, then B.
 * The first layer that sets a value wins." Others name the layers and the rule,
 * with no left-to-right order implied beyond the listed layers.
 */
export function precedenceHelp(key: SettingPrecedenceKey): string {
  const row = getSettingPrecedence(key);
  const names = row.layers.map((id) => LAYER_LABELS[id]);
  const head = row.mergeRule === 'first'
    ? `Checked first to last: ${names.join(', then ')}. The first layer that sets a value wins.`
    : `Layers: ${names.join(', ')}. ${MERGE_SENTENCE[row.mergeRule]}`;
  return row.note ? `${head} ${row.note}` : head;
}
