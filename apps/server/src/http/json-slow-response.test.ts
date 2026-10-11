import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { createPluginToolCallHttpClient } from '../../../host-daemon/src/plugin-tool-call-client.js';
import { beginSlowJson } from './json.js';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function serve(handler: (response: ServerResponse) => void): Promise<string> {
  const server = createServer((_request, response) => handler(response));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const toolCall = {
  threadId: '11111111-1111-4111-8111-111111111111',
  providerThreadId: 'prov-1',
  turnId: 'turn-1',
  callId: 'call-1',
  tool: 'ask_user_question'
};

it('lets the daemon client read a heartbeat-prefixed answer once headers arrived early', async () => {
  // The answer is held until the client has seen the headers, so this only
  // settles if the heartbeat flushed them while the tool was still pending.
  let headersBeforeAnswer = false;
  let release!: () => void;
  const headersSeen = new Promise<void>((resolve) => { release = resolve; });
  const url = await serve((response) => {
    const reply = beginSlowJson(response, 10);
    const fallback = setTimeout(release, 2_000);
    void headersSeen.then(() => {
      clearTimeout(fallback);
      setTimeout(() => reply.send({ success: true, contentItems: [{ type: 'inputText', text: 'Blue' }] }), 30);
    });
  });
  const client = createPluginToolCallHttpClient({
    serverUrl: url, hostId: 'host-1', hostKey: 'key', sessionId: 'inst-1',
    fetchFn: async (input, init) => {
      const response = await fetch(input, init);
      headersBeforeAnswer = true;
      release();
      return response;
    }
  });
  const answer = client.invoke(toolCall as never);
  await headersSeen;
  expect(headersBeforeAnswer).toBe(true);
  await expect(answer).resolves.toEqual({ success: true, contentItems: [{ type: 'inputText', text: 'Blue' }] });
});

it('answers a fast call as plain JSON without streaming', async () => {
  const url = await serve((response) => beginSlowJson(response, 10_000).send({ success: false, contentItems: [] }));
  const response = await fetch(url, { method: 'POST' });
  expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  expect(await response.text()).toBe('{"success":false,"contentItems":[]}');
});
