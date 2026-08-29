import { Star } from 'lucide-react';
import { useFavoriteAgents, favoriteKey } from '../store.js';

interface FavoriteStarProps {
  /**
   * The session to star/unstar. We derive the persisted favorite key from it
   * ({@link favoriteKey}) — the STABLE `claudeSessionId` when present, so the
   * star survives a relaunch (a restored agent resumes the same conversation
   * id), falling back to the ephemeral `session.id` for non-claude agents.
   */
  session: { id: string; claudeSessionId?: string };
  /** Pixel size of the star glyph (default 14). */
  size?: number;
  /** Extra class on the toggle (placement tweaks live in the call site's CSS). */
  className?: string;
}

/**
 * A star toggle that adds/removes a session from the Favorites set
 * ({@link useFavoriteAgents}). Rendered in agent board cards, the inspector
 * modal header, and the sidebar tray rows.
 *
 * Deliberately a `<span role="button">`, NOT a `<button>`: every call site nests
 * it inside an outer `<button>` (the card / tray row), and a button inside a
 * button is invalid HTML the browser silently un-nests. The span stops click
 * propagation so toggling a star never also triggers the row/card's onClick
 * (which opens the inspector modal).
 */
export function FavoriteStar({ session, size = 14, className }: FavoriteStarProps) {
  const key = favoriteKey(session);
  const isFav = useFavoriteAgents((s) => !!s.favoriteIds[key]);
  const toggle = useFavoriteAgents((s) => s.toggleFavorite);
  return (
    <span
      role="button"
      tabIndex={0}
      className={`favorite-star ${isFav ? 'is-fav' : ''} ${className ?? ''}`}
      aria-pressed={isFav}
      aria-label={isFav ? 'Unfollow this agent' : 'Follow this agent'}
      title={isFav ? 'Following — click to unfollow' : 'Follow this agent'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(key);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          toggle(key);
        }
      }}
    >
      <Star size={size} fill={isFav ? 'currentColor' : 'none'} aria-hidden="true" />
    </span>
  );
}
