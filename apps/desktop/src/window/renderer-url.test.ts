import { describe, expect, it } from 'vitest';
import { isTrustedRendererUrl, productServerUrl, rendererUrl, setProductionRendererOrigin } from './renderer-url.js';

describe('renderer URL policy', () => {
  it('builds scoped loopback UI URLs and rejects external navigation', () => {
    setProductionRendererOrigin('http://127.0.0.1:43123/');
    expect(rendererUrl({ projectId: 'project id', surface: 'popover' })).toBe(
      'http://127.0.0.1:43123/?projectId=project+id&surface=popover'
    );
    expect(isTrustedRendererUrl('http://127.0.0.1:43123/settings')).toBe(true);
    expect(isTrustedRendererUrl('http://localhost:43123/')).toBe(false);
    expect(isTrustedRendererUrl('https://example.com/')).toBe(false);
    expect(productServerUrl()).toBe('http://127.0.0.1:43123/');
  });
});
