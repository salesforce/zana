import type { ReactNode } from 'react';

type Glyph = 'check' | 'minus' | 'download' | 'folder' | 'chat' | 'plan' | 'build' | 'review' | 'pr' | 'plus' | 'laptop' | 'key' | 'eye' | 'arrow' | 'spark';

const paths: Record<Glyph, ReactNode> = {
  check: <path d="m5 12.5 4.2 4.2L19 7" />,
  minus: <path d="M6 12h12" />,
  download: <><path d="M12 4v11" /><path d="m7.5 11 4.5 4.5 4.5-4.5" /><path d="M5 19.5h14" /></>,
  folder: <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  chat: <><path d="M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-4.5 3.5v-3.5h-.5a2 2 0 0 1-2-2z" /><path d="M8.5 9.5h7M8.5 12.5h4" /></>,
  plan: <><path d="M6 4.5h12v15H6z" /><path d="M9 9h6M9 12.5h6M9 16h3" /></>,
  build: <><path d="m8 8-4.5 4L8 16" /><path d="m16 8 4.5 4L16 16" /><path d="m13.5 5.5-3 13" /></>,
  review: <><path d="M3 12s3.4-6 9-6 9 6 9 6-3.4 6-9 6-9-6-9-6z" /><circle cx="12" cy="12" r="2.6" /></>,
  pr: <><circle cx="6.5" cy="5.5" r="2" /><circle cx="6.5" cy="18.5" r="2" /><circle cx="17.5" cy="18.5" r="2" /><path d="M6.5 7.5v9" /><path d="M17.5 16.5V10a3 3 0 0 0-3-3h-2.5" /><path d="m14.5 4.5-2.5 2.5 2.5 2.5" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  laptop: <><rect x="4.5" y="5" width="15" height="10.5" rx="1.8" /><path d="M2.5 19h19" /></>,
  key: <><circle cx="8" cy="12" r="3.6" /><path d="M11.6 12H21M17.5 12v3M20 12v2" /></>,
  eye: <><path d="M12 3.5 19.5 6v5.8c0 4.2-3 7.2-7.5 8.7-4.5-1.5-7.5-4.5-7.5-8.7V6z" /><path d="m8.8 12 2.4 2.4 4-4.4" /></>,
  arrow: <><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></>,
  spark: <path d="M12 3.5 14 10l6.5 2-6.5 2-2 6.5-2-6.5-6.5-2L10 10z" />
};

export function Glyph({ name, size = 20 }: { name: Glyph; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>
  );
}
