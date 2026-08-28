/**
 * Settings — grouped left-nav shell (R-SET-001..004).
 *
 * The panel header names this mode; this view is the left nav + pane only. A
 * left nav lists five areas under three group headers (GITHUB / CONFIGURATION /
 * SYSTEM); the right pane renders the active area, each with its own title +
 * subtitle. The active row persists via {@link PrMonitorSettings.settingsActiveNav}
 * (default Organizations) so reopening Settings lands where the user left off.
 *
 * Preference writes stay immediate: `update(patch)` fires `onSave(next)`, mirrors
 * the settings cache, and refreshes the sidebar badge. Org/repo/author state is
 * owned main-side and loaded per area via `host.call`.
 */

import { useState } from 'react';
import { Building2, BookMarked, Users, Bell, Wrench } from 'lucide-react';
import {
  type PrMonitorSettings,
  type SettingsNavId,
  DEFAULT_SETTINGS_NAV,
} from '../../lib/types.js';
import type { ModuleHost } from './host.js';
import { OrganizationsArea } from './settings/OrganizationsArea.js';
import { RepositoriesArea } from './settings/RepositoriesArea.js';
import { AuthorArea } from './settings/AuthorArea.js';
import { NotificationsArea } from './settings/NotificationsArea.js';
import { SystemArea } from './settings/SystemArea.js';

interface Props {
  settings: PrMonitorSettings;
  onSave: (next: PrMonitorSettings) => void;
  /**
   * Fired after a repository edit that main-side persisted (presets / sfciGated /
   * ignored checks). Lets the panel re-sync its in-memory `settings.repositories`
   * so the board's pill thresholds update without a full reload.
   */
  onRepositoriesChanged?: () => void;
  host: ModuleHost;
}

interface NavItem {
  id: SettingsNavId;
  label: string;
  icon: typeof Building2;
}
interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'GITHUB',
    items: [
      { id: 'organizations', label: 'Organizations', icon: Building2 },
      { id: 'repositories', label: 'Repositories', icon: BookMarked },
      { id: 'author', label: 'Author', icon: Users },
    ],
  },
  {
    label: 'CONFIGURATION',
    items: [{ id: 'notifications', label: 'Notifications', icon: Bell }],
  },
  {
    label: 'SYSTEM',
    items: [{ id: 'system', label: 'System', icon: Wrench }],
  },
];

export function SettingsView({ settings, onSave, onRepositoriesChanged, host }: Props) {
  const [active, setActive] = useState<SettingsNavId>(
    settings.settingsActiveNav ?? DEFAULT_SETTINGS_NAV
  );

  const update = (patch: Partial<PrMonitorSettings>) => {
    const next = { ...settings, ...patch };
    onSave(next);
    host.cache.set('settings', next);
    host.cache.refreshBadge();
  };

  const select = (id: SettingsNavId) => {
    setActive(id);
    update({ settingsActiveNav: id });
  };

  return (
    <div className="prm-settings-shell">
      <div className="prm-settings-body">
        <nav className="prm-settings-nav" aria-label="Settings sections">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="prm-nav-group">
              <div className="prm-nav-group-label">{group.label}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`prm-nav-row${active === item.id ? ' active' : ''}`}
                    aria-current={active === item.id}
                    onClick={() => select(item.id)}
                  >
                    <Icon size={15} aria-hidden />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="prm-settings-pane">
          {active === 'organizations' && <OrganizationsArea host={host} />}
          {active === 'repositories' && (
            <RepositoriesArea host={host} onRepositoriesChanged={onRepositoriesChanged} />
          )}
          {active === 'author' && <AuthorArea host={host} />}
          {active === 'notifications' && (
            <NotificationsArea settings={settings} update={update} />
          )}
          {active === 'system' && <SystemArea settings={settings} update={update} host={host} />}
        </div>
      </div>
    </div>
  );
}
