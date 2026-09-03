export const PRODUCT_TERMINAL_OUTPUT_MAX_BYTES = 256 * 1024;

export interface BoundedTerminalOutput {
  text: string;
  truncated: boolean;
}

export function appendBoundedTerminalOutput(
  current: BoundedTerminalOutput | undefined,
  chunk: string,
  maxBytes = PRODUCT_TERMINAL_OUTPUT_MAX_BYTES
): BoundedTerminalOutput {
  const next = `${current?.text ?? ''}${chunk}`;
  const encoded = Buffer.from(next, 'utf8');
  if (encoded.byteLength <= maxBytes) {
    return { text: next, truncated: current?.truncated ?? false };
  }
  const sliced = encoded.subarray(encoded.byteLength - maxBytes);
  return { text: sliced.toString('utf8'), truncated: true };
}

export function terminalOutputSlice(
  buffer: BoundedTerminalOutput | undefined,
  tailBytes?: number
): BoundedTerminalOutput {
  const text = buffer?.text ?? '';
  const truncated = buffer?.truncated ?? false;
  if (tailBytes === undefined || !Number.isFinite(tailBytes) || tailBytes < 0) {
    return { text, truncated };
  }
  const encoded = Buffer.from(text, 'utf8');
  if (encoded.byteLength <= tailBytes) return { text, truncated };
  return {
    text: encoded.subarray(encoded.byteLength - tailBytes).toString('utf8'),
    truncated: true
  };
}
