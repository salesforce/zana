import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApiErrorFailureFixture } from './api-error-fixture-types.js';

export const PI_FIXTURE_ID = '01a20f28-19c3-762d-8c3d-2838cd9e0e96';

const line = (value: unknown) => `${JSON.stringify(value)}\n`;

/** Rows shaped like a captured Pi session (final failure: assistant `stopReason:"error"`, no tombstone). */
export const piRows = {
  header: (id = PI_FIXTURE_ID, cwd = '/work') => line({ type: 'session', version: 3, id, timestamp: '2026-11-24T20:03:36.004Z', cwd }),
  user: (id: string, parentId: string) => line({ type: 'message', id, parentId, message: { role: 'user', content: 'hi' } }),
  error: (id: string, parentId: string, errorMessage = '503: {"message":"service unavailable","type":"server_error"}') =>
    line({ type: 'message', id, parentId, message: { role: 'assistant', content: [], stopReason: 'error', errorMessage } }),
  aborted: (id: string, parentId: string) =>
    line({ type: 'message', id, parentId, message: { role: 'assistant', content: [], stopReason: 'aborted', errorMessage: 'Operation aborted' } }),
  ok: (id: string, parentId: string) =>
    line({ type: 'message', id, parentId, message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }], stopReason: 'stop' } }),
  tombstone: (id: string, targetId: string) => line({ type: 'context_edit', id, parentId: targetId, targetId, replacement: null })
};

export function piFixture(): ApiErrorFailureFixture {
  let file = '';
  return {
    prepare() {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-api-error-')));
      const dir = join(root, '--work--');
      mkdirSync(dir, { recursive: true });
      file = join(dir, `2026-11-24T20-03-36-004Z_${PI_FIXTURE_ID}.jsonl`);
      writeFileSync(file, piRows.header());
      const previous = process.env.PI_CODING_AGENT_SESSION_DIR;
      process.env.PI_CODING_AGENT_SESSION_DIR = root;
      return {
        session: { id: 'pty-1', cwd: '/work', createdAt: Date.now(), nativeConversationId: PI_FIXTURE_ID },
        cleanup: () => { if (previous === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR; else process.env.PI_CODING_AGENT_SESSION_DIR = previous; }
      };
    },
    appendFailedTurn() {
      appendFileSync(file, piRows.user('u1', 'h') + piRows.error('a1', 'u1'));
    },
    appendSuccessfulTurn() {
      appendFileSync(file, piRows.user('u1', 'h') + piRows.ok('a1', 'u1'));
    }
  };
}
