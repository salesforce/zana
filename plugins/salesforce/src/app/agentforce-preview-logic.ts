export type PreviewMode = 'simulate' | 'live';

export interface PreviewTurn {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
}

export function normalizePreviewMode(value: unknown): PreviewMode {
  return value === 'live' ? 'live' : 'simulate';
}

export function previewStartDisabled(busy: boolean, hasTarget: boolean, sessionId: string | null): boolean {
  return busy || !hasTarget || Boolean(sessionId);
}

export function previewSendDisabled(busy: boolean, sessionId: string | null, utterance: string): boolean {
  return busy || !sessionId || !utterance.trim();
}

export function previewEndDisabled(busy: boolean, sessionId: string | null): boolean {
  return busy || !sessionId;
}

export function appendPreviewTurn(turns: readonly PreviewTurn[], turn: PreviewTurn): PreviewTurn[] {
  return [...turns, turn].slice(-80);
}

export function previewErrorMessage(result: { error?: string; code?: string } | null | undefined): string {
  if (!result?.error) return 'Preview failed.';
  return result.error;
}
