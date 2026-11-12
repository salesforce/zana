import { NamedCheckScopeSchema } from '@zana-ai/zcc-contracts/project-settings';
import type { ProjectSettingsStore } from './project-settings-store.js';

export function listCheckNames(store: ProjectSettingsStore, projectId: string): string[] {
  NamedCheckScopeSchema.parse({ kind: 'project', projectId });
  return [...new Set([
    ...store.getNamedChecks({ kind: 'global' }).map((check) => check.name),
    ...store.getNamedChecks({ kind: 'project', projectId }).map((check) => check.name)
  ])].sort();
}

export function resolveNamedCheck(store: ProjectSettingsStore, projectId: string, reference: string) {
  NamedCheckScopeSchema.parse({ kind: 'project', projectId });
  const match = /^check:([A-Za-z_][A-Za-z0-9_-]{0,99})$/.exec(reference);
  if (!match) throw new Error('Invalid check reference; expected check:<name>');
  const name = match[1];
  const check = store.getNamedChecks({ kind: 'project', projectId }).find((entry) => entry.name === name)
    ?? store.getNamedChecks({ kind: 'global' }).find((entry) => entry.name === name);
  if (!check) throw new Error(`Unknown check: ${name}`);
  return check;
}

/** Agent-facing discovery contains no command text and no mutation methods. */
export function createNamedCheckDiscovery(store: ProjectSettingsStore) {
  return { listNames: (projectId: string) => listCheckNames(store, projectId) };
}
