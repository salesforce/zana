import type { HelpVideo } from '../../lib/help-videos';
import { helpVideoAssetUrl } from '../../lib/help-video-assets';
import { TOUR_VIDEO } from '../components/TourVideo';

export type WalkthroughVideo = {
  id: string;
  title: string;
  description: string;
  chapter: string;
  duration: string;
  details: string;
  src: string;
  poster: string;
  captions: string;
  silent: boolean;
};

const CHAPTERS = [
  ['guided-start', 'First steps'],
  ['how-to-use-a-squad', 'Teamwork'],
  ['zana-everywhere', 'On the go'],
  ['build-an-agentforce-agent', 'Salesforce'],
  ['agentforce-studio-tour', 'Salesforce']
] as const;

/** Keep the introduction focused while using the same live catalogue as Help. */
export function walkthroughVideos(catalogue: HelpVideo[]): WalkthroughVideo[] {
  const overview: WalkthroughVideo = {
    id: 'overview',
    title: 'Meet Zana in 90 seconds',
    description: 'Start a task, follow your agents, and review the result. A quick tour of the real app, from the first prompt to the finished work.',
    chapter: 'The overview',
    duration: '1:30',
    details: 'English voiceover and captions',
    ...TOUR_VIDEO,
    silent: false
  };
  return [overview, ...CHAPTERS.flatMap(([id, chapter]) => {
    const video = catalogue.find(entry => entry.id === id);
    return video ? [{
      id: video.id,
      title: video.title,
      description: video.description,
      chapter,
      duration: video.duration,
      details: video.details,
      silent: video.silent,
      src: helpVideoAssetUrl(video.src),
      poster: helpVideoAssetUrl(video.poster),
      captions: helpVideoAssetUrl(video.captions)
    }] : [];
  })];
}
