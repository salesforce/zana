import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createConversationThread,
  createPendingInteraction,
  openDatabase,
  upsertHost,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { handleNotificationsApi } from './notifications-api.js';
import type { ProductHttpContext } from './product-context.js';

let db: ZccDatabase;
let dir: string;
let hostId: string;
let config: Partial<AppConfig>;

function request(method: string, body?: unknown, raw?: string): IncomingMessage {
  const payload = raw ?? (body === undefined ? '' : JSON.stringify(body));
  const stream = Readable.from(payload ? [Buffer.from(payload)] : []);
  return Object.assign(stream, { method, headers: { 'content-type': 'application/json' } }) as IncomingMessage;
}

function capture() {
  const captured = { status: 0, body: undefined as unknown };
  const response = Object.assign(new EventEmitter(), {
    writeHead(status: number) {
      captured.status = status;
      return response;
    },
    end(chunk?: string) {
      captured.body = chunk ? JSON.parse(chunk) : undefined;
    },
    setHeader() {},
    getHeader() {
      return undefined;
    }
  });
  return { response: response as unknown as ServerResponse, captured };
}

async function call(method: string, path: string, body?: unknown, raw?: string) {
  const url = new URL(path, 'http://127.0.0.1');
  const { response, captured } = capture();
  const ctx = { db, config: { getConfig: () => config } } as unknown as ProductHttpContext;
  const handled = await handleNotificationsApi(request(method, body, raw), response, ctx, url.pathname, method, url);
  return { handled, status: captured.status, body: captured.body as Record<string, unknown> };
}

function newThread(opts: { parentThreadId?: string; title?: string } = {}): string {
  return createConversationThread(db, { projectId: 'p', hostId, providerId: 'codex', ...opts }).id;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'notifications-api-'));
  db = openDatabase(join(dir, 'db.sqlite'));
  hostId = upsertHost(db, { name: 'test', hostKeyHash: 'h'.repeat(64) }).id;
  config = {};
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('notifications api routing', () => {
  it('ignores paths it does not own', async () => {
    expect((await call('GET', '/api/v1/threads')).handled).toBe(false);
    expect((await call('GET', '/api/v1/threads/thr_x')).handled).toBe(false);
    expect((await call('GET', '/api/v1/projects/p/notification-level')).handled).toBe(false);
  });

  it('rejects unsupported methods', async () => {
    const id = newThread();
    const result = await call('DELETE', `/api/v1/threads/${id}/notification-level`);
    expect(result).toMatchObject({ handled: true, status: 405 });
  });
});

describe('GET / PUT /api/v1/threads/:id/notification-level', () => {
  it('reports the shipped defaults for a new thread', async () => {
    const id = newThread();
    const result = await call('GET', `/api/v1/threads/${id}/notification-level`);
    expect(result).toMatchObject({
      handled: true,
      status: 200,
      body: { threadId: id, own: 'inherit', effective: 'all', source: 'global', defaultLevel: 'all', childLevel: 'input-only' }
    });
  });

  it('stores a level and returns the resolved state', async () => {
    const id = newThread();
    const put = await call('PUT', `/api/v1/threads/${id}/notification-level`, { level: 'muted' });
    expect(put).toMatchObject({ status: 200, body: { own: 'muted', effective: 'muted', source: 'self' } });
    const get = await call('GET', `/api/v1/threads/${id}/notification-level`);
    expect(get.body).toMatchObject({ own: 'muted', effective: 'muted' });
    const cleared = await call('PUT', `/api/v1/threads/${id}/notification-level`, { level: 'inherit' });
    expect(cleared.body).toMatchObject({ own: 'inherit', effective: 'all' });
  });

  it('reflects an ancestor cap and the configured defaults', async () => {
    config = { notificationChildLevel: 'inherit', notificationDefaultLevel: 'input-only' };
    const parent = newThread();
    const child = newThread({ parentThreadId: parent });
    await call('PUT', `/api/v1/threads/${parent}/notification-level`, { level: 'muted' });
    const result = await call('GET', `/api/v1/threads/${child}/notification-level`);
    expect(result.body).toMatchObject({ effective: 'muted', source: 'parent', childLevel: 'inherit' });
  });

  it('returns 404 for an unregistered thread', async () => {
    expect(await call('GET', '/api/v1/threads/thr_missing/notification-level')).toMatchObject({
      status: 404,
      body: { error: 'unknown-thread' }
    });
    expect(await call('PUT', '/api/v1/threads/thr_missing/notification-level', { level: 'muted' })).toMatchObject({
      status: 404
    });
  });

  it('validates the level on the server', async () => {
    const id = newThread();
    for (const body of [{ level: 'loud' }, { level: 7 }, {}, { level: null }]) {
      const result = await call('PUT', `/api/v1/threads/${id}/notification-level`, body);
      expect(result).toMatchObject({ status: 400, body: { error: 'invalid-notification-level' } });
    }
    expect((await call('PUT', `/api/v1/threads/${id}/notification-level`, undefined, '{nope')).status).toBe(400);
    expect((await call('GET', `/api/v1/threads/${id}/notification-level`)).body).toMatchObject({ own: 'inherit' });
  });

  it('rejects an oversized body', async () => {
    const id = newThread();
    const result = await call('PUT', `/api/v1/threads/${id}/notification-level`, { level: 'muted', pad: 'x'.repeat(10_000) });
    expect(result.status).toBe(400);
  });

  it('answers 409 once the override cap is reached', async () => {
    const { MAX_NOTIFICATION_OVERRIDES } = await import('../services/notifications/level-store.js');
    const first = newThread();
    const second = newThread();
    await call('PUT', `/api/v1/threads/${first}/notification-level`, { level: 'muted' });
    // Fill the table with synthetic rows up to the cap, then ask for one more.
    const insert = db.sqlite.prepare(
      'INSERT INTO thread_plugin_metadata (thread_id, plugin_id, metadata_json) VALUES (?, ?, ?)'
    );
    db.transaction(() => {
      for (let i = 1; i < MAX_NOTIFICATION_OVERRIDES; i += 1) {
        const id = newThread();
        insert.run(id, '__thread_notifications__', JSON.stringify({ level: 'muted' }));
      }
    });
    const result = await call('PUT', `/api/v1/threads/${second}/notification-level`, { level: 'muted' });
    expect(result).toMatchObject({ status: 409, body: { error: 'notification-limit' } });
  }, 60_000);
});

