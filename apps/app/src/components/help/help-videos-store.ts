import { create } from 'zustand';
import { HELP_VIDEOS } from '../../lib/help-videos.js';
import { readLocalStorageItem, writeLocalStorageItem } from '../../lib/safe-local-storage.js';
import { type HelpVideo } from '../../lib/help-videos.js';
import { type HelpVideoView } from '@zana-ai/zcc-server-contract';
import { mergeHelpVideos } from '../../lib/help-video-catalogue.js';
import { apiJson } from '../../lib/fetch-with-app-surface.js';

export const HELP_VIDEOS_WATCHED_KEY = 'zcc.helpVideos.watched';
/** Fraction of a clip that counts as watched. */
export const WATCHED_RATIO = 0.9;

function readWatched(): string[] {
  try {
    const parsed: unknown = JSON.parse(readLocalStorageItem(HELP_VIDEOS_WATCHED_KEY) ?? '[]');
    // Remote IDs must survive a restart before their catalogue has loaded.
    return Array.isArray(parsed) ? [...new Set(parsed.filter((id): id is string => typeof id === 'string' && /^[a-z0-9-]{1,80}$/.test(id)))].slice(-300) : [];
  } catch {
    return [];
  }
}

interface HelpVideosState {
  videos: readonly HelpVideo[];
  refresh: () => Promise<void>;
  /** The clip shown in the library, or null while it is closed. */
  openId: string | null;
  /** Device-local, like the page-hints preference. */
  watched: string[];
  open: (id?: string) => void;
  close: () => void;
  markWatched: (id: string) => void;
}

export const useHelpVideos = create<HelpVideosState>((set, get) => ({
  videos: HELP_VIDEOS,
  refresh: () => refreshCatalogue(),
  openId: null,
  watched: readWatched(),
  open: (id) => {
    const videos = get().videos;
    set({ openId: id && videos.some(video => video.id === id) ? id : videos[0].id });
    void get().refresh();
  },
  close: () => set({ openId: null }),
  markWatched: (id) => {
    if (!get().videos.some(video => video.id === id) || get().watched.includes(id)) return;
    const watched = [...get().watched, id].slice(-300);
    writeLocalStorageItem(HELP_VIDEOS_WATCHED_KEY, JSON.stringify(watched));
    set({ watched });
  }
}));

let pending: Promise<void> | undefined;
/** The host owns freshness/coalescing; the renderer immediately shows its current list. */
function refreshCatalogue(): Promise<void> {
  if (pending) return pending;
  pending = apiJson<{ videos: HelpVideoView[] }>('/help/videos', { signal: AbortSignal.timeout(7000) })
    .then(({ videos }) => { useHelpVideos.setState({ videos: mergeHelpVideos(videos) }); })
    .catch(() => {})
    .finally(() => { pending = undefined; });
  return pending;
}

/** `timeupdate` handler that marks a clip watched once most of it has played. */
export function trackWatched(id: string) {
  return (event: { currentTarget: HTMLVideoElement }) => {
    const { currentTime, duration } = event.currentTarget;
    if (duration > 0 && currentTime / duration >= WATCHED_RATIO) useHelpVideos.getState().markWatched(id);
  };
}
