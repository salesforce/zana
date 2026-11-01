import { spawnSync } from 'node:child_process';
import { test, expect } from './fixtures/app.js';

test('built Electron serves the complete machine installer without source assets', async ({ app }) => {
  const origin = new URL(app.window.url()).origin;
  const response = await app.window.request.get(`${origin}/install.sh`, { timeout: 10_000 });
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/x-shellscript');
  expect(response.headers()['cache-control']).toBe('no-store');
  const script = await response.text();
  expect(script.startsWith('#!/bin/sh')).toBe(true);
  expect(script).toContain('--join-code');
  expect(script).toContain('--host-daemon-port');
  expect(script).toContain('export ZCC_PROJECT_CATALOGUE_DATA_DIR');
  expect(script).toContain('<key>ZCC_PROJECT_CATALOGUE_DATA_DIR</key>');
  expect(script).toContain('Environment=ZCC_PROJECT_CATALOGUE_DATA_DIR=');
  expect(Buffer.byteLength(script)).toBe(Number(response.headers()['content-length']));
  const syntax = spawnSync('/bin/sh', ['-n'], { input: script, encoding: 'utf8' });
  expect(syntax.status, syntax.stderr).toBe(0);
  const head = await app.window.request.head(`${origin}/install.sh`, { timeout: 10_000 });
  expect(head.status()).toBe(200);
  expect(head.headers()['content-length']).toBe(response.headers()['content-length']);
  expect(await head.body()).toHaveLength(0);
});
