import type {
  ExecutionState,
  HarnessAdapterDescriptor,
  HarnessEvidence,
  HarnessExecutionEquivalence,
  HarnessPersonaFacet,
  HarnessScope,
  HarnessSupport
} from '../../shared/harness-adapter.js';

/** Opaque native material. Only a trusted adapter may create this value. */
export interface HarnessNativeContribution {
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly config?: Readonly<Record<string, unknown>>;
}

/** Token grammar used only to detect structured/raw collisions without rewriting argv. */
export interface NativeOptionGrammar {
  readonly names: readonly string[];
  readonly arity: 0 | 1;
  readonly acceptsAttachedValue?: boolean;
  readonly repeatable?: boolean;
}

export interface HarnessCollisionContract {
  readonly role?: readonly NativeOptionGrammar[];
  readonly model?: readonly NativeOptionGrammar[];
  readonly execution?: readonly NativeOptionGrammar[];
  readonly terminatesAtDoubleDash: boolean;
}

export interface TrustedHarnessAdapter {
  readonly descriptor: Omit<HarnessAdapterDescriptor, 'availability'>;
  readonly executionTargetMetadata?: Readonly<Partial<Record<ExecutionState, {
    readonly equivalence: HarnessExecutionEquivalence;
    readonly scopes: readonly HarnessScope[];
  }>>>;
  readonly collision: HarnessCollisionContract;
  readonly evidence: readonly HarnessEvidence[];
}

export const HARNESS_SETTINGS_CONTRIBUTIONS = [
  { id: 'claude-global-defaults', adapterId: 'claude' },
  { id: 'pi-global-defaults', adapterId: 'pi' },
  { id: 'codex-global-defaults', adapterId: 'codex' },
  { id: 'claude-project-overrides', adapterId: 'claude' },
  { id: 'codex-project-overrides', adapterId: 'codex' }
] as const;

const FACETS: readonly HarnessPersonaFacet[] = [
  'system-instructions',
  'opening-prompt',
  'tool-allowlist',
  'tool-denylist',
  'context-directories',
  'mcp-references',
  'model-selection',
  'execution-policy'
];

/** Build conservative per-scope facet claims for trusted provider registration. */
export function facetSupport(
  local: Partial<Record<HarnessPersonaFacet, HarnessSupport>>,
  remote: Partial<Record<HarnessPersonaFacet, HarnessSupport>> = local,
  evidence: Partial<Record<HarnessPersonaFacet, HarnessEvidence | Partial<Record<HarnessScope, HarnessEvidence>>>> = {}
): TrustedHarnessAdapter['descriptor']['capabilities'] {
  const scope = (
    claims: Partial<Record<HarnessPersonaFacet, HarnessSupport>>,
    name: HarnessPersonaFacet,
    harnessScope: HarnessScope
  ) => {
    const configured = evidence[name];
    const scopedEvidence = configured && 'id' in configured ? configured : configured?.[harnessScope];
    return ({
    support: (claims[name] ?? 'unsupported') as HarnessSupport,
    ...(claims[name] !== undefined && scopedEvidence?.scope === harnessScope ? { evidence: scopedEvidence } : {})
    });
  };
  return Object.fromEntries(
    FACETS.map((facet) => [facet, {
      local: scope(local, facet, 'local'),
      remote: scope(remote, facet, 'remote')
    }])
  ) as TrustedHarnessAdapter['descriptor']['capabilities'];
}

/** Detect native option use while preserving raw token order and content untouched. */
export function hasNativeOption(
  args: readonly string[],
  grammar: readonly NativeOptionGrammar[] | undefined,
  terminatesAtDoubleDash: boolean
): boolean {
  if (!grammar?.length) return false;
  for (const token of args) {
    if (terminatesAtDoubleDash && token === '--') return false;
    for (const option of grammar) {
      if (option.names.includes(token)) return true;
      if (option.acceptsAttachedValue && option.names.some((name) => token.startsWith(`${name}=`))) return true;
      if (option.acceptsAttachedValue && option.names.some((name) => name.length === 2 && token.startsWith(name) && token.length > name.length)) return true;
    }
  }
  return false;
}
