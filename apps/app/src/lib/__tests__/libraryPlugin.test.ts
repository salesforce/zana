import { describe, expect, it } from 'vitest';
import type { AppModule } from '@zana-ai/zcc-extension-sdk/renderer';
import {
  isLibraryPluginModule,
  LEGACY_LIBRARY_WORKSPACE_MODE,
  resolveProjectTabModule
} from '../libraryPlugin.js';

const panel = (() => null) as unknown as AppModule['panel'];

function mod(over: Partial<AppModule>): AppModule {
  return { id: 'x', title: 'X', icon: 'Box', panel, ...over };
}

describe('library plugin workspace alias', () => {
  const docs = mod({
    id: 'docs-plugin',
    title: 'Docs',
    icon: 'Library',
    projectTab: { label: 'Library', icon: 'Library' }
  });
  const other = mod({
    id: 'other',
    title: 'Other',
    icon: 'Ticket',
    projectTab: { label: 'Tickets', icon: 'Ticket' }
  });

  it('recognises the Library-icon module without naming its id', () => {
    expect(isLibraryPluginModule(docs)).toBe(true);
    expect(isLibraryPluginModule(other)).toBe(false);
  });

  it('resolves an exact module id first', () => {
    expect(resolveProjectTabModule('other', [docs, other])?.id).toBe('other');
  });

  it('maps the legacy library workspace mode onto the Library plugin', () => {
    expect(LEGACY_LIBRARY_WORKSPACE_MODE).toBe('library');
    expect(resolveProjectTabModule('library', [other, docs])?.id).toBe('docs-plugin');
  });

  it('returns undefined when the Docs plugin is not loaded', () => {
    expect(resolveProjectTabModule('library', [other])).toBeUndefined();
  });
});
