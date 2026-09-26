import { afterEach, expect, it, vi } from 'vitest';
import { product } from '../product-client.js';

afterEach(() => vi.unstubAllGlobals());

it.each([
  ['audio/mp4', 'recording.mp4'],
  ['audio/mp4;codecs=mp4a.40.2', 'recording.mp4'],
  ['audio/ogg', 'recording.ogg'],
  ['audio/webm;codecs=opus', 'recording.webm']
])('preserves %s audio format through the voice HTTP upload', async (mime, filename) => {
  const fetchMock = vi.fn(async () => Response.json({ text: ' Hello from voice ' }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(product.voice.transcribe(btoa('synthetic-audio'), mime)).resolves.toMatchObject({ ok: true, text: 'Hello from voice' });
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('/api/v1/system/voice-transcription');
  const file = (init.body as FormData).get('file') as File;
  expect(file.name).toBe(filename);
  expect(file.type).toBe(mime);
  expect(await file.text()).toBe('synthetic-audio');
});

it('keeps actionable host errors in the voice result', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ message: 'Unlock Keychain on your Mac.' }, { status: 503 })));
  await expect(product.voice.transcribe(btoa('audio'), 'audio/mp4')).resolves.toMatchObject({ ok: false, text: '', error: 'Unlock Keychain on your Mac.' });
});
