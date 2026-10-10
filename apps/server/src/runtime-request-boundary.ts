import { SERVER_RUNTIME_PROTOCOL_VERSION, ServerRuntimeInboundSchema, type ServerRuntimeInbound } from '@zana-ai/zcc-contracts/runtime';

/** EventEmitter does not await listeners. Always return request failures to main
 * so invalid installs and offline operations cannot become silent timeouts. */
export async function dispatchRuntimeMessage(
  data: unknown,
  postMessage: (message: unknown) => void,
  handle: (message: ServerRuntimeInbound) => Promise<void>
): Promise<void> {
  const parsed = ServerRuntimeInboundSchema.safeParse(data);
  if (!parsed.success) {
    // Echo a well-formed id so main rejects the pending request now instead of waiting out its timeout.
    const rawId = typeof data === 'object' && data !== null ? (data as { id?: unknown }).id : undefined;
    const issue = parsed.error.issues[0];
    const detail = issue ? `${issue.path.join('.')} ${issue.message}`.trim() : '';
    postMessage({
      type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
      ...(typeof rawId === 'string' && rawId.length > 0 && rawId.length <= 200 ? { id: rawId } : {}),
      message: `invalid server runtime message: ${detail}`.slice(0, 200)
    });
    return;
  }
  try { await handle(parsed.data); }
  catch (error) {
    postMessage({
      type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
      ...('id' in parsed.data ? { id: parsed.data.id } : {}),
      message: (error instanceof Error ? error.message : String(error)).slice(0, 8192)
    });
  }
}
