import {
  marketplaceIndexSchema,
  type MarketplaceEntry,
  type MarketplaceIndex
} from '@zana-ai/zcc-domain';

export function parseMarketplaceIndex(raw: unknown): MarketplaceIndex {
  return marketplaceIndexSchema.parse(raw);
}

export function marketplaceInstallSpec(entry: MarketplaceEntry): string {
  if (entry.source.npm) {
    return `npm:${entry.source.npm.package}@${entry.source.npm.range}`;
  }
  const git = entry.source.git;
  if (!git) throw new Error(`marketplace entry ${entry.id} has no installable source`);
  const selector = git.range ? `semver:${git.range}` : git.ref ?? 'HEAD';
  return `git:${git.url}@${selector}`;
}

export function exactResolutionLabel(
  entry: MarketplaceEntry,
  resolved?: { version?: string; commit?: string }
): string {
  if (entry.source.npm) {
    return `npm ${entry.source.npm.package}@${resolved?.version ?? entry.source.npm.range}`;
  }
  const git = entry.source.git;
  return `git ${git?.url}@${resolved?.commit ?? git?.ref ?? git?.range ?? 'HEAD'}`;
}

export type { MarketplaceEntry, MarketplaceIndex };
