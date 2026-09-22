import { URL } from 'whatwg-url-minimum';
import { normalizeServerUrl } from './urls';
export interface ServerProfile {
  id: string;
  label: string;
  serverUrl: string;
  credential?: string;
  deviceId?: string;
  pushEnabled?: boolean;
}
export interface MobileState {
  profiles: ServerProfile[];
  activeId: string | null;
  haptics: boolean;
  appearance: 'system' | 'light' | 'dark';
}
export const EMPTY_STATE: MobileState = {
  profiles: [],
  activeId: null,
  haptics: true,
  appearance: 'system'
};
export interface SecureStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
}
const KEY = 'zana.mobile.profiles.v1';
export function parseMobileState(raw: string | null): MobileState {
  if (!raw) return { ...EMPTY_STATE, profiles: [] };
  if (raw.length > 16_384) throw new Error('Saved servers are invalid.');
  const state = JSON.parse(raw) as MobileState;
  if (
    !Array.isArray(state.profiles) ||
    state.profiles.length > 12 ||
    typeof state.haptics !== 'boolean' ||
    !['system', 'light', 'dark'].includes(state.appearance)
  )
    throw new Error('Saved servers are invalid.');
  for (const p of state.profiles) {
    if (
      typeof p.id !== 'string' ||
      !/^[\w-]{1,64}$/.test(p.id) ||
      typeof p.label !== 'string' ||
      p.label.length > 80 ||
      normalizeServerUrl(p.serverUrl) !== p.serverUrl ||
      (p.credential !== undefined && !/^[\w-]{43}$/.test(p.credential))
    )
      throw new Error('Saved server is invalid.');
  }
  if (
    new Set(state.profiles.map((p) => p.id)).size !== state.profiles.length ||
    (state.activeId !== null && !state.profiles.some((p) => p.id === state.activeId))
  )
    throw new Error('Saved server selection is invalid.');
  return state;
}
export class ProfileStore {
  private queue: Promise<unknown> = Promise.resolve();
  private state: MobileState = { ...EMPTY_STATE, profiles: [] };
  constructor(private readonly storage: SecureStorage) {}
  async load() {
    this.state = parseMobileState(await this.storage.getItemAsync(KEY));
    return this.state;
  }
  update(change: (state: MobileState) => MobileState): Promise<MobileState> {
    const job = this.queue.then(async () => {
      const next = change(this.state);
      const raw = JSON.stringify(next);
      parseMobileState(raw);
      await this.storage.setItemAsync(KEY, raw);
      this.state = next;
      return next;
    });
    this.queue = job.catch(() => {});
    return job;
  }
}
export function saveProfile(state: MobileState, profile: ServerProfile): MobileState {
  const existing = state.profiles.find((p) => p.serverUrl === profile.serverUrl);
  const next = {
    ...profile,
    id: existing?.id ?? profile.id,
    label: profile.label.trim().slice(0, 80) || new URL(profile.serverUrl).hostname
  };
  return {
    ...state,
    activeId: next.id,
    profiles: existing
      ? state.profiles.map((p) => (p.id === existing.id ? next : p))
      : [...state.profiles, next]
  };
}
export function removeProfile(state: MobileState, id: string): MobileState {
  const profiles = state.profiles.filter((p) => p.id !== id);
  return {
    ...state,
    profiles,
    activeId: state.activeId === id ? (profiles[0]?.id ?? null) : state.activeId
  };
}
