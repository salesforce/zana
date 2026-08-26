import { homedir } from 'node:os';
import {
  HOST_RPC_PROTOCOL_VERSION,
  HostEnrollRequestSchema,
  HostEnrollResponseSchema,
  type HostEnrollResponse
} from '@zana-ai/zcc-contracts/host-rpc';

export async function enrollDaemonHost(input: {
  serverUrl: string;
  token: string;
  hostName: string;
  instanceId: string;
  hostId?: string;
  homeDir?: string;
  fetchFn?: typeof fetch;
}): Promise<HostEnrollResponse> {
  const fetchFn = input.fetchFn ?? fetch;
  const response = await fetchFn(new URL('/internal/hosts/enroll', input.serverUrl), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(HostEnrollRequestSchema.parse({
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      hostName: input.hostName,
      instanceId: input.instanceId,
      homeDir: input.homeDir ?? homedir(),
      ...(input.hostId ? { hostId: input.hostId } : {})
    }))
  });
  if (response.status !== 201) {
    const detail = await response.text();
    throw new Error(`Failed to enroll daemon host: ${response.status}${detail ? ` ${detail}` : ''}`);
  }
  return HostEnrollResponseSchema.parse(await response.json());
}
