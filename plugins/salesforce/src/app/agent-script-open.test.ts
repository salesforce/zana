import { describe, expect, it } from 'vitest';
import { queueAgentScriptOpen, takeQueuedAgentScriptOpen } from './agent-script-open.js';

describe('queued Agent Script open', () => {
  it('stores one path per project and consumes it once', () => {
    queueAgentScriptOpen('p1', 'force-app/Bot.agent');
    queueAgentScriptOpen('p1', 'force-app/Other.agent');
    expect(takeQueuedAgentScriptOpen('p1')).toBe('force-app/Other.agent');
    expect(takeQueuedAgentScriptOpen('p1')).toBeNull();
  });
});
