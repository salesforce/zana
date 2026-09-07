import { describe, expect, it } from 'vitest';
import { readNdjsonEvents } from '../ndjson-events.js';

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    }
  });
  return new Response(body, { headers: { 'content-type': 'application/x-ndjson' } });
}

describe('readNdjsonEvents', () => {
  it('emits events as complete lines arrive', async () => {
    const seen: Array<{ type: string }> = [];
    const events = await readNdjsonEvents<{ type: string; text?: string }>(
      streamResponse([
        '{"type":"log","text":"Installing…"}',
        '\n{"type":"log","text":"Waiting…"}\n',
        '{"type":"error","code":"daemon_unresponsive"}\n'
      ]),
      (event) => seen.push(event)
    );
    expect(events.map((event) => event.type)).toEqual(['log', 'log', 'error']);
    expect(seen).toEqual(events);
  });

  it('parses a single JSON object with no trailing newline', async () => {
    const events = await readNdjsonEvents<{ type: string }>(
      new Response('{"type":"error"}', { headers: { 'content-type': 'application/x-ndjson' } })
    );
    expect(events).toEqual([{ type: 'error' }]);
  });
});
