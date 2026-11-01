import guidedStartVideo from '../assets/onboarding/guided-start.mp4?url&no-inline';
import guidedStartPoster from '../assets/onboarding/guided-start.jpg?url&no-inline';
import guidedStartCaptions from '../assets/onboarding/guided-start.en.vtt?url&no-inline';
import squadVideo from '../assets/squads/how-to-use-a-squad.mp4?url&no-inline';
import squadPoster from '../assets/squads/how-to-use-a-squad.jpg?url&no-inline';
import squadCaptions from '../assets/squads/how-to-use-a-squad.en.vtt?url&no-inline';
import everywhereVideo from '../assets/release-notes/zana-everywhere.mp4?url&no-inline';
import everywherePoster from '../assets/release-notes/zana-everywhere.jpg?url&no-inline';
import everywhereCaptions from '../assets/release-notes/zana-everywhere.en.vtt?url&no-inline';

export interface HelpVideo {
  id: string;
  group: string;
  title: string;
  description: string;
  /** Display length, e.g. `0:30`. */
  duration: string;
  /** Short note on sound and captions. */
  details: string;
  /** Where else the app shows this clip. */
  alsoIn?: string;
  src: string;
  poster: string;
  captions: string;
  /** Silent clips may start playing on their own. */
  silent: boolean;
  fileName: string;
}

/**
 * Shipped offline baseline. Future Help videos publish through content/videos/
 * and the live catalogue store; the walkthrough/release-note basics stay local.
 */
export const HELP_VIDEOS: readonly HelpVideo[] = [
  {
    id: 'guided-start',
    group: 'Getting started',
    title: 'Your first project in 30 seconds',
    description: 'A project is just a folder. Add one, pick an agent, get a design doc, preview the build and read the Inbox report.',
    duration: '0:30',
    details: 'Captions · no audio',
    alsoIn: 'Walkthrough',
    src: guidedStartVideo,
    poster: guidedStartPoster,
    captions: guidedStartCaptions,
    silent: true,
    fileName: 'zana-first-project.mp4'
  },
  {
    id: 'how-to-use-a-squad',
    group: 'Getting started',
    title: 'How to use a Squad',
    description: 'Ask an agent to set up a Squad or build one yourself, then launch it for a goal and answer its questions in the Inbox.',
    duration: '1:30',
    details: 'English voiceover and captions',
    src: squadVideo,
    poster: squadPoster,
    captions: squadCaptions,
    silent: false,
    fileName: 'zana-how-to-use-a-squad.mp4'
  },
  {
    id: 'zana-everywhere',
    group: 'What’s new · 2.3.0',
    title: 'Use Zana everywhere',
    description: 'Connect your desktop, then open your Zana address in Safari on your iPhone.',
    duration: '1:04',
    details: 'English voiceover and captions',
    alsoIn: 'Release notes 2.3.0',
    src: everywhereVideo,
    poster: everywherePoster,
    captions: everywhereCaptions,
    silent: false,
    fileName: 'zana-everywhere.mp4'
  }
];

export function helpVideo(id: string): HelpVideo {
  const video = HELP_VIDEOS.find((entry) => entry.id === id);
  if (!video) throw new Error(`Unknown help video: ${id}`);
  return video;
}
