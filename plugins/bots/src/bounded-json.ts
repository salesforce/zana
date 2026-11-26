export async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 128 * 1024) throw new Error('Response exceeds 128 KiB');
      chunks.push(value);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString());
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } finally {
    await reader.cancel().catch(() => {});
  }
}