describe('GET /api/v1/threads/:id/notification-verdict', () => {
  it('requires a known kind', async () => {
    const id = newThread();
    expect(await call('GET', `/api/v1/threads/${id}/notification-verdict`)).toMatchObject({ status: 400 });
    expect(await call('GET', `/api/v1/threads/${id}/notification-verdict?kind=shout`)).toMatchObject({
      status: 400,
      body: { error: 'invalid-notification-kind' }
    });
  });

  it('returns 404 for an unregistered thread', async () => {
    expect(await call('GET', '/api/v1/threads/thr_missing/notification-verdict?kind=turn-finished')).toMatchObject({
      status: 404,
      body: { error: 'unknown-thread' }
    });
  });

  it('only answers GET', async () => {
    const id = newThread();
    expect((await call('POST', `/api/v1/threads/${id}/notification-verdict?kind=turn-finished`, {})).status).toBe(405);
  });

  it('gates by level and previews the pending question', async () => {
    const id = newThread({ title: 'Release prep' });
    createPendingInteraction(db, {
      originKind: 'provider',
      threadId: id,
      turnId: 'turn-1',
      providerId: 'codex',
      providerThreadId: 'pt-1',
      providerRequestId: 'req-1',
      payload: JSON.stringify({ kind: 'user_question', questions: [{ id: 'q', prompt: 'Ship it?', multiSelect: false, allowFreeText: true }] })
    });
    const url = `/api/v1/threads/${id}/notification-verdict`;
    expect((await call('GET', `${url}?kind=pending-interaction`)).body).toMatchObject({
      send: true,
      title: 'Release prep',
      body: 'Ship it?'
    });
    await call('PUT', `/api/v1/threads/${id}/notification-level`, { level: 'input-only' });
    expect((await call('GET', `${url}?kind=turn-finished`)).body).toMatchObject({ send: false, reason: 'level' });
    expect((await call('GET', `${url}?kind=pending-interaction`)).body).toMatchObject({ send: true });
    await call('PUT', `/api/v1/threads/${id}/notification-level`, { level: 'muted' });
    expect((await call('GET', `${url}?kind=pending-interaction`)).body).toMatchObject({ send: false, level: 'muted' });
  });

  it('omits preview text when previews are disabled', async () => {
    config = { notificationPreviews: false };
    const id = newThread({ title: 'Private' });
    const result = await call('GET', `/api/v1/threads/${id}/notification-verdict?kind=turn-finished`);
    expect(result.body).toMatchObject({ send: true });
    expect(result.body).not.toHaveProperty('title');
  });
});
