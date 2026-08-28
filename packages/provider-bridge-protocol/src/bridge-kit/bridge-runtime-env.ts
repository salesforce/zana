import { PROVIDER_BRIDGE_RECORD_DIR_ENV } from "./bridge-recorder.js";

/**
 * The environment a bridge hands its provider child. Two variables are
 * bridge-process facts that must never leak downward: the Electron node flag,
 * and the record-mode directory — a recorded provider child that happened to
 * be a ZCC bridge itself would otherwise start recording too.
 */
export function withoutBridgeRuntimeEnv(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = { ...env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  delete childEnv[PROVIDER_BRIDGE_RECORD_DIR_ENV];
  return childEnv;
}
