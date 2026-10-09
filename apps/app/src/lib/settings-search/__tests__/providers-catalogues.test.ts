import { afterEach, describe, expect, it } from 'vitest';
import type { Persona, Team } from '@zana-ai/zcc-domain/product';
import { usePersonas, useTeams } from '../../../stores/live';
import { searchSettings } from '../index';
import { getSettingsSearchProviders, getSettingsSearchSourcesVersion } from '../registry';
import { buildCorpus } from '../corpus';
import { cataloguesSearchProvider, registerCataloguesSearchProvider } from '../providers/catalogues';

const config = { config: {} as never };
const persona = (id: string, name: string, description?: string) => ({ id, name, description }) as Persona;
const team = (id: string, name: string, description?: string) => ({ id, name, description, slots: [] }) as unknown as Team;

afterEach(() => {
  usePersonas.setState({ personas: [] });
  useTeams.setState({ teams: [] });
});

describe('catalogues provider', () => {
  it('maps personas and squads to their pages', () => {
    usePersonas.setState({ personas: [persona('builtin:rev', 'Reviewer', 'Reviews diffs')] });
    useTeams.setState({ teams: [team('t1', 'Release squad', 'Ships releases')] });
    const entries = cataloguesSearchProvider(config);
    expect(entries.map((e) => [e.id, e.section])).toEqual([
      ['personas.persona.builtin:rev', 'personas'],
      ['squads.squad.t1', 'squads']
    ]);
    expect(entries[0]).toMatchObject({ label: 'Reviewer', help: 'Reviews diffs' });
  });

  it('is found by description and ranks under the right page', () => {
    usePersonas.setState({ personas: [persona('p', 'Triager', 'Sorts incoming bug reports')] });
    const hits = searchSettings('bug reports', config, { entries: [], providers: [cataloguesSearchProvider] });
    expect(hits[0].entry.id).toBe('personas.persona.p');
    expect(hits[0].breadcrumb).toBe('Personas');
  });

  it('is empty with empty stores', () => {
    expect(cataloguesSearchProvider(config)).toEqual([]);
  });

  it('stays fresh through revision (no subscriptions, no notifications) and releases on dispose', () => {
    const before = getSettingsSearchProviders();
    const v0 = getSettingsSearchSourcesVersion();
    const dispose = registerCataloguesSearchProvider();
    try {
      expect(getSettingsSearchProviders()).toContain(cataloguesSearchProvider);
      const first = buildCorpus(config);
      expect(buildCorpus(config)).toBe(first); // same lists: memoised
      usePersonas.setState({ personas: [persona('n', 'Fresh reviewer')] });
      // A new list identity rebuilds the corpus with no signal at all...
      expect(searchSettings('fresh reviewer', config).map((h) => h.entry.id)).toContain('personas.persona.n');
      const second = buildCorpus(config);
      usePersonas.setState({ ...usePersonas.getState() }); // ...while other churn (same list) does not.
      expect(buildCorpus(config)).toBe(second);
      useTeams.setState({ teams: [team('x', 'Squad X')] });
      expect(buildCorpus(config)).not.toBe(second);
      // Never touches the async-source signal (that is for fetched data only).
      expect(getSettingsSearchSourcesVersion()).toBe(v0);
    } finally {
      dispose();
    }
    expect(getSettingsSearchProviders()).toEqual(before);
  });

  it('gives each persona and squad a row target the list renders', () => {
    usePersonas.setState({ personas: [persona('p1', 'Reviewer')] });
    useTeams.setState({ teams: [team('t1', 'Ship it')] });
    const ids = cataloguesSearchProvider(config).map((e) => e.id);
    expect(ids).toEqual(['personas.persona.p1', 'squads.squad.t1']);
  });
});
