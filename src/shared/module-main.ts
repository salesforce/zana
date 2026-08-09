/**
 * Re-export shim. The extension contract now lives in the published SDK
 * package (`@zana-ai/zcc-extension-sdk`); this file keeps core's existing
 * `@shared/module-main` imports working unchanged. New code should import
 * from `@zana-ai/zcc-extension-sdk/main` directly.
 */

export type {
  MainModule,
  MainModuleContext,
  ModuleCapability,
  ExecRequest,
  ExecResult,
  BrokeredFetchInit,
  BrokeredFetchResponse,
  ExtensionLlmRequest,
  LlmInvokeResult,
  LlmInvokeErrorCode,
  HostLaunchSpec,
  HostRequestLaunchResult,
  HostConfirmSpec,
  HostNotifyAction,
  HostNotifySpec
} from '@zana-ai/zcc-extension-sdk/main';

// Re-export the SDK-local persona/team shapes too, for symmetry. Core itself
// uses `src/shared/types.ts` `Persona`/`Team` (structurally identical) at its
// wiring sites; these are exported only so a consumer that already imports from
// `@shared/module-main` can reach the ctx-service input types.
export type {
  Persona as SdkPersona,
  PersonaInput as SdkPersonaInput,
  Team as SdkTeam,
  TeamInput as SdkTeamInput
} from '@zana-ai/zcc-extension-sdk/main';
