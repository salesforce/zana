import { useLocation } from 'react-router-dom';
import { decodeRoutePath, type DecodedRoute } from '../lib/decode-route.js';

export type RouteState = DecodedRoute;

/**
 * Single source of truth for URL → logical route state. All "what view are
 * we in" matching happens in {@link decodeRoutePath} so schema shifts have
 * one place to update.
 */
export function useRouteState(): RouteState {
  const location = useLocation();
  return decodeRoutePath(location.pathname, location.hash);
}
