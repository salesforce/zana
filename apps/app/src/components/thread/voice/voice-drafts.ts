const KEY = 'zcc:voice-drafts:v1';
const drafts = new Map<string, string>();
const listeners = new Set<() => void>();
let hydrated = false;
function read() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw || raw.length > 256_000) return;
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) for (const pair of parsed.slice(-20)) {
      if (Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string' && pair[1].length <= 12_000) drafts.set(pair[0], pair[1]);
    }
  } catch { /* memory fallback */ }
}
function persist() {
  while (drafts.size > 20) drafts.delete(drafts.keys().next().value!);
  try { localStorage.setItem(KEY, JSON.stringify([...drafts])); } catch { /* memory fallback */ }
  for (const listener of listeners) listener();
}
export function subscribeVoiceDrafts(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function appendVoiceDraft(owner: string, text: string) {
  read();
  drafts.set(owner, [drafts.get(owner), text].filter(Boolean).join(' ').slice(-12_000));
  persist();
}
export function voiceDraft(owner: string) { read(); return drafts.get(owner) ?? ''; }
export function consumeVoiceDraft(owner: string, expected: string) {
  read();
  if (drafts.get(owner) !== expected) return;
  drafts.delete(owner); persist();
}
