import { create } from 'zustand';
import { HELP_VIDEOS } from '../../lib/help-videos.js';
import { readLocalStorageItem, writeLocalStorageItem } from '../../lib/safe-local-storage.js';

export const HELP_VIDEOS_WATCHED_KEY = 'zcc.helpVideos.watched';
/** Fraction of a clip that counts as watched. */
export const WATCHED_RATIO = 0.9;

const knownIds = new Set(HELP_VIDEOS.map((video) => video.id));

function readWatched(): string[] {
  try {
    const parsed: unknown = JSON.parse(readLocalStorageItem(HELP_VIDEOS_WATCHED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string' && knownIds.has(id)) : [];
  } catch {
    return [];
  }
}

interface HelpVideosState {
  /** The clip shown in the library, or null while it is closed. */
  openId: string | null;
  /** Device-local, like the page-hints preference. */
  watched: string[];
  open: (id?: string) => void;
  close: () => void;
  markWatched: (id: string) => void;
}

export const useHelpVideos = create<HelpVideosState>((set, get) => ({
  openId: null,
  watched: readWatched(),
  open: (id) => set({ openId: id && knownIds.has(id) ? id : HELP_VIDEOS[0].id }),
  close: () => set({ openId: null }),
  markWatched: (id) => {
    if (!knownIds.has(id) || get().watched.includes(id)) return;
    const watched = [...get().watched, id];
    writeLocalStorageItem(HELP_VIDEOS_WATCHED_KEY, JSON.stringify(watched));
    set({ watched });
  }
}));

/** `timeupdate` handler that marks a clip watched once most of it has played. */
export function trackWatched(id: string) {
  return (event: { currentTarget: HTMLVideoElement }) => {
    const { currentTime, duration } = event.currentTarget;
    if (duration > 0 && currentTime / duration >= WATCHED_RATIO) useHelpVideos.getState().markWatched(id);
  };
}
