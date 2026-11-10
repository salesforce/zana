import type { ThreadModelCatalogEntry } from '../../components/thread/pickers/thread-model-catalog.js';
import { emptyModelsHint } from '../../components/thread/pickers/harness-login.js';

export function registeredHarnessStatus(input: {
  available?: boolean;
  unavailableReason?: string | null;
  installed?: boolean;
  connected: boolean;
  checking: boolean;
  rosterError?: string | null;
  provisional?: boolean;
  entry?: ThreadModelCatalogEntry;
}): { tone: 'ok' | 'warn' | 'muted'; label: string } {
  if (input.available === false) return { tone: 'warn', label: input.unavailableReason || 'Plugin unavailable. Open its details to recover it.' };
  if (!input.connected) return { tone: 'muted', label: 'Machine disconnected · availability not checked' };
  if (input.installed === false) return { tone: 'warn', label: 'Command-line agent not installed' };
  if (input.entry?.modelLoadError) return {
    tone: 'warn',
    label: `${input.entry.models.length ? 'Previously loaded models · ' : ''}${emptyModelsHint('', input.entry.modelLoadError, input.entry.modelLoadErrorDetail)}`
  };
  if (input.rosterError) return {
    tone: 'warn',
    label: `${input.entry?.models.length ? 'Previously loaded models · ' : ''}Could not check provider availability: ${input.rosterError}`
  };
  if (input.provisional && input.entry?.models.length) return { tone: 'muted', label: 'Previously loaded models · checking availability…' };
  if (input.entry?.models.length) return {
    tone: 'ok',
    label: `${input.entry.models.length} model${input.entry.models.length === 1 ? '' : 's'} available${input.checking ? ' · refreshing…' : ''}`
  };
  if (input.checking) return { tone: 'muted', label: 'Checking model availability…' };
  return { tone: 'muted', label: input.entry ? 'No models returned · check provider setup' : 'Models not loaded yet' };
}
