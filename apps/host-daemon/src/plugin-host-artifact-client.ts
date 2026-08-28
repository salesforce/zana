import { HOST_ARTIFACT_MAX_BYTES } from '@zana-ai/zcc-host-daemon-contract';

export interface PluginHostArtifactHttpClient {
  fetch(args: {
    pluginId: string;
    digest: string;
    expectedByteLength: number;
  }): Promise<Uint8Array>;
}

function parseContentLength(value: string | null): number | null {
  if (value === null || value.trim().length === 0) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function assertHostArtifactContentLength(
  response: Response,
  expectedByteLength: number
): void {
  const contentLength = parseContentLength(response.headers.get('content-length'));
  if (contentLength === null) {
    throw new Error('Host artifact response is missing Content-Length');
  }
  if (contentLength > HOST_ARTIFACT_MAX_BYTES) {
    throw new Error(
      `Host artifact exceeds the ${HOST_ARTIFACT_MAX_BYTES} byte limit`
    );
  }
  if (contentLength !== expectedByteLength) {
    throw new Error(
      `Host artifact length mismatch: expected ${expectedByteLength}, received ${contentLength}`
    );
  }
}

function validateHostArtifactPartialByteLength(
  expectedByteLength: number,
  byteLength: number,
  maxBytes: number
): void {
  if (byteLength > maxBytes) {
    throw new Error(`Host artifact exceeds the ${maxBytes} byte limit`);
  }
  if (byteLength > expectedByteLength) {
    throw new Error(
      `Host artifact length mismatch: expected ${expectedByteLength}, received more than ${expectedByteLength}`
    );
  }
}

export async function readHostArtifactBytes(
  response: Response,
  expectedByteLength: number,
  maxBytes = HOST_ARTIFACT_MAX_BYTES
): Promise<Uint8Array> {
  if (!response.body) {
    throw new Error(
      `Host artifact length mismatch: expected ${expectedByteLength}, received 0`
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      totalBytes += result.value.byteLength;
      validateHostArtifactPartialByteLength(expectedByteLength, totalBytes, maxBytes);
      chunks.push(result.value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  }
  if (totalBytes !== expectedByteLength) {
    throw new Error(
      `Host artifact length mismatch: expected ${expectedByteLength}, received ${totalBytes}`
    );
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function createPluginHostArtifactHttpClient(options: {
  serverUrl: string;
  hostId: string;
  hostKey: string;
  fetchFn?: typeof fetch;
}): PluginHostArtifactHttpClient {
  const fetchFn = options.fetchFn ?? fetch;

  function url(path: string): string {
    return new URL(
      path,
      options.serverUrl.endsWith('/') ? options.serverUrl : `${options.serverUrl}/`
    ).toString();
  }

  function headers(): Record<string, string> {
    return {
      authorization: `Bearer ${options.hostKey}`,
      'x-zcc-host-id': options.hostId
    };
  }

  return {
    async fetch(args) {
      if (args.expectedByteLength > HOST_ARTIFACT_MAX_BYTES) {
        throw new Error(
          `Host artifact exceeds the ${HOST_ARTIFACT_MAX_BYTES} byte limit`
        );
      }
      const response = await fetchFn(
        url(
          `internal/plugins/${encodeURIComponent(args.pluginId)}/host/${encodeURIComponent(args.digest)}`
        ),
        { method: 'GET', headers: headers() }
      );
      if (!response.ok) {
        throw new Error(`plugin host artifact fetch failed: ${response.status}`);
      }
      assertHostArtifactContentLength(response, args.expectedByteLength);
      return readHostArtifactBytes(response, args.expectedByteLength);
    }
  };
}
