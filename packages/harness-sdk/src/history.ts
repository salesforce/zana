/** Native history receives only host-authorized project paths, never renderer paths. */
export interface HarnessHistoryScope {
  readonly projectPath: string;
  readonly signal: AbortSignal;
}

export interface HarnessHistoryConversation {
  readonly id: string;
  readonly title: string;
  readonly lastActiveAt: number | null;
}

export interface HarnessHistoryTranscript {
  messages: Array<{ role: 'user' | 'assistant'; text: string }>;
  truncated: boolean;
  unavailableReason?: string;
}

export interface HarnessHistoryAdapter {
  list(input: HarnessHistoryScope & { readonly limit: number }): Promise<readonly HarnessHistoryConversation[]>;
  /** Re-read native identity/project membership before exact resume, even without a preview. */
  validateConversation(input: HarnessHistoryScope & { readonly id: string }): Promise<boolean>;
  /** Omit when the native store cannot provide a trustworthy text preview. */
  readTranscript?(input: HarnessHistoryScope & { readonly id: string }): Promise<HarnessHistoryTranscript>;
}
