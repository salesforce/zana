import { registerSettingsSearchProvider } from '../registry';
import type { SettingsSearchEntry, SettingsSearchProvider } from '../types';

/** Row target for one paired machine; `MachineCard` renders the same id on its card. */
export const machineSearchId = (key: string) => `machines.machine.${key}`;

/**
 * Paired machines: names and hostnames from the snapshot the renderer already
 * holds. A result opens the Machines page and reveals that machine's own card
 * (keyed by host id); if the card is not mounted it falls back to the Machines
 * block. A machine without an id (never from the hosts API) gets a name slug.
 */
export const machinesSearchProvider: SettingsSearchProvider = (snapshot) => {
  const seen = new Map<string, number>();
  return (snapshot.machines ?? []).flatMap((machine): SettingsSearchEntry[] => {
    const name = machine.name?.trim();
    if (!name) return [];
    let key = machine.id?.trim();
    if (!key) {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'machine';
      const count = seen.get(slug) ?? 0;
      seen.set(slug, count + 1);
      key = `${slug}${count ? `-${count}` : ''}`;
    }
    const host = machine.host?.trim();
    return [
      {
        id: machineSearchId(key),
        section: 'machines',
        anchor: 'machines',
        label: name,
        help: host ? `Paired machine. Host: ${host}` : 'Paired machine.',
        keywords: host ? [host, 'machine', 'host'] : ['machine', 'host'],
        kind: 'setting'
      }
    ];
  });
};

export function registerMachinesSearchProvider(): () => void {
  return registerSettingsSearchProvider(machinesSearchProvider);
}
