import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Field } from '../components/settings/FormFields.js';
import { PopoverPicklist } from '../components/ui/PopoverPicklist.js';
import { listFileOpeners, listThreadLists, subscribePluginSlots } from './plugin-slots.js';
import {
  fileOpenerKey,
  readFileOpenerPins,
  readThreadListPin,
  writeFileOpenerPin,
  writeThreadListPin
} from './plugin-slot-resolvers.js';
import {
  loadPluginThemes,
  readActivePluginTheme,
  themeStorageKey,
  writeActivePluginTheme,
  type PluginThemeOption
} from './PluginThemesHost.js';

export function PluginThemePicker() {
  const [themes, setThemes] = useState<PluginThemeOption[]>([]);
  const [value, setValue] = useState(() => readActivePluginTheme() ?? 'host');

  useEffect(() => {
    void loadPluginThemes().then(setThemes);
  }, []);

  if (themes.length === 0) return null;
  return (
    <Field
      label="Plugin theme"
      help="CSS themes declared in a plugin's package.json zcc.themes. Host chrome stays the system/light/dark picker above."
    >
      <PopoverPicklist
        value={value}
        ariaLabel="Plugin theme"
        searchable={false}
        onChange={(next) => {
          setValue(next);
          writeActivePluginTheme(next === 'host' ? null : next);
          window.dispatchEvent(new Event('zcc:plugin-theme-changed'));
        }}
        options={[
          { value: 'host', label: 'None (host chrome)' },
          ...themes.map((theme) => ({
            value: themeStorageKey(theme.pluginId, theme.id),
            label: theme.name
          }))
        ]}
      />
    </Field>
  );
}

export function PluginThreadListPicker() {
  const lists = useSyncExternalStore(subscribePluginSlots, listThreadLists, listThreadLists);
  const [value, setValue] = useState(() => readThreadListPin() ?? (lists[0] ? `${lists[0].pluginId}/${lists[0].id}` : 'host'));
  if (lists.length === 0) return null;
  return (
    <Field
      label="Thread list"
      help="An exclusive plugin thread list replaces only the scrolling Agents list. Plugin nav rows and the sidebar footer stay host-owned."
    >
      <PopoverPicklist
        value={value}
        ariaLabel="Thread list"
        searchable={false}
        onChange={(next) => {
          setValue(next);
          writeThreadListPin(next === 'host' ? 'host' : next);
        }}
        options={[
          { value: 'host', label: 'Host list' },
          ...lists.map((row) => ({
            value: `${row.pluginId}/${row.id}`,
            label: row.title
          }))
        ]}
      />
    </Field>
  );
}

export function PluginFileOpenerSettings() {
  const openers = useSyncExternalStore(subscribePluginSlots, listFileOpeners, listFileOpeners);
  const pins = readFileOpenerPins();
  const byExtension = useMemo(() => {
    const map = new Map<string, typeof openers>();
    for (const opener of openers) {
      for (const extension of opener.extensions) {
        const list = map.get(extension) ?? [];
        list.push(opener);
        map.set(extension, list);
      }
    }
    return [...map.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [openers]);
  const [, bump] = useState(0);
  if (byExtension.length === 0) {
    return (
      <p className="settings-hint">No plugin file openers are registered. The host preview is used for every file.</p>
    );
  }
  return (
    <div className="plugin-file-opener-settings" data-testid="plugin-file-opener-settings">
      {byExtension.map(([extension, rows]) => {
        const current = pins[extension] ?? fileOpenerKey(rows[0]!);
        return (
          <Field key={extension} label={`.${extension} files`}>
            <PopoverPicklist
              value={current}
              ariaLabel={`Opener for .${extension} files`}
              searchable={false}
              onChange={(next) => {
                writeFileOpenerPin(extension, next);
                bump((n) => n + 1);
              }}
              options={[
                { value: 'host', label: 'Host preview' },
                ...rows.map((row) => ({
                  value: fileOpenerKey(row),
                  label: row.title
                }))
              ]}
            />
          </Field>
        );
      })}
    </div>
  );
}
