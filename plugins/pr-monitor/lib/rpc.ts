/** Pack renderer `host.call(method, ...args)` into a single RPC payload. */
export function packRpcArgs(args: unknown[]): unknown {
  if (args.length === 0) return undefined;
  if (args.length === 1) return args[0];
  return args;
}

/** Unpack a single RPC payload back onto a method that may take 0, 1, or N args. */
export function invokeRpc(
  fn: (...args: never[]) => unknown,
  args: unknown
): unknown {
  if (args === undefined) return fn();
  if (Array.isArray(args)) return fn(...(args as never[]));
  return fn(args as never);
}
