import {
  isForbiddenHostEnvironmentName,
  type HostEnvironmentEntry,
  type HostEnvironmentReplaceResult
} from '@zana-ai/zcc-contracts/host-rpc';

/**
 * Names-only marker listing the variables this daemon injected into its own
 * process environment. A daemon that restarts itself (self-update, restart)
 * spawns its successor with `{...process.env}`, which would otherwise promote a
 * stale forwarded value to a "user-owned" one that nothing ever removes. The
 * successor deletes every name listed here at startup. Values are never stored.
 */
export const FORWARDED_ENV_MARKER = 'ZCC_HOST_FORWARDED_ENV';

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isMissing(value: string | undefined): boolean {
  return value === undefined || value === '';
}

type Item = { key: string; entries: HostEnvironmentEntry[] };

/**
 * Environment the server pushes to a non-primary machine daemon (for example
 * credentials a plugin forwards). It is held in this process's environment only,
 * so every session the daemon spawns inherits it, and it is never persisted.
 *
 * Rules: the machine user's own value always wins (fill-if-missing); entries
 * sharing a `group` apply all-or-none; an entry with `requires` applies only
 * when every required name resolves; every push is a full replacement, so
 * dropped names are removed again; `clear()` restores the untouched environment.
 */
export class MachineEnvironment {
  private readonly applied = new Map<string, string>();

  constructor(private readonly target: NodeJS.ProcessEnv = process.env) {
    this.scrubInherited();
  }

  /** Names currently injected by this instance. */
  names(): string[] {
    return [...this.applied.keys()].sort();
  }

  replace(entries: readonly HostEnvironmentEntry[]): HostEnvironmentReplaceResult {
    this.restore();
    const items = this.groupEntries(entries);
    const applied: string[] = [];
    const skipped: string[] = [];
    // Entries that need another name run second so a token delivered in this
    // same push satisfies them.
    const independent = items.filter((item) => item.entries.every((entry) => !entry.requires?.length));
    const dependent = items.filter((item) => !independent.includes(item));
    for (const item of [...independent, ...dependent]) {
      const names = item.entries.map((entry) => entry.name);
      if (this.eligible(item)) {
        for (const entry of item.entries) {
          this.target[entry.name] = entry.value;
          this.applied.set(entry.name, entry.value);
        }
        applied.push(...names);
      } else {
        skipped.push(...names);
      }
    }
    this.writeMarker();
    return { applied: applied.sort(), skipped: skipped.sort() };
  }

  clear(): void {
    this.restore();
    this.writeMarker();
  }

  private groupEntries(entries: readonly HostEnvironmentEntry[]): Item[] {
    const byName = new Map<string, HostEnvironmentEntry>();
    for (const entry of entries) byName.set(entry.name, entry);
    const items = new Map<string, Item>();
    for (const entry of byName.values()) {
      const key = entry.group ? `group:${entry.group}` : `name:${entry.name}`;
      const item = items.get(key) ?? { key, entries: [] };
      item.entries.push(entry);
      items.set(key, item);
    }
    return [...items.values()];
  }

  private eligible(item: Item): boolean {
    return item.entries.every((entry) =>
      !isForbiddenHostEnvironmentName(entry.name)
      && isMissing(this.target[entry.name])
      && (entry.requires ?? []).every((name) => !isMissing(this.target[name]))
    );
  }

  /** Remove what we injected, but never a value something else has since replaced. */
  private restore(): void {
    for (const [name, value] of this.applied) {
      if (this.target[name] === value) delete this.target[name];
    }
    this.applied.clear();
  }

  private writeMarker(): void {
    if (this.applied.size === 0) delete this.target[FORWARDED_ENV_MARKER];
    else this.target[FORWARDED_ENV_MARKER] = this.names().join(',');
  }

  private scrubInherited(): void {
    const marker = this.target[FORWARDED_ENV_MARKER];
    if (marker === undefined) return;
    delete this.target[FORWARDED_ENV_MARKER];
    for (const name of marker.split(',')) {
      if (ENV_NAME.test(name) && !isForbiddenHostEnvironmentName(name)) delete this.target[name];
    }
  }
}
