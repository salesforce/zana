import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MODERN_SQUAD_THREAD_ORIGIN,
  agentSessionTransport,
  isModernSquadThread,
  squadTransport,
  squadTransportClass,
  squadTransportKind
} from './squad-transport.js';

describe('squad transport helpers', () => {
  it('defaults absent or unknown transports to CLI', () => {
    expect(squadTransport(undefined)).toBe('CLI');
    expect(squadTransport(null)).toBe('CLI');
    expect(squadTransport({})).toBe('CLI');
    expect(squadTransport({ transport: 'CLI' })).toBe('CLI');
    expect(squadTransport({ transport: 'MODERN' })).toBe('MODERN');
  });

  it('maps transport to the fleet kind pill and dotted modifier', () => {
    expect(squadTransportKind('CLI')).toBe('agent');
    expect(squadTransportKind('MODERN')).toBe('thread');
    expect(squadTransportClass('CLI')).toBe('');
    expect(squadTransportClass('MODERN')).toBe('is-modern');
  });

  it('recognizes Modern squad member threads only by the host-reserved origin', () => {
    expect(isModernSquadThread({ originPluginId: MODERN_SQUAD_THREAD_ORIGIN })).toBe(true);
    expect(isModernSquadThread({ originPluginId: 'side-chat' })).toBe(false);
    expect(isModernSquadThread({ originPluginId: null })).toBe(false);
    expect(isModernSquadThread({})).toBe(false);
  });

  it('mirrors the server binding origin constant', () => {
    const server = readFileSync(
      new URL('../../../server/src/services/threads/squad-member-runtime.ts', import.meta.url),
      'utf8'
    );
    expect(server).toContain(`MODERN_SQUAD_BINDING_ORIGIN = '${MODERN_SQUAD_THREAD_ORIGIN}'`);
  });

  it('keeps every live session CLI and lets only a synthetic Job host borrow its squad transport', () => {
    const teams = [
      { id: 'modern', transport: 'MODERN' as const },
      { id: 'cli', transport: 'CLI' as const },
      { id: 'legacy' }
    ];
    const cohort = (teamId: string) => ({ cohortId: 'c', teamId, teamName: 'S', role: 'orchestrator' as const });
    expect(agentSessionTransport({ id: 'pty-1', cohort: cohort('modern') }, teams)).toBe('CLI');
    expect(agentSessionTransport({ id: 'execution:e1', cohort: cohort('modern') }, teams)).toBe('MODERN');
    expect(agentSessionTransport({ id: 'execution:e1', cohort: cohort('cli') }, teams)).toBe('CLI');
    expect(agentSessionTransport({ id: 'execution:e1', cohort: cohort('legacy') }, teams)).toBe('CLI');
    expect(agentSessionTransport({ id: 'execution:e1', cohort: cohort('missing') }, teams)).toBe('CLI');
    expect(agentSessionTransport({ id: 'execution:e1' }, teams)).toBe('CLI');
    expect(agentSessionTransport({ id: 'pty-2', cohort: cohort('modern') }, teams, true)).toBe('MODERN');
    expect(agentSessionTransport({ id: 'thread-1', cohort: cohort('cli') }, teams, false, true)).toBe('MODERN');
    expect(agentSessionTransport({ id: 'thread-1' }, teams, undefined, true)).toBe('MODERN');
  });
});
