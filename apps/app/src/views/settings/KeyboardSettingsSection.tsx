import { useMemo, useState } from 'react';
import {
  appShortcutFromInput,
  formatAppShortcut,
  readKeyboardOverrides,
  REMAPPABLE_COMMANDS,
  resetCommandShortcutOverride,
  resolvedKeyboardBindings,
  setCommandShortcutOverride
} from '@/lib/keyboard-shortcut-settings';
import { Field, Section, SettingsActionRow } from '@/components/settings/FormFields';
import { useUi } from '@/store';

export function KeyboardSettingsSection() {
  const [, setTick] = useState(0);
  const [capturing, setCapturing] = useState<string | null>(null);
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform;
  const bindings = useMemo(
    () => resolvedKeyboardBindings(readKeyboardOverrides()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [capturing]
  );

  return (
    <Section
      anchorId="keyboard"
      title="Shortcuts"
      help="Remap New Chat, the palette, Quick Open, the explorer, and Settings. Press ⌘/ to see every shortcut."
    >
      {REMAPPABLE_COMMANDS.map((command) => {
        const binding = bindings.find((row) => row.command === command.command);
        const label = binding ? formatAppShortcut(binding.shortcut, platform) : 'Disabled';
        return (
          <Field key={command.command} label={command.label} help={command.help}>
            <div className="settings-keyboard-row">
              <button
                type="button"
                className="settings-keyboard-chord"
                data-testid={`keyboard-shortcut-${command.command}`}
                aria-label={`${command.label} shortcut`}
                onClick={() => setCapturing(command.command)}
                onKeyDown={(event) => {
                  if (capturing !== command.command) return;
                  event.preventDefault();
                  event.stopPropagation();
                  const shortcut = appShortcutFromInput(event.nativeEvent, platform);
                  if (!shortcut) return;
                  setCommandShortcutOverride(command.command, shortcut);
                  setCapturing(null);
                  setTick((value) => value + 1);
                }}
              >
                {capturing === command.command ? 'Press a shortcut…' : label}
              </button>
              <button
                type="button"
                className="settings-btn"
                onClick={() => {
                  resetCommandShortcutOverride(command.command);
                  setCapturing(null);
                  setTick((value) => value + 1);
                }}
              >
                Reset
              </button>
            </div>
          </Field>
        );
      })}
      <SettingsActionRow
        label="All shortcuts"
        help="The full list, including chords that are not remappable here. Press ⌘/ from anywhere."
      >
        <button
          type="button"
          className="settings-btn"
          data-testid="show-all-shortcuts"
          onClick={() => useUi.getState().setShortcutsOpen(true)}
        >
          Show
        </button>
      </SettingsActionRow>
    </Section>
  );
}
