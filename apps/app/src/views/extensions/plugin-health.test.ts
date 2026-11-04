import { describe, expect, it } from 'vitest';
import { summarizePluginHealthDetail } from './plugin-health.js';

describe('summarizePluginHealthDetail', () => {
  it('explains a missing jiti loader without dropping the raw error', () => {
    expect(summarizePluginHealthDetail('jiti createJiti is unavailable')).toEqual({
      summary: 'Could not load this TypeScript plugin in the packaged app.',
      technical: 'jiti createJiti is unavailable'
    });
  });

  it('explains a missing packaged module and keeps the Node path', () => {
    const technical =
      "Cannot find module '/App/plugins/docs/src/library-mentions.js' imported from /App/plugins/docs/server.mjs";
    expect(summarizePluginHealthDetail(technical)).toEqual({
      summary: 'A required plugin file is missing. Check the technical details, restore the file, then reload.',
      technical
    });
  });

  it.each([
    "Cannot find module '/checkout/plugins/design-docs/node_modules/@zana-ai/zcc-plugin-sdk/dist/app.js' imported from /checkout/plugins/design-docs/server.mjs",
    "Cannot find package 'some-dependency' imported from /checkout/plugin/server.mjs"
  ])('explains a missing dependency without blaming the app build', (technical) => {
    expect(summarizePluginHealthDetail(technical)).toEqual({
      summary: 'A plugin dependency is missing. Check the technical details, restore the dependency, then reload.',
      technical
    });
  });

  it('uses the first line of an unknown error', () => {
    expect(summarizePluginHealthDetail('RPC failed\nstack')).toEqual({
      summary: 'RPC failed',
      technical: 'RPC failed\nstack'
    });
  });

  it('returns empty copy when there is no detail', () => {
    expect(summarizePluginHealthDetail(null)).toEqual({ summary: '', technical: '' });
  });
});
