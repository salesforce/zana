import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createProductHttpContext, type ProductHttpContext } from './product-context.js';
import { signUiSend } from './ui-send-proof.js';

const secret = 'desktop-only-boot-secret-of-at-least-32-bytes';
let ctx: ProductHttpContext | undefined;
let dataDir: string | undefined;

afterEach(() => {
  if (ctx) {
    ctx.hostHub.close();
    ctx.dispose();
    ctx.db.close();
    ctx = undefined;
  }
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = undefined;
});

it.each([
  { name: 'absent', secret: undefined },
  { name: 'short', secret: 'x'.repeat(31) }
])('fails closed when UI send secret is $name', ({ secret: uiSendSecret }) => {
  dataDir = mkdtempSync(join(tmpdir(), 'zcc-ui-send-context-'));
  ctx = createProductHttpContext({ dataDir, origins: { serverPort: 0 }, uiSendSecret });
  expect(ctx.verifyUiSend(signUiSend(secret, 'thread', 'item'), 'thread', 'item')).toBe(false);
});

it('accepts only signed, single-use UI sends with a configured boot secret', () => {
  dataDir = mkdtempSync(join(tmpdir(), 'zcc-ui-send-context-'));
  ctx = createProductHttpContext({ dataDir, origins: { serverPort: 0 }, uiSendSecret: secret });
  const proof = signUiSend(secret, 'thread', 'item');
  expect(ctx.verifyUiSend(proof, 'thread', 'other-item')).toBe(false);
  expect(ctx.verifyUiSend(proof, 'thread', 'item')).toBe(true);
  expect(ctx.verifyUiSend(proof, 'thread', 'item')).toBe(false);
});
