import { describe, expect, it } from 'vitest';
import type { PluginProjectTabRegistration } from '@zana-ai/zcc-plugin-sdk/app';
import { isCloseWindowShortcut, pluginViewDocumentTitle, pluginViewTitleContext, resolvePluginViewState } from './plugin-view-state.js';

const target = { pluginId: 'salesforce', tabId: 'studio', projectId: 'p-1' };
const tab = (extra: Partial<PluginProjectTabRegistration> = {}) =>
  ({ id: 'studio', pluginId: 'salesforce', generation: 1, label: 'Studio', component: () => null, ...extra }) as PluginProjectTabRegistration;
const base = { target, appsReady: true, projectsLoaded: true, hasProject: true };

describe('resolvePluginViewState', () => {
  it('shows a detachable tab', () => {
    const ready = tab({ detachable: true });
    expect(resolvePluginViewState({ ...base, tabs: [ready] })).toEqual({ kind: 'ready', tab: ready });
  });

  it('refuses a tab that did not opt in', () => {
    const plain = tab();
    expect(resolvePluginViewState({ ...base, tabs: [plain] })).toEqual({ kind: 'not-detachable', tab: plain });
  });

  it('reports a project that is gone before anything else', () => {
    expect(resolvePluginViewState({ ...base, hasProject: false, tabs: [tab({ detachable: true })] })).toEqual({ kind: 'missing-project' });
  });

  it('waits while projects or plugin apps are still loading', () => {
    expect(resolvePluginViewState({ ...base, appsReady: false, tabs: [] })).toEqual({ kind: 'loading' });
    expect(resolvePluginViewState({ ...base, projectsLoaded: false, hasProject: false, tabs: [] })).toEqual({ kind: 'loading' });
    expect(resolvePluginViewState({ ...base, projectsLoaded: false, hasProject: false, tabs: [tab({ detachable: true })] })).toEqual({ kind: 'loading' });
  });

  it('reports a missing tab once everything has loaded', () => {
    expect(resolvePluginViewState({ ...base, tabs: [] })).toEqual({ kind: 'missing-tab' });
    expect(resolvePluginViewState({ ...base, tabs: [tab({ pluginId: 'other', detachable: true })] })).toEqual({ kind: 'missing-tab' });
    expect(resolvePluginViewState({ ...base, tabs: [tab({ id: 'other', detachable: true })] })).toEqual({ kind: 'missing-tab' });
  });
});

describe('pluginViewDocumentTitle', () => {
  it('leads with the project, then the tab', () => {
    expect(pluginViewDocumentTitle('Studio', 'Acme', 'Zana')).toBe('Acme · Studio — Zana');
  });

  it('drops blank parts', () => {
    expect(pluginViewDocumentTitle('Studio', ' ', 'Zana')).toBe('Studio — Zana');
    expect(pluginViewDocumentTitle(undefined, 'Acme', 'Zana')).toBe('Acme — Zana');
    expect(pluginViewDocumentTitle(undefined, undefined, 'Zana')).toBe('Zana');
  });

  it("leads with the plugin's badge and title, then the project and its detail", () => {
    const custom = { title: 'Agentforce · Help', detail: 'prod', badge: 'Production', tone: 'danger' as const };
    expect(pluginViewDocumentTitle('Studio', 'Acme', 'Zana', custom)).toBe('Production · Agentforce · Help — Acme · prod — Zana');
    expect(pluginViewDocumentTitle('Studio', 'Acme', 'Zana', { title: 'Agentforce', tone: 'neutral' })).toBe('Agentforce — Acme — Zana');
    expect(pluginViewDocumentTitle('Studio', undefined, 'Zana', { title: 'Agentforce', tone: 'neutral' })).toBe('Agentforce — Zana');
    expect(pluginViewDocumentTitle('Studio', 'Acme', 'Zana', null)).toBe('Acme · Studio — Zana');
  });
});

describe('pluginViewTitleContext', () => {
  it('follows the project with the detail', () => {
    expect(pluginViewTitleContext('Acme', { title: 'T', detail: 'prod', tone: 'neutral' })).toBe('Acme · prod');
    expect(pluginViewTitleContext(undefined, { title: 'T', detail: 'prod', tone: 'neutral' })).toBe('prod');
    expect(pluginViewTitleContext('Acme', null)).toBe('Acme');
    expect(pluginViewTitleContext(undefined)).toBe('');
  });
});

describe('isCloseWindowShortcut', () => {
  const key = (extra: Partial<KeyboardEvent> = {}) => ({ key: 'w', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...extra });

  it('takes the platform close chord only', () => {
    expect(isCloseWindowShortcut(key({ metaKey: true }), 'macos')).toBe(true);
    expect(isCloseWindowShortcut(key({ key: 'W', metaKey: true }), 'macos')).toBe(true);
    expect(isCloseWindowShortcut(key({ ctrlKey: true }), 'other')).toBe(true);
    expect(isCloseWindowShortcut(key({ ctrlKey: true }), 'macos')).toBe(false);
    expect(isCloseWindowShortcut(key({ metaKey: true }), 'other')).toBe(false);
  });

  it('leaves other chords and keys alone', () => {
    expect(isCloseWindowShortcut(key({ metaKey: true, shiftKey: true }), 'macos')).toBe(false);
    expect(isCloseWindowShortcut(key({ metaKey: true, altKey: true }), 'macos')).toBe(false);
    expect(isCloseWindowShortcut(key({ metaKey: true, ctrlKey: true }), 'macos')).toBe(false);
    expect(isCloseWindowShortcut(key({ key: 'q', metaKey: true }), 'macos')).toBe(false);
    expect(isCloseWindowShortcut(key(), 'macos')).toBe(false);
  });
});
