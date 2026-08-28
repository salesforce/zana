import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('thread archive HTTP surface', () => {
  it('archives conversations before falling back to legacy PTY rows', () => {
    const source = readFileSync(new URL('./product-api.ts', import.meta.url), 'utf8');
    const start = source.indexOf("routeParams(path, '/api/v1/threads/:id/archive')");
    const end = source.indexOf("routeParams(path, '/api/v1/threads/:id/unarchive')");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const handler = source.slice(start, end);
    const conversation = handler.indexOf('archiveConversation(');
    const legacy = handler.indexOf('archiveThread(');
    expect(conversation).toBeGreaterThan(-1);
    expect(legacy).toBeGreaterThan(conversation);
  });
});
