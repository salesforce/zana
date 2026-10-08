import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeDiagnostics, diagnosticRouteLabel, diagnosticRuntimeLabel } from './runtime-stalls.js';

function harness(overrides: Parameters<typeof createRuntimeDiagnostics>[0] = {}) {
  let clock = 1_000;
  const warnings: string[] = [];
  const diagnostics = createRuntimeDiagnostics({
    now: () => clock,
    warn: (message) => warnings.push(message),
    observeGc: false,
    sampleIntervalMs: 250,
    ...overrides
  });
  return { diagnostics, warnings, advance: (ms: number) => { clock += ms; } };
}

afterEach(() => { vi.useRealTimers(); });

describe('diagnosticRouteLabel', () => {
  it('drops the query string and collapses ids', () => {
    expect(diagnosticRouteLabel('get', '/api/v1/threads/98c8a9af-4fe0-4d13-ab55-ae8554916f1f/timeline?segmentLimit=20&token=abc'))
      .toBe('GET /api/v1/threads/:id/timeline');
    expect(diagnosticRouteLabel(undefined, '/api/v1/plugins/abc123def456ghi789/rpc#frag')).toBe('GET /api/v1/plugins/:id/rpc');
    expect(diagnosticRouteLabel('POST', undefined)).toBe('POST /');
  });

  it('keeps ordinary words and bounds long segments', () => {
    expect(diagnosticRouteLabel('GET', '/api/v1/conversation-outline')).toBe('GET /api/v1/conversation-outline');
    expect(diagnosticRouteLabel('GET', `/api/${'a'.repeat(200)}`)).toBe(`GET /api/${'a'.repeat(64)}`);
  });
});

describe('diagnosticRuntimeLabel', () => {
  it('labels requests by operation, and plugin RPCs by plugin and method', () => {
    expect(diagnosticRuntimeLabel({ type: 'request', operation: 'project-feed', request: { secret: 'x' } })).toBe('runtime:project-feed');
    expect(diagnosticRuntimeLabel({ type: 'request', operation: 'plugins-call-rpc', pluginId: 'design-docs', method: 'list', args: ['x'] }))
      .toBe('runtime:plugins-call-rpc design-docs.list');
    expect(diagnosticRuntimeLabel({ type: 'request', operation: 'plugins-call-rpc' })).toBe('runtime:plugins-call-rpc');
  });

  it('labels non-request and malformed messages', () => {
    expect(diagnosticRuntimeLabel({ type: 'stop' })).toBe('runtime:stop');
    expect(diagnosticRuntimeLabel({ type: 'request' })).toBe('runtime:request');
    expect(diagnosticRuntimeLabel({})).toBe('runtime:invalid');
    expect(diagnosticRuntimeLabel(null)).toBe('runtime:invalid');
    expect(diagnosticRuntimeLabel('stop')).toBe('runtime:invalid');
  });
});

describe('createRuntimeDiagnostics', () => {
  it('reports a stall with the operations that overlapped it, longest first', () => {
    const { diagnostics, warnings, advance } = harness();
    diagnostics.start();
    const endTimeline = diagnostics.track('GET /api/v1/threads/:id/timeline');
    const endRpc = diagnostics.track('runtime:plugins-call-rpc slack.sync');
    advance(100);
    endRpc();
    advance(4_000);
    endTimeline();
    const running = diagnostics.track('GET /api/v1/threads');
    advance(150);
    diagnostics.checkNow();
    diagnostics.stop();
    running();

    expect(warnings[0]).toBe('[diagnostics] slow GET /api/v1/threads/:id/timeline took 4100ms');
    expect(warnings[1]).toBe('[diagnostics] event loop stalled 4000ms; overlapping: '
      + 'GET /api/v1/threads/:id/timeline (4100ms), GET /api/v1/threads (150ms, running), runtime:plugins-call-rpc slack.sync (100ms)');
  });

  it('stays quiet for an on-time heartbeat and fast operations', () => {
    const { diagnostics, warnings, advance } = harness();
    diagnostics.start();
    const end = diagnostics.track('GET /api/v1/threads');
    advance(10);
    end();
    end();
    advance(240);
    diagnostics.checkNow();
    diagnostics.stop();
    expect(warnings).toEqual([]);
  });

  it('says so when no tracked operation overlapped the stall', () => {
    const { diagnostics, warnings, advance } = harness();
    diagnostics.start();
    advance(2_250);
    diagnostics.checkNow();
    diagnostics.stop();
    expect(warnings).toEqual(['[diagnostics] event loop stalled 2000ms; overlapping: no tracked operation']);
  });

  it('caps the overlapping list', () => {
    const { diagnostics, warnings, advance } = harness();
    diagnostics.start();
    for (let index = 0; index < 8; index++) diagnostics.track(`op-${index}`);
    advance(1_500);
    diagnostics.checkNow();
    diagnostics.stop();
    expect(warnings[0]).toMatch(/\+2 more$/);
  });

  it('rate-limits warnings per window and reports what it suppressed', () => {
    const { diagnostics, warnings, advance } = harness({ maxWarningsPerWindow: 2, warningWindowMs: 60_000, slowOperationMs: 10 });
    for (let index = 0; index < 5; index++) {
      const end = diagnostics.track(`op-${index}`);
      advance(20);
      end();
    }
    advance(60_000);
    const end = diagnostics.track('later');
    advance(20);
    end();
    expect(warnings).toEqual([
      '[diagnostics] slow op-0 took 20ms',
      '[diagnostics] slow op-1 took 20ms',
      '[diagnostics] suppressed 3 warnings in the last 60s',
      '[diagnostics] slow later took 20ms'
    ]);
  });

  it('runs the heartbeat on an unref timer and stops it', () => {
    vi.useFakeTimers();
    const warnings: string[] = [];
    const diagnostics = createRuntimeDiagnostics({ warn: (message) => warnings.push(message), observeGc: false, now: () => Date.now() });
    diagnostics.start();
    diagnostics.start();
    vi.advanceTimersByTime(1_000);
    expect(vi.getTimerCount()).toBe(1);
    diagnostics.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(warnings).toEqual([]);
  });

  it('observes garbage collection without failing when supported', () => {
    const diagnostics = createRuntimeDiagnostics({ warn: () => {}, observeGc: true });
    expect(() => { diagnostics.start(); diagnostics.stop(); }).not.toThrow();
  });
});
