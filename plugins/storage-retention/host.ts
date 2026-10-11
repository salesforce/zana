import {
  experimental_defineHostEntry,
  type ExperimentalHostRpcContext,
} from "@zana-ai/zcc-plugin-sdk/host";
import { hostStorageContract } from "./src/host-contract.js";
import {
  discardEntries,
  discardLargeFiles,
  listLayout,
  measureEntries,
  type HostStorageEnv,
} from "./src/host-storage.js";

const envOf = (context: ExperimentalHostRpcContext): HostStorageEnv => ({
  threadStorageRoot: context.experimental_paths.threadStorageRoot,
  signal: context.signal,
  retainWorker: () => context.experimental_retainWorker(),
});

export default experimental_defineHostEntry({
  contract: hostStorageContract,
  handlers: {
    layout: (input, context) => listLayout(envOf(context), input),
    measureEntries: (input, context) => measureEntries(envOf(context), input),
    discard: (input, context) => discardEntries(envOf(context), input),
    discardLargeFiles: (input, context) => discardLargeFiles(envOf(context), input),
  },
});
