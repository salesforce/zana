import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { atomicDurableWrite, createSerializedTransactionQueue } from '../durable-store.js';
import type { PluginUpdateCheck } from './plugin-update-resolver.js';

function validCheck(value: unknown): value is PluginUpdateCheck {
  if (!value || typeof value !== 'object') return false;
  const check = value as PluginUpdateCheck;
  const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
  if (typeof check.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(check.fingerprint) ||
      !Number.isSafeInteger(check.checkedAt) || check.checkedAt < 0 ||
      !['available', 'current', 'pinned', 'incompatible', 'unavailable'].includes(check.outcome) ||
      (check.detail !== undefined && !text(check.detail, 1024))) return false;
  if (check.candidate !== undefined) {
    const candidate = check.candidate;
    if (!candidate || typeof candidate !== 'object' || !text(candidate.version, 256) ||
        (candidate.commit !== undefined && (typeof candidate.commit !== 'string' || !/^[a-f0-9]{40}$/.test(candidate.commit))) ||
        (candidate.tag !== undefined && !text(candidate.tag, 512)) ||
        (candidate.integrity !== undefined && !text(candidate.integrity, 1024))) return false;
  }
  if (check.outcome === 'available' && !check.candidate) return false;
  if (check.blocked !== undefined) {
    const blocked = check.blocked;
    if (!blocked || typeof blocked !== 'object' || !text(blocked.version, 256) ||
        !Array.isArray(blocked.reasons) || blocked.reasons.length > 8 ||
        !blocked.reasons.every(reason => text(reason, 1024))) return false;
  }
  return true;
}

/** Advisory data only; corrupt or stale checks can never authorize an update. */
export function createPluginUpdateStore(file: string) {
  const queue = createSerializedTransactionQueue();
  const read = (): Record<string, PluginUpdateCheck> => {
    if (!existsSync(file)) return {};
    try {
      if (statSync(file).size > 1_048_576) return {};
      const value = JSON.parse(readFileSync(file, 'utf8')) as { version?: number; checks?: unknown };
      if (value.version !== 1 || !value.checks || typeof value.checks !== 'object') return {};
      return Object.fromEntries(Object.entries(value.checks).slice(0, 256).filter(([id, item]) =>
        /^[a-z0-9][a-z0-9-]*$/.test(id) && validCheck(item)
      ));
    } catch { return {}; }
  };
  let cached = read();
  return {
    get(id: string) { return cached[id]; },
    async set(id: string, check: PluginUpdateCheck, installedIds: string[]) {
      return queue.run(async () => {
        const all = { ...cached, [id]: check };
        const checks = Object.fromEntries(Object.entries(all).filter(([key]) => installedIds.includes(key))
          .sort((a, b) => b[1].checkedAt - a[1].checkedAt).slice(0, 256));
        mkdirSync(dirname(file), { recursive: true });
        atomicDurableWrite(file, Buffer.from(JSON.stringify({ version: 1, checks })));
        cached = checks;
      });
    }
  };
}
