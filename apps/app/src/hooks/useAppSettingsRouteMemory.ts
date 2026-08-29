import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import {
  INITIAL_STORED_ROUTE_MEMORY,
  nextStoredRouteMemory,
  visibleRouteMemory,
  type AppSettingsRouteMemory
} from '../lib/route-memory.js';

/**
 * Remembers the most recently visited core-app, Settings, and Extensions
 * routes while the app shell is mounted. Extensions / project-rail Back
 * buttons read the remembered core-app path rather than hard-coding Home.
 */
export function useAppSettingsRouteMemory(): AppSettingsRouteMemory {
  const location = useLocation();
  const storedRef = useRef(INITIAL_STORED_ROUTE_MEMORY);

  useEffect(() => {
    storedRef.current = nextStoredRouteMemory(storedRef.current, location);
  }, [location]);

  return visibleRouteMemory(storedRef.current, location);
}
