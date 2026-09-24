import { FolderOpen } from 'lucide-react';
import { fallbackProviderOption } from '../thread/pickers/fallback-models.js';
import { ProviderIcon } from '../thread/pickers/ProviderIcon.js';

export function HistoryContext({ harnessId, harnessName, projectName }: { harnessId: string; harnessName?: string; projectName?: string }) {
  const providerId = harnessId === 'claude' ? 'claude-code' : harnessId === 'opencode' ? 'acp-opencode' : harnessId;
  const harness = harnessName || fallbackProviderOption(providerId).displayName;
  const project = projectName || 'Unknown project';

  return <span className="history-context">
    <span className="history-context-field" title={`Harness: ${harness}`}>
      <span className="history-context-icon" aria-hidden="true"><ProviderIcon providerId={providerId} size={14} className="history-harness-icon" /></span>
      <span className="history-context-value">{harness}</span>
    </span>
    <span className="history-context-field" title={`Project: ${project}`}>
      <FolderOpen size={14} aria-hidden="true" />
      <span className="history-context-value">{project}</span>
    </span>
  </span>;
}
