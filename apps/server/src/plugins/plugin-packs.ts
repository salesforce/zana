import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  pluginPackIdentitySchema,
  pluginPackInstallRequestSchema,
  type PluginPackCatalogEntry,
  type PluginPackIdentity,
  type PluginPackInstallation,
  type PluginPackInstallationMember,
  type PluginPackInstallMember,
  type PluginPackInstallRequest,
  type PluginPackPlan
} from '@zana-ai/zcc-domain';
import { atomicDurableWrite, createSerializedTransactionQueue } from '../durable-store.js';
import { marketplaceInstallSpec, type MarketplaceEntry } from './marketplace.js';
import type { MarketplaceCatalogRow } from './marketplace-store.js';
import { marketplaceSourceDisplay, marketplaceSourcesEqual, parseMarketplaceSource } from './marketplace-source.js';

const MAX_INSTALLATIONS = 256;
const MAX_STORE_BYTES = 1_048_576;
const MAX_PLANS = 128;
const PLAN_TTL_MS = 15 * 60_000;

const installationMemberSchema = z.object({
  pluginId: z.string().min(1).max(128),
  displayName: z.string().max(160),
  selected: z.boolean(),
  status: z.enum(['pending', 'installed', 'failed', 'skipped']),
  version: z.string().max(256).optional(),
  source: z.string().max(4096).optional(),
  error: z.string().max(1000).optional()
}).strict();

const installationSchema = z.object({
  identity: pluginPackIdentitySchema,
  displayName: z.string().max(160),
  description: z.string().max(2000),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  members: z.array(installationMemberSchema).max(32)
}).strict();

const documentSchema = z.object({
  version: z.literal(1),
  installations: z.array(installationSchema).max(MAX_INSTALLATIONS)
}).strict();

type InstalledMember = { id: string; version: string; source: string };
type ApprovedPlan = {
  plan: PluginPackPlan;
  fingerprint: string;
  expiresAt: number;
  marketplaceName: string;
  entries: Map<string, MarketplaceEntry>;
};

export interface PluginPackService {
  list(): PluginPackCatalogEntry[];
  plan(identity: PluginPackIdentity): Promise<PluginPackPlan>;
  install(request: PluginPackInstallRequest): Promise<PluginPackInstallation>;
  listInstalled(): PluginPackInstallation[];
  /** Removes grouping metadata only. Does not call plugin uninstall, disable, or settings. */
  forget(identity: PluginPackIdentity): Promise<boolean>;
}

function sameIdentity(a: PluginPackIdentity, b: PluginPackIdentity) {
  return a.packId === b.packId && marketplaceSourcesEqual(a.marketplaceSource, b.marketplaceSource);
}

function fingerprint(row: MarketplaceCatalogRow, packId: string) {
  const pack = row.cachedPacks?.packs.find((entry) => entry.id === packId);
  const entries = pack?.members.map((member) => row.cachedIndex?.plugins.find((plugin) => plugin.id === member.pluginId) ?? null);
  return createHash('sha256').update(JSON.stringify({ marketplaceName: row.name, pack, entries })).digest('hex');
}

function sourceLabel(entry: MarketplaceEntry) {
  const label = marketplaceInstallSpec(entry);
  return entry.source.git?.subdir ? `${label} (${entry.source.git.subdir})` : label;
}

export function pluginPackStorePath(dataDir: string): string {
  return join(dataDir, 'plugins', 'packs.json');
}

