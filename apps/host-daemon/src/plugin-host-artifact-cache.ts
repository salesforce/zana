import { join } from 'node:path';
import { safePluginSegment } from '@zana-ai/zcc-agent-process-utils';
import {
  ensureCachedNodeArtifact,
  silentArtifactCacheLogger,
  type ArtifactCacheLogger
} from './node-artifact-cache.js';

const PLUGIN_HOST_ARTIFACT_CACHE_SEGMENT = 'plugin-host-artifacts';
const ARTIFACT_FILE_NAME = 'host.js';

export type FetchPluginHostArtifact = (args: {
  pluginId: string;
  digest: string;
  expectedByteLength: number;
}) => Promise<Uint8Array>;

export async function ensureCachedPluginHostArtifact(args: {
  dataDir: string;
  pluginId: string;
  digest: string;
  byteLength: number;
  fetchArtifact: FetchPluginHostArtifact;
  logger?: ArtifactCacheLogger;
}): Promise<string> {
  return ensureCachedNodeArtifact({
    cacheDir: join(
      args.dataDir,
      PLUGIN_HOST_ARTIFACT_CACHE_SEGMENT,
      safePluginSegment(args.pluginId)
    ),
    digest: args.digest,
    byteLength: args.byteLength,
    fileName: ARTIFACT_FILE_NAME,
    fetchArtifact: ({ digest, byteLength }) =>
      args.fetchArtifact({
        pluginId: args.pluginId,
        digest,
        expectedByteLength: byteLength
      }),
    logger: args.logger ?? silentArtifactCacheLogger
  });
}
