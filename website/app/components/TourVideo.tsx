import Link from 'next/link';

export const TOUR_VIDEO = {
  src: '/media/zana-tour.mp4',
  poster: '/media/zana-tour-poster.jpg',
  captions: '/media/zana-tour.en.vtt'
} as const;

/**
 * The homepage tour: a two-minute narrated recording of the real app. The
 * poster is the opener's title card (also the video's first frame), so the
 * player never shows a blank image before it plays.
 */
export function TourVideo() {
  return (
    <div className="tour-video">
      <video
        controls
        playsInline
        preload="metadata"
        poster={TOUR_VIDEO.poster}
        width={1440}
        height={900}
        aria-label="A two-minute tour of Zana"
      >
        <source src={TOUR_VIDEO.src} type="video/mp4" />
        <track
          kind="captions"
          src={TOUR_VIDEO.captions}
          srcLang="en"
          label="English"
          default
        />
      </video>
      <div className="product-tour-more">
        <span>A two-minute tour · Recorded in the app</span>
        <Link className="text-link" href="/features/">
          See all features <span aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  );
}
