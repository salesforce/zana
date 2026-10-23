import { useLocation } from 'react-router-dom';
import { rememberLocation, visibleRouteMemory, type AppSettingsRouteMemory } from '../lib/route-memory.js';

export { resetAppSettingsRouteMemory } from '../lib/route-memory.js';

/**
 * Remembers the most recently visited core-app, Settings, and Extensions
 * routes while the app shell is mounted. Extensions / project-rail Back
 * buttons read the remembered core-app path rather than hard-coding Home.
 */
export function useAppSettingsRouteMemory(): AppSettingsRouteMemory {
  const location = useLocation();
  return visibleRouteMemory(rememberLocation(location), location);
}
