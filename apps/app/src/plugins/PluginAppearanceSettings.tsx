import { useEffect, useState, useSyncExternalStore } from 'react';
import { Field } from '../components/settings/FormFields.js';
import { PopoverPicklist } from '../components/ui/PopoverPicklist.js';
import { listThreadLists, subscribePluginSlots } from './plugin-slots.js';
import {
  readThreadListPin,
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
      layout="row"
      help="Use an appearance theme from an installed plugin."
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
      label="Agents list"
      layout="row"
      help="Choose how agents appear in the sidebar."
    >
      <PopoverPicklist
        value={value}
        ariaLabel="Agents list"
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
