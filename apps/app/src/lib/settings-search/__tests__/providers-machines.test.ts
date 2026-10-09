import { describe, expect, it } from 'vitest';
import { searchSettings } from '../index';
import { getSettingsSearchProviders } from '../registry';
import { machineSearchId, machinesSearchProvider, registerMachinesSearchProvider } from '../providers/machines';

const snap = (machines?: Array<{ id?: string; name: string; host?: string }>) => ({ config: {} as never, machines });

describe('machines provider', () => {
  it('keys each result by host id, the same target MachineCard renders on that card', () => {
    const entries = machinesSearchProvider(snap([{ id: 'h-1', name: 'Mac Mini' }, { id: 'h-2', name: 'Mac Mini' }]));
    expect(entries.map((e) => e.id)).toEqual([machineSearchId('h-1'), machineSearchId('h-2')]);
    expect(machineSearchId('h-1')).toBe('machines.machine.h-1');
    // A row target (revealed and flashed), falling back to the Machines block if the card is not mounted.
    expect(entries[0]).toMatchObject({ kind: 'setting', anchor: 'machines' });
  });

  it('indexes names and hostnames, linking to the Machines page anchor', () => {
    const entries = machinesSearchProvider(snap([{ name: 'Mac Mini', host: 'mini.local' }, { name: 'Build box' }]));
    expect(entries.map((e) => e.id)).toEqual(['machines.machine.mac-mini', 'machines.machine.build-box']);
    expect(entries[0]).toMatchObject({ section: 'machines', anchor: 'machines', kind: 'setting', label: 'Mac Mini' });
    expect(entries[0].help).toContain('mini.local');
    expect(entries[1].help).toBe('Paired machine.');
  });

  it('is found by name or hostname through the engine', () => {
    const opts = { entries: [], providers: [machinesSearchProvider] };
    const s = snap([{ name: 'Mac Mini', host: 'mini.local' }]);
    expect(searchSettings('mini.local', s, opts)[0].entry.id).toBe('machines.machine.mac-mini');
    expect(searchSettings('mac mini', s, opts)[0].breadcrumb).toBe('Machines › Paired machines');
  });

  it('copes with no machines, blank names and duplicate names', () => {
    expect(machinesSearchProvider(snap())).toEqual([]);
    expect(machinesSearchProvider(snap([{ name: '  ' }]))).toEqual([]);
    const dup = machinesSearchProvider(snap([{ name: 'A' }, { name: 'a' }, { name: '!!!' }]));
    expect(dup.map((e) => e.id)).toEqual(['machines.machine.a', 'machines.machine.a-1', 'machines.machine.machine']);
  });

  it('registers and unregisters', () => {
    const before = getSettingsSearchProviders();
    const off = registerMachinesSearchProvider();
    expect(getSettingsSearchProviders()).toContain(machinesSearchProvider);
    off();
    expect(getSettingsSearchProviders()).toEqual(before);
  });
});
