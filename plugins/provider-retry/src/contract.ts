export interface ProviderRetryView {
  threadId: string;
  providerId: string;
  retryAtMs: number | null;
}

export const providerRetryRpcMethods = {
  providerRetryCancel: "providerRetryCancel",
  providerRetryStatus: "providerRetryStatus",
} as const;
