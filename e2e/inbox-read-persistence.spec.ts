/**
 * Production-boundary: inbox read markers survive quit/relaunch when the
 * loopback static host binds a new ephemeral port (origin-scoped localStorage
 * would otherwise reset).
 */
import { test, expect } from './fixtures/app.js';
import { launchApp } from './fixtures/app.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function inboxDir(home: string): string {
  return join(home, '.zcc', 'inbox');
}

function seedInbox(home: string, ids: string[]): void {
  const dir = inboxDir(home);
  mkdirSync(dir, { recursive: true });
  const lines = ids.map((id, i) =>
    JSON.stringify({
      id,
      ts: Date.now() + i,
      projectId: 'proj-e2e',
      comments: `entry ${id}`,
      report: true
    })
  );
  writeFileSync(join(dir, 'entries.jsonl'), `${lines.join('\n')}\n`);
}

async function windowOrigin(app: import('./fixtures/app.js').AppHandle): Promise<string> {
  return app.window.evaluate(() => window.location.origin);
}

test('inbox read state survives relaunch with a new loopback origin', async ({ home }) => {
  const keep = 'keep-read';
  const drop = 'drop-read';
  seedInbox(home, [keep, drop]);
  const app = await launchApp(home);

  try {
    await expect
      .poll(async () => {
        const history = await app.window.evaluate(async () => window.cc.inbox.history({ limit: 50 }));
        return history.entries.map((e) => e.id).sort();
      })
      .toEqual([drop, keep].sort());

    await app.window.evaluate(async ({ keepId, dropId }) => {
      await window.cc.inbox.markRead(keepId);
      await window.cc.inbox.markRead(dropId);
      await window.cc.inbox.delete(dropId);
    }, { keepId: keep, dropId: drop });

    const firstOrigin = await windowOrigin(app);
    expect(firstOrigin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const entriesFile = join(inboxDir(home), 'entries.jsonl');
    const readFile = join(inboxDir(home), 'read-state.json');
    expect(existsSync(entriesFile)).toBe(true);
    await expect
      .poll(() => {
        if (!existsSync(readFile)) return false;
        const body = JSON.parse(readFileSync(readFile, 'utf8')) as { readIds: Record<string, true> };
        return body.readIds[keep] === true && body.readIds[drop] === undefined;
      })
      .toBe(true);

  const appClosed = app.electron.waitForEvent('close');
  await app.electron.evaluate(({ app: electronApp }) => electronApp.quit());
  await appClosed;

  const relaunched = await launchApp(home);
  try {
    const secondOrigin = await relaunched.window.evaluate(() => window.location.origin);
    if (secondOrigin === firstOrigin) {
      const retryClosed = relaunched.electron.waitForEvent('close');
      await relaunched.electron.evaluate(({ app: electronApp }) => electronApp.quit());
      await retryClosed;
      const retried = await launchApp(home);
      try {
        const retryOrigin = await retried.window.evaluate(() => window.location.origin);
        if (retryOrigin === firstOrigin) {
          test.skip(true, `loopback port collided twice (${firstOrigin})`);
        }
        await assertPersisted(retried, keep);
      } finally {
        await retried.electron.close();
      }
      return;
    }
    await assertPersisted(relaunched, keep);
    expect(existsSync(join(inboxDir(home), 'entries.jsonl'))).toBe(true);
    expect(existsSync(join(inboxDir(home), 'read-state.json'))).toBe(true);
  } finally {
    await relaunched.electron.close();
  }
  } finally {
    try {
      await app.electron.close();
    } catch {
      /* already quit */
    }
  }
});

async function assertPersisted(
  handle: import('./fixtures/app.js').AppHandle,
  keepId: string
): Promise<void> {
  await expect
    .poll(async () => {
      const state = await handle.window.evaluate(async () => window.cc.inbox.getReadState());
      return state.readIds[keepId] === true;
    })
    .toBe(true);
}
