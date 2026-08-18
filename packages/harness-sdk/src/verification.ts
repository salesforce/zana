export interface HarnessVerificationDefinition {
  readonly installHint: string;
  readonly versionArgs: readonly string[];
  readonly alwaysEnabled?: boolean;
  readonly enabledConfigKey?: string;
}
