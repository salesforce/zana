import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' }, isolateBundledCatalog: true });

test('35MB prompt attachments survive the composer and production HTTP boundary', async ({ app }) => {
  test.setTimeout(180_000);
  const { window, home } = app;
  const root = join(home, 'attachment-project');
  mkdirSync(root);
  const { projectId, threadId } = await window.evaluate(async (path) => {
    const added = await window.cc.projects.add(path);
    if (!added.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: added.value.id, providerId: 'fake', input: 'Attachment check' })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return { projectId: added.value.id, threadId: (body.thread ?? body.value).id as string };
  }, root);
  await window.evaluate((id) => {
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);
  const input = window.getByTestId('thread-command-input');
  await expect(input).toBeVisible();
  // A real PNG padded to the exact limit exercises clipboard admission, upload,
  // multipart framing and stored attachment rendering without a large fixture.
  await input.evaluate((element) => {
    const png = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=');
    const bytes = new Uint8Array(35 * 1024 * 1024);
    for (let i = 0; i < png.length; i++) bytes[i] = png.charCodeAt(i);
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'limit.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  const thumb = window.locator('.composer-image-thumbs').getByRole('img', { name: 'limit.png' });
  await expect(thumb).toBeVisible();
  await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await input.fill('Inspect this attachment');
  await input.press('Enter');
  await expect(window.locator('.composer-image-thumbs')).toHaveCount(0);
  // Large uploads can evict CDP response bodies; inspect the actual rendered
  // attachment instead of relying on the inspector's response-body cache.
  const storedImage = window.getByRole('img', { name: /^limit-.*\.png$/ }).first();
  await expect(storedImage).toBeVisible();
  await expect.poll(() => storedImage
    .evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  const imagePath = (await storedImage.getAttribute('alt'))!;

  const files = await window.evaluate(async ({ projectId, imagePath }) => {
    const url = `/api/v1/projects/${projectId}/attachments`;
    const imageResponse = await fetch(`${url}/content?path=${encodeURIComponent(imagePath)}`);
    const imageSize = (await imageResponse.arrayBuffer()).byteLength;
    const bytes = new Uint8Array(35 * 1024 * 1024);
    bytes[0] = 23;
    bytes[bytes.length - 1] = 42;
    const form = new FormData();
    form.set('file', new File([bytes], 'limit.pdf', { type: 'application/pdf' }));
    const accepted = await fetch(url, { method: 'POST', body: form });
    const file = await accepted.json();
    const content = new Uint8Array(await (await fetch(`${url}/content?path=${encodeURIComponent(file.path)}`)).arrayBuffer());
    const large = new FormData();
    large.set('file', new File([bytes, new Uint8Array(1)], 'over.pdf', { type: 'application/pdf' }));
    const rejected = await fetch(url, { method: 'POST', body: large });
    return {
      imageSize, accepted: accepted.status, file,
      size: content.length, first: content[0], last: content[content.length - 1],
      rejected: rejected.status, error: await rejected.json()
    };
  }, { projectId, imagePath });
  expect(files).toMatchObject({
    imageSize: 35 * 1024 * 1024, accepted: 201,
    file: { type: 'localFile', sizeBytes: 35 * 1024 * 1024 },
    size: 35 * 1024 * 1024, first: 23, last: 42,
    rejected: 400, error: { message: 'over.pdf exceeds the 35MB attachment limit' }
  });
});
