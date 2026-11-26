import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { captureHtmlRoutes, type GoldenDeps, type GoldenSnapshot } from './html-golden.fixture.js';
import { createPageRoutes, NO_KIT } from './pages.js';
import { DesignDocStore } from './store.js';
import { createTestDatabase } from './test-db.js';

const golden = JSON.parse(readFileSync(new URL('./__golden__/html-routes.json', import.meta.url), 'utf8')) as GoldenSnapshot;

describe('HTML routes are unchanged by markdown pages', () => {
  const actual = captureHtmlRoutes({
    createPageRoutes: createPageRoutes as unknown as GoldenDeps['createPageRoutes'],
    NO_KIT,
    store: new DesignDocStore(createTestDatabase()) as unknown as GoldenDeps['store']
  });

  it('covers every captured route', () => {
    expect(Object.keys(actual).sort()).toEqual(Object.keys(golden).sort());
  });

  it.each(Object.keys(golden))('matches the pre-change response for %s', (name) => {
    expect(actual[name]).toEqual(golden[name]);
  });
});
