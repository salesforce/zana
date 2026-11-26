import { describe, expect, it } from 'vitest';
import { recordTeam } from './team-launch-support.js';

describe('recordTeam', () => {
  it('prefers the transport pinned on the run over the stored team preference', () => {
    expect(recordTeam({ id: 't', transport: 'CLI' }, { resolvedTransport: { transport: 'MODERN' } }).transport).toBe('MODERN');
    expect(recordTeam({ id: 't', transport: 'MODERN' }, { resolvedTransport: { transport: 'CLI' } }).transport).toBe('CLI');
    expect(recordTeam({ id: 't' }, { resolvedTransport: { transport: 'MODERN' } }).transport).toBe('MODERN');
  });

  it('keeps an explicit Modern pin on a legacy run with no resolved transport', () => {
    const team = { id: 't', transport: 'MODERN' };
    expect(recordTeam(team, {})).toBe(team);
  });

  it('reads a legacy run with absent or caller transport as CLI, never re-resolving', () => {
    expect(recordTeam({ id: 't' }, {}).transport).toBe('CLI');
    expect(recordTeam({ id: 't', transport: 'CALLER' }, {}).transport).toBe('CLI');
  });

  it('does not mutate the stored team', () => {
    const team = { id: 't', transport: 'CLI' };
    recordTeam(team, { resolvedTransport: { transport: 'MODERN' } });
    expect(team.transport).toBe('CLI');
  });
});
