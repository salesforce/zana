import type { AppConfig, HarnessModelRoutingV1, Persona, ProjectSettings } from '../../shared/types.js';
import type { HarnessScope, ModelLevel } from '../../shared/harness-adapter.js';
import type { HarnessNativeContribution } from './adapter-contract.js';

export type LegacyRoutingSource = 'persona' | 'project' | 'global';

export interface LegacyRoutingContext {
  readonly config: AppConfig;
  readonly persona?: Persona;
  readonly projectSettings?: ProjectSettings;
  readonly perTabRouting?: HarnessModelRoutingV1;
  readonly scope: HarnessScope;
}

export interface LegacyModelSelection {
  readonly targetId?: string;
  readonly level?: ModelLevel;
}

export interface LegacyExecutionSelection {
  readonly targetId: string;
  readonly contribution: HarnessNativeContribution;
  readonly nativePolicy: Readonly<Record<string, string>>;
}

/** Adapter-owned decoder for historical persisted routing fields. */
export interface HarnessLegacyRoutingAdapter {
  resolveModel?(
    context: LegacyRoutingContext,
    source: LegacyRoutingSource
  ): LegacyModelSelection | undefined;
  validateCompatibility?(value: unknown): boolean;
  resolveCompatibilityExecution?(value: unknown): LegacyExecutionSelection | undefined;
  resolveExecution?(context: LegacyRoutingContext, source: Exclude<LegacyRoutingSource, 'global'>): LegacyExecutionSelection | undefined;
  auditExecution?(selection: LegacyExecutionSelection): string | undefined;
}
