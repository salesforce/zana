import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../host.ts', import.meta.url), 'utf8');
const service = readFileSync(new URL('../../../server/src/services/execution/service.ts', import.meta.url), 'utf8');

describe('execution terminal stats capture', () => {
  it('bypasses live cache before lifecycle reconciliation and keeps one exit subscription', () => {
    expect(source.match(/ptys\.on\('exit'/g)).toHaveLength(1);
    expect(service).toContain("readSessionStats(sessionId, { fresh: sampleKind === 'terminal' })");
    const exitHandler = source.slice(source.indexOf("ptys.on('exit'"), source.indexOf("agentStatus.remove(sessionId)"));
    expect(exitHandler.indexOf("observeSessionUsage(exitedSession.cohort.executionId, sessionId, 'terminal')"))
      .toBeLessThan(exitHandler.indexOf('teamLifecycleIntegration.onSessionExit'));
    expect(exitHandler).toContain('readLiveSessionStats(exitedSession, { fresh: true })');
  });
});
