import { createContext, useContext } from 'react';

export const TourNavContext = createContext<(slideId: string) => void>(() => undefined);

export function useTourNav(): (slideId: string) => void {
  return useContext(TourNavContext);
}

export const NAV_TO_SLIDE = {
  'new-chat': 'features',
  inbox: 'inbox',
  agents: 'kanban',
  scheduler: 'features',
  plugins: 'plugins'
} as const;
