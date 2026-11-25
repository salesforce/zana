import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApiErrorFailureFixture } from './api-error-fixture-types.js';

const CODEX_ID = '01a208f1-78be-76e1-8a80-e6ab2ee3a6d6';

export function codexFixture(): ApiErrorFailureFixture {
  let file = '';
  const line = (value: unknown) => `${JSON.stringify(value)}\n`;
  const started = (n: number) => line({ type: 'event_msg', payload: { type: 'task_started', turn_id: `t${n}` } });
  return {
    prepare() {
      const home = realpathSync(mkdtempSync(join(tmpdir(), 'api-error-fixture-')));
      const dir = join(home, 'sessions', '2026', '11', '23');
      mkdirSync(dir, { recursive: true });
      file = join(dir, `rollout-2026-11-23T10-06-12-${CODEX_ID}.jsonl`);
      writeFileSync(file, line({ type: 'session_meta', payload: { id: CODEX_ID, cwd: '/work' } }));
      const previous = process.env.CODEX_HOME;
      process.env.CODEX_HOME = home;
      return {
        session: { id: 'pty-1', cwd: '/work', createdAt: Date.now(), codexSessionId: CODEX_ID },
        cleanup: () => { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous; }
      };
    },
    appendFailedTurn() {
      appendFileSync(file, started(1) + line({
        type: 'event_msg',
        payload: { type: 'task_complete', turn_id: 't1', error: { message: 'Selected model is at capacity.', codex_error_info: 'server_overloaded' } }
      }));
    },
    appendSuccessfulTurn() {
      appendFileSync(file, started(1) + line({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 't1', last_agent_message: 'done' } }));
    }
  };
}
