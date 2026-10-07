/** Fixed labels only. Neither route parameters nor plugin ids leave the app. */
export const PAGE_TITLES = Object.freeze({
  home: 'Home', inbox: 'Inbox', agents: 'Agents', followups: 'Follow-ups',
  suggestions: 'Suggestions', scheduler: 'Scheduler', goals: 'Goals',
  settings: 'Settings', extensions: 'Plugins', projects: 'Projects',
  terminals: 'Terminals', explorer: 'Explorer', skills: 'Skills',
  library: 'Library', feed: 'Activity Feed', plugin: 'Plugin'
});

export function pageForPath(pathname) {
  const parts = String(pathname).split(/[?#]/, 1)[0].split('/').filter(Boolean);
  let section = parts[0] || 'home';
  if (section === 'projects') section = parts[2] || 'agents';
  if (section === 'threads' || section === 'sessions' || section === 'new') return 'agents';
  if (section === 'schedules') return 'scheduler';
  return Object.hasOwn(PAGE_TITLES, section) ? section : 'plugin';
}
