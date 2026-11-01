import { type HelpVideoView } from '@zana-ai/zcc-server-contract';
import bundledRevisions from './help-video-baseline.json';
import { HELP_VIDEOS, type HelpVideo } from './help-videos.js';

/** Bundled files stay local when the remote catalogue advertises the same cut. */
export function mergeHelpVideos(remote: HelpVideoView[]): HelpVideo[] {
  const videos: HelpVideo[] = remote.map(video => {
    const bundled = HELP_VIDEOS.find(entry => entry.id === video.id);
    const shipped = (bundledRevisions as Record<string, string>)[video.id];
    return bundled && shipped && shipped === video.revision
      ? { ...video, src: bundled.src, poster: bundled.poster, captions: bundled.captions }
      : video;
  });
  // The shipped basics remain available when a remote entry is removed or incompatible.
  return [...videos, ...HELP_VIDEOS.filter(entry => !videos.some(video => video.id === entry.id))];
}
