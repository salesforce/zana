import { create } from 'zustand';

export const useConversationHistory = create<{
  scope: { projectId?: string; tab: 'threads' | 'cli' } | null;
  open(projectId?: string, tab?: 'threads' | 'cli'): void;
  close(): void;
}>((set) => ({
  scope: null,
  open: (projectId, tab = 'threads') => set({ scope: { projectId, tab } }),
  close: () => set({ scope: null })
}));