export function createPluginPackService(opts: {
  dataDir: string;
  catalogs(): MarketplaceCatalogRow[];
  installed(): InstalledMember[];
  /** Must verify the materialized manifest ID before activation and retain ordinary installer checks. */
  installMember(input: PluginPackInstallMember): Promise<InstalledMember>;
  now?: () => number;
}): PluginPackService {
  const now = opts.now ?? Date.now;
  const file = pluginPackStorePath(opts.dataDir);
  const queue = createSerializedTransactionQueue();
  const plans = new Map<string, ApprovedPlan>();
  const active = new Set<string>();
  const activeKey = (identity: PluginPackIdentity) => `${identity.marketplaceSource}\n${identity.packId}`;

  function read(): PluginPackInstallation[] {
    if (!existsSync(file)) return [];
    if (statSync(file).size > MAX_STORE_BYTES) throw new Error('Plugin pack registry exceeds its size limit');
    try {
      const parsed = documentSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
      // A shutdown during install has no live job to resume. Offer a fresh review/retry.
      return parsed.installations.map((installation) => ({
        ...installation,
        members: installation.members.map((member) => member.status === 'pending' && !active.has(activeKey(installation.identity))
          ? { ...member, status: 'failed' as const, error: 'Installation was interrupted. Review the pack and retry.' }
          : member)
      }));
    } catch {
      throw new Error('Plugin pack registry is malformed; it has not been overwritten');
    }
  }

  function write(installations: PluginPackInstallation[]) {
    const document = documentSchema.parse({ version: 1, installations });
    const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
    if (bytes.length > MAX_STORE_BYTES) throw new Error('Plugin pack registry exceeds its size limit');
    mkdirSync(dirname(file), { recursive: true });
    atomicDurableWrite(file, bytes);
  }

  function save(installation: PluginPackInstallation) {
    const installations = read().filter((existing) => !sameIdentity(existing.identity, installation.identity));
    if (installations.length >= MAX_INSTALLATIONS) throw new Error('Plugin pack limit reached; forget an unused pack first');
    installations.push(installation);
    write(installations);
  }

  function findCatalog(identity: PluginPackIdentity) {
    const parsed = pluginPackIdentitySchema.parse(identity);
    const source = marketplaceSourceDisplay(parseMarketplaceSource(parsed.marketplaceSource));
    const matches = opts.catalogs().filter((row) => marketplaceSourcesEqual(row.source, source));
    if (matches.length !== 1) throw new Error('Plugin pack marketplace is unavailable or ambiguous');
    const row = matches[0]!;
    if (!row.cachedPacks?.packs.some((pack) => pack.id === parsed.packId)) {
      throw new Error('Plugin pack is unavailable; refresh its marketplace');
    }
    return row;
  }

  function prunePlans() {
    for (const [id, plan] of plans) if (plan.expiresAt <= now()) plans.delete(id);
    while (plans.size >= MAX_PLANS) plans.delete(plans.keys().next().value!);
  }

  return {
    list() {
      const rows: PluginPackCatalogEntry[] = [];
      for (const catalog of opts.catalogs().slice(0, 128)) {
        for (const pack of catalog.cachedPacks?.packs ?? []) {
          rows.push({
            identity: { marketplaceSource: catalog.source, packId: pack.id },
            marketplaceName: catalog.name,
            marketplaceDisplayName: catalog.displayName,
            pack: structuredClone(pack)
          });
          if (rows.length >= 1024) return rows;
        }
      }
      return rows;
    },
    async plan(identity) {
      const row = findCatalog(identity);
      const pack = row.cachedPacks!.packs.find((pack) => pack.id === identity.packId)!;
      const installed = new Map(opts.installed().map((entry) => [entry.id, entry]));
      const entries = new Map<string, MarketplaceEntry>();
      const plan: PluginPackPlan = {
        identity: { marketplaceSource: row.source, packId: pack.id },
        planId: randomUUID(),
        displayName: pack.displayName,
        description: pack.description,
        members: pack.members.map((member) => {
          const entry = row.cachedIndex?.plugins.find((entry) => entry.id === member.pluginId);
          const existing = installed.get(member.pluginId);
          if (entry) entries.set(entry.id, structuredClone(entry));
          return {
            pluginId: member.pluginId,
            displayName: entry?.displayName.slice(0, 160) ?? member.pluginId,
            description: entry?.description ?? '',
            required: member.required ?? false,
            status: existing ? 'installed' : entry ? 'available' : 'unavailable',
            ...(entry ? {
              sourceLabel: sourceLabel(entry),
              targetVersion: entry.source.npm?.range ?? entry.source.git?.ref ?? entry.source.git?.range ?? 'HEAD'
            } : {}),
            ...(existing ? {
              installedVersion: existing.version,
              installedSource: existing.source,
              reason: 'Already installed. Its version, source, settings and enabled state will be kept.'
            } : !entry ? { reason: 'This plugin is missing from the pack marketplace. Refresh the catalogue and retry.' } : {})
          };
        })
      };
      prunePlans();
      plans.set(plan.planId, {
        plan: structuredClone(plan), fingerprint: fingerprint(row, pack.id),
        expiresAt: now() + PLAN_TTL_MS, marketplaceName: row.name, entries
      });
      return plan;
    },
    install(rawRequest) {
      const request = pluginPackInstallRequestSchema.parse(rawRequest);
      return queue.run(async () => {
        const approved = plans.get(request.planId);
        if (!approved || approved.expiresAt <= now()) throw new Error('Plugin pack review expired. Review the pack again.');
        if (!sameIdentity(approved.plan.identity, request.identity)) throw new Error('Plugin pack review does not match this pack');
        const catalog = findCatalog(request.identity);
        if (fingerprint(catalog, request.identity.packId) !== approved.fingerprint) {
          plans.delete(request.planId);
          throw new Error('Plugin pack changed since review. Review the pack again.');
        }
        const selected = new Set(request.pluginIds);
        const members = approved.plan.members;
        const currentInstalled = new Map(opts.installed().map((entry) => [entry.id, entry]));
        if (request.pluginIds.some((id) => !members.some((member) => member.pluginId === id))) {
          throw new Error('Selected plugin is not a member of this pack');
        }
        if (members.some((member) => member.status === 'installed' && selected.has(member.pluginId) && !currentInstalled.has(member.pluginId))) {
          throw new Error('A previously installed plugin was removed since review. Review the pack again before installing it.');
        }
        if (members.some((member) => member.required && !currentInstalled.has(member.pluginId) && !selected.has(member.pluginId))) {
          throw new Error('Select every required plugin before installing this pack');
        }
        const previous = read().find((record) => sameIdentity(record.identity, approved.plan.identity));
        const startedAt = now();
        let installation: PluginPackInstallation = {
          identity: approved.plan.identity,
          displayName: approved.plan.displayName,
          description: approved.plan.description,
          createdAt: previous?.createdAt ?? startedAt,
          updatedAt: startedAt,
          members: members.map((member) => {
            const retained = previous?.members.find((old) => old.pluginId === member.pluginId && old.selected && old.status === 'installed');
            const isSelected = selected.has(member.pluginId) || Boolean(retained);
            const existing = currentInstalled.get(member.pluginId);
            return {
              pluginId: member.pluginId, displayName: member.displayName,
              selected: isSelected,
              status: !isSelected ? 'skipped' : existing ? 'installed' : selected.has(member.pluginId) ? 'pending' : 'failed',
              ...(isSelected && existing ? { version: existing.version, source: existing.source } : {}),
              ...(retained && !existing && !selected.has(member.pluginId)
                ? { error: 'Previously installed plugin was removed. Select it to reinstall.' } : {})
            };
          })
        };
        save(installation);
        plans.delete(request.planId);
        active.add(activeKey(installation.identity));
        try {
          for (const member of installation.members) {
            if (member.status !== 'pending') continue;
            let result: PluginPackInstallationMember;
            // Recheck under the pack queue immediately before the normal installer.
            const existing = opts.installed().find((entry) => entry.id === member.pluginId);
            if (existing) {
              result = { ...member, status: 'installed', version: existing.version, source: existing.source };
            } else {
              try {
                const entry = approved.entries.get(member.pluginId);
                if (!entry) throw new Error('Plugin is not available in this marketplace');
                const installed = await opts.installMember({
                  entry: structuredClone(entry), marketplaceSource: approved.plan.identity.marketplaceSource,
                  marketplaceName: approved.marketplaceName, pluginId: member.pluginId
                });
                if (installed.id !== member.pluginId) throw new Error('Installer returned a different plugin identity');
                result = { ...member, status: 'installed', version: installed.version, source: installed.source };
              } catch (error) {
                // Ordinary installs racing this pack may have succeeded in the meantime.
                const raced = opts.installed().find((entry) => entry.id === member.pluginId);
                result = raced
                  ? { ...member, status: 'installed', version: raced.version, source: raced.source }
                  : { ...member, status: 'failed', error: error instanceof Error ? error.message.slice(0, 1000) : 'Plugin installation failed' };
              }
            }
            installation = {
              ...installation, updatedAt: now(),
              members: installation.members.map((item) => item.pluginId === member.pluginId ? result : item)
            };
            save(installation);
          }
          return structuredClone(installation);
        } finally {
          active.delete(activeKey(installation.identity));
        }
      });
    },
    listInstalled: read,
    forget(rawIdentity) {
      const identity = pluginPackIdentitySchema.parse(rawIdentity);
      return queue.run(async () => {
        const installations = read();
        const next = installations.filter((record) => !sameIdentity(record.identity, identity));
        if (next.length === installations.length) return false;
        write(next);
        return true;
      });
    }
  };
}
