import { useId } from 'react';
import './fairy.css';

export type FairyMood = 'flying' | 'resting' | 'still';

/**
 * The Zana fairy mark (same geometry as `docs/media/zana-intro`). Purely
 * decorative: scenes position the wrapper and add their own keyframes.
 * `flying` hovers and flaps, `resting` folds its wings and dims its star,
 * `still` is a static mark for small rows.
 */
export function ZanaFairy({ mood = 'flying', className }: { mood?: FairyMood; className?: string }) {
  const gradientId = `fairy-wing-${useId().replace(/:/g, '')}`;
  const wingFill = `url(#${gradientId})`;
  return (
    <span className={`fairy fairy--${mood}${className ? ` ${className}` : ''}`} aria-hidden="true">
      <svg className="fairy-art" viewBox="0 0 64 64" focusable="false">
        <defs>
          <linearGradient id={gradientId} x1="11" y1="12" x2="52" y2="51" gradientUnits="userSpaceOnUse">
            <stop stopColor="#bcefff" />
            <stop offset=".5" stopColor="#79bbfa" />
            <stop offset="1" stopColor="#aea0ee" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="15" fill="#172641" />
        <g className="fairy-wing fairy-wing--left">
          <path d="M27 34C17 33 8 25 8 11C19 13 26 21 27 34ZM27 37C18 33 10 37 10 48C18 49 24 45 27 37Z" fill={wingFill} />
        </g>
        <g className="fairy-wing fairy-wing--right">
          <path d="M37 34C47 33 54 25 54 11C44 15 38 23 37 34ZM37 37C46 33 54 37 54 48C46 49 40 45 37 37Z" fill={wingFill} />
        </g>
        <circle cx="32" cy="18" r="4" fill="#f0f7ff" />
        <path d="M32 25C35 30 35 34 36 38C37 44 40 48 43 51C36 55 28 55 21 51C24 47 27 43 28 38C29 34 29 30 32 25Z" fill="#f0f7ff" />
        <path d="M34 29Q40 35 45 28L51 18" fill="none" stroke="#f0f7ff" strokeWidth="2.3" strokeLinecap="round" />
        <path className="fairy-star" d="M55 3C56 8 58 10 62 11C58 12 56 14 55 19C54 14 52 12 48 11C52 10 54 8 55 3Z" fill="#ffdb9e" />
      </svg>
    </span>
  );
}
