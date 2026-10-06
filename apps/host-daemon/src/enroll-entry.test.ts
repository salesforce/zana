import { afterEach, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  readEnrollToken: vi.fn(() => 'enroll-token'),
  startEnrolledHostDaemon: vi.fn(async () => ({ hostId: 'host-1', close: vi.fn(async () => {}) }))
}));

vi.mock('./enroll-runtime.js', () => deps);
vi.mock('./host-config.js', () => ({ resolveZccDataDir: () => '/test/data' }));
vi.mock('./server-url.js', () => ({ joinServerUrl: (url: string, path: string) => new URL(path, url).href }));

const previousCredential = process.env.ZCC_PRODUCT_SERVER_CREDENTIAL;
const previousServerUrl = process.env.ZCC_SERVER_URL;

afterEach(() => {
  if (previousCredential === undefined) delete process.env.ZCC_PRODUCT_SERVER_CREDENTIAL;
  else process.env.ZCC_PRODUCT_SERVER_CREDENTIAL = previousCredential;
  if (previousServerUrl === undefined) delete process.env.ZCC_SERVER_URL;
  else process.env.ZCC_SERVER_URL = previousServerUrl;
  vi.unstubAllGlobals();
});

it('drops the desktop credential before checking health or enrolling the daemon', async () => {
  process.env.ZCC_PRODUCT_SERVER_CREDENTIAL = 'desktop-only-secret';
  process.env.ZCC_SERVER_URL = 'http://127.0.0.1:8781/';
  const fetch = vi.fn(async () => {
    expect(process.env.ZCC_PRODUCT_SERVER_CREDENTIAL).toBeUndefined();
    return { ok: true };
  });
  vi.stubGlobal('fetch', fetch);
  deps.startEnrolledHostDaemon.mockImplementationOnce(async () => {
    expect(process.env.ZCC_PRODUCT_SERVER_CREDENTIAL).toBeUndefined();
    return { hostId: 'host-1', close: vi.fn(async () => {}) };
  });

  await import('./enroll-entry.js');

  expect(fetch).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:8781/api/v1/health');
  expect(deps.readEnrollToken).toHaveBeenCalledExactlyOnceWith('/test/data');
  expect(deps.startEnrolledHostDaemon).toHaveBeenCalledExactlyOnceWith({
    dataDir: '/test/data', serverUrl: 'http://127.0.0.1:8781/', token: 'enroll-token'
  });
});
