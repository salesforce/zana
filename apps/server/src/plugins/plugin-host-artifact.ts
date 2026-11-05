import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { HOST_ARTIFACT_MAX_BYTES } from '@zana-ai/zcc-host-daemon-contract';
import { buildPluginHost, getPluginBuildToolchain, isPublishedHostArtifact } from '@zana-ai/zcc-plugin-build';
import type { PluginHostArtifactSnapshot } from './plugin-host-artifact-registry.js';
import type { InstalledPluginRow } from './plugin-store.js';

async function hashFile(filePath: string): Promise<{ digest: string; byteLength: number }> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    let byteLength = 0;
    createReadStream(filePath)
      .on('data', (chunk: string | Buffer) => {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        byteLength += bytes.byteLength;
        hash.update(bytes);
      })
      .on('error', reject)
      .on('end', () => {
        resolve({ digest: hash.digest('hex'), byteLength });
      });
  });
}

export function assertHostArtifactByteLength(pluginId: string, byteLength: number): void {
  if (byteLength > HOST_ARTIFACT_MAX_BYTES) {
    throw new Error(
      `host artifact for plugin "${pluginId}" exceeds the ${HOST_ARTIFACT_MAX_BYTES} byte limit`
    );
  }
}

function shouldRebuildHostArtifact(
  sourceKind: InstalledPluginRow['sourceKind'],
  rootDir: string,
  hostEntry: string,
  rebuildBuiltin: boolean
): boolean {
  // Older packages retained source but shipped no build dependencies. Source
  // presence must never cause a released builtin to be recompiled. A published
  // entry is already dist/host.js; rebuilding it stacks the Node banner.
  if (isPublishedHostArtifact(rootDir, hostEntry)) return false;
  if (sourceKind !== 'path' && !(sourceKind === 'builtin' && rebuildBuiltin)) return false;
  return existsSync(join(rootDir, hostEntry));
}

/**
 * Build editable installs and validate `dist/host.js` for daemon delivery.
 * Returns null when the plugin declares no host entry.
 */
export async function loadPluginHostArtifactSnapshot(args: {
  pluginId: string;
  rootDir: string;
  hostEntry: string | null;
  sourceKind: InstalledPluginRow['sourceKind'];
  zccVersion: string;
  dataDir?: string;
  /** Opt in only for builtin source development; shipped artifacts are read-only. */
  rebuildBuiltin?: boolean;
}): Promise<PluginHostArtifactSnapshot | null> {
  if (args.hostEntry === null) return null;
  if (shouldRebuildHostArtifact(args.sourceKind, args.rootDir, args.hostEntry, args.rebuildBuiltin === true)) {
    await buildPluginHost(args.rootDir, args.zccVersion, await getPluginBuildToolchain(args.dataDir));
  }
  const jsPath = join(args.rootDir, 'dist', 'host.js');
  const metaPath = join(args.rootDir, 'dist', 'host.meta.json');
  const artifactStats = await stat(jsPath).catch((error: unknown) => {
    throw new Error(
      `host artifact for plugin "${args.pluginId}" is missing or unreadable: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  });
  if (!artifactStats.isFile()) {
    throw new Error(
      `host artifact for plugin "${args.pluginId}" is missing or unreadable: not a file`
    );
  }
  assertHostArtifactByteLength(args.pluginId, artifactStats.size);
  const [artifact, rawMeta] = await Promise.all([
    hashFile(jsPath),
    readFile(metaPath, 'utf8')
  ]).catch((error: unknown) => {
    throw new Error(
      `host artifact for plugin "${args.pluginId}" is missing or unreadable: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  });
  assertHostArtifactByteLength(args.pluginId, artifact.byteLength);
  let declaredDigest: unknown;
  try {
    const parsed: unknown = JSON.parse(rawMeta);
    declaredDigest =
      typeof parsed === 'object' && parsed !== null
        ? Reflect.get(parsed, 'artifactDigest')
        : undefined;
  } catch {
    declaredDigest = undefined;
  }
  if (declaredDigest !== artifact.digest) {
    throw new Error(
      `host artifact for plugin "${args.pluginId}" has digest ${String(declaredDigest)}, expected ${artifact.digest}`
    );
  }
  return {
    path: jsPath,
    byteLength: artifact.byteLength,
    digest: artifact.digest,
    generation: randomUUID()
  };
}
