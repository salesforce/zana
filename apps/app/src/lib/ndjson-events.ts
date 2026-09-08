export async function readNdjsonEvents<T>(
  response: Response,
  onEvent?: (event: T) => void
): Promise<T[]> {
  const events: T[] = [];
  const push = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const event = JSON.parse(trimmed) as T;
    events.push(event);
    onEvent?.(event);
  };
  if (!response.body) {
    push(await response.text());
    return events;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    buf += decoder.decode(value, { stream: !done });
    if (done) buf += decoder.decode();
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) push(line);
    if (done) {
      push(buf);
      return events;
    }
  }
}
