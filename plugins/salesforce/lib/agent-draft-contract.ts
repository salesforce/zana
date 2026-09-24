export interface AgentDraftInput { name: string; apiName: string; purpose?: string; source?: string }
export interface CreatedAgentDraft { path: string; metadataPath: string; projectRoot: string; apiName: string; sha256: string }

export function suggestedAgentName(label: string): string {
  return label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^[_0-9]+|_+$/g, '').slice(0, 80);
}

