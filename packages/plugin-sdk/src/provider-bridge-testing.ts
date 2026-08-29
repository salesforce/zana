/**
 * `@zana-ai/zcc-plugin-sdk/provider-bridge/testing` — the published testing kit
 * for provider bridges.
 *
 * A bridge author needs the conformance kit, the delta assembler the runtime
 * actually runs, and the JSON-RPC / calibration harness. Framework-agnostic:
 * nothing here imports a test runner. Curated by hand — named exports only.
 */
export {
  CONFORMANCE_ASSEMBLED_EVENT_METHOD,
  formatConformanceReport as experimental_formatConformanceReport,
  runBridgeConformance as experimental_runBridgeConformance,
} from "@zana-ai/zcc-provider-bridge-protocol/conformance";
export type {
  BridgeConformanceTransport,
  ConformanceCheckResult,
  ConformanceReport,
  ConformanceSessionFixture,
  RunBridgeConformanceOptions,
} from "@zana-ai/zcc-provider-bridge-protocol/conformance";

export {
  ASSEMBLER_GRAMMAR_VERSIONS,
  createDeltaAssembler as experimental_createDeltaAssembler,
} from "@zana-ai/zcc-provider-bridge-protocol/assembler";
export type {
  AssembleDeltasArgs,
  CreateDeltaAssemblerOptions,
  DeltaAssembler,
  DiffCumulativeTextArgs,
  DiffCumulativeTextResult,
} from "@zana-ai/zcc-provider-bridge-protocol/assembler";

export {
  assembleCapturedThreadEvents as experimental_assembleCapturedThreadEvents,
  captureBridgeJsonRpcOutput as experimental_captureBridgeJsonRpcOutput,
  createBridgeDeltaEventCollector as experimental_createBridgeDeltaEventCollector,
  createBridgeJsonRpcTestHarness as experimental_createBridgeJsonRpcTestHarness,
  describeCalibrationEvents as experimental_describeCalibrationEvents,
  normalizeCalibrationEvents as experimental_normalizeCalibrationEvents,
} from "@zana-ai/zcc-provider-bridge-protocol/testing";
export type {
  BridgeDeltaEventCollector,
  BridgeJsonRpcId,
  BridgeJsonRpcLineHandler,
  BridgeJsonRpcObject,
  BridgeJsonRpcOutputMessage,
  BridgeJsonRpcTestHarness,
  CapturedBridgeJsonRpcOutput,
  CapturedBridgeNotification,
  NormalizeCalibrationEventsOptions,
} from "@zana-ai/zcc-provider-bridge-protocol/testing";

export type {
  ThreadEvent,
  ThreadEventBackgroundTaskItem,
  ThreadEventDelegationItem,
  ThreadEventExtensionItem,
  ThreadEventFileReadItem,
  ThreadEventItem,
  ThreadEventItemPresentation,
  ThreadEventPlanStepsItem,
  ThreadEventSearchItem,
  ThreadEventWebFetchItem,
  ThreadEventWebSearchItem,
} from "@zana-ai/zcc-domain/thread-runtime";
