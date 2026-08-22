import { product } from '../../lib/product-client.js';
import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { AppConfig, TmuxVerifyResult } from '@zana-ai/zcc-domain/product';
import {
  TERMINAL_THEME_OPTIONS,
  DEFAULT_TERMINAL_THEME,
  type TerminalThemeId
} from '@zana-ai/zcc-domain/terminal-themes';
import { Section, Field, CheckboxField } from '@/components/settings/FormFields';
import { PopoverPicklist } from '@/components/ui/PopoverPicklist';

/**
 * Terminal settings — everything scoped to the embedded terminal itself
 * (appearance, the shell/binary it launches, and tmux-backed durability).
 * These moved out of the Global tab so the terminal has one home; app-wide
 * appearance (the light/dark Theme) and the remote-SSH connectivity defaults
 * stay in Global.
 */
export function TerminalSettingsView({
  config,
  onConfigDraft,
  onUpdate
}: {
  config: AppConfig;
  onConfigDraft: (config: AppConfig) => void;
  onUpdate: (patch: Partial<AppConfig>) => Promise<void>;
}) {
  const [tmux, setTmux] = useState<TmuxVerifyResult | null>(null);
  const [tmuxError, setTmuxError] = useState<string | null>(null);
  const [checkingTmux, setCheckingTmux] = useState(true);

  const checkTmux = async () => {
    setCheckingTmux(true);
    setTmuxError(null);
    const result = await verifyTmux(() => product.terminals.verifyTmux());
    setTmux(result.status);
    setTmuxError(result.error);
    setCheckingTmux(false);
  };

  useEffect(() => {
    let active = true;
    setCheckingTmux(true);
    void verifyTmux(() => product.terminals.verifyTmux()).then((result) => {
      if (!active) return;
      setTmux(result.status);
      setTmuxError(result.error);
      setCheckingTmux(false);
    });
    return () => { active = false; };
  }, []);
  const tmuxEnabled = (config.tmuxScope ?? 'all') !== 'off';
  const tmuxMissing = tmuxEnabled && tmux?.installed === false;

  return (
    <>
      <Section anchorId="terminal-appearance" title="Appearance">
        <Field
          label="Terminal theme"
          help="Color palette for the terminal, independent of the app theme. ‘Auto’ follows the app’s light/dark mode. Applies live to open terminals."
        >
          <PopoverPicklist
            value={config.terminalTheme ?? DEFAULT_TERMINAL_THEME}
            ariaLabel="Terminal theme"
            searchable={false}
            onChange={(terminalTheme) => onUpdate({ terminalTheme: terminalTheme as TerminalThemeId })}
            options={TERMINAL_THEME_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
          />
        </Field>
        <Field label="Terminal font size" help="Range 10–20. Affects new tabs.">
          <input
            type="number"
            min={10}
            max={20}
            value={config.fontSize}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!Number.isNaN(n)) onConfigDraft({ ...config, fontSize: n });
            }}
            onBlur={(e) => {
              const n = Math.max(10, Math.min(20, parseInt(e.target.value, 10) || 13));
              onUpdate({ fontSize: n });
            }}
          />
        </Field>
      </Section>

      <Section anchorId="terminal-shell" title="Shell">
        <Field label="Default shell" help="Path to the shell launched for shell tabs." mono>
          <input
            type="text"
            value={config.shell}
            onChange={(e) => onConfigDraft({ ...config, shell: e.target.value })}
            onBlur={(e) => onUpdate({ shell: e.target.value.trim() })}
            spellCheck={false}
          />
        </Field>

        <CheckboxField
          label="Mouse wheel scrolls full-screen programs"
          help="When on (default), the mouse wheel scrolls inside pagers like less, man and git. Turn OFF if scrolling a shell prompt cycles through your command history instead of paging — the wheel then does nothing in those programs (use their keys, or tmux 'mouse on', to scroll). Applies immediately to open terminals."
          checked={config.terminalWheelArrowsEnabled ?? true}
          onChange={(v) => onUpdate({ terminalWheelArrowsEnabled: v })}
        />
      </Section>

      <Section
        anchorId="terminal-tmux"
        title="tmux"
        help="Session durability backed by tmux."
      >
        <Field
          label="tmux session persistence"
          help="Back sessions with tmux so they survive an app restart or a dropped SSH connection. A durability feature, not a speed-up — it does not make terminals faster. Needs tmux installed; ignored on Windows or when tmux is absent. Off: never wrap. Remote only: wrap SSH sessions only — the strongest use case (surviving a dropped link) — and skip the extra tmux server for local runs that don't need it. All sessions: wrap local and remote (the default)."
        >
          <PopoverPicklist
            value={config.tmuxScope ?? 'all'}
            ariaLabel="tmux session persistence"
            searchable={false}
            onChange={(tmuxScope) => onUpdate({ tmuxScope: tmuxScope as AppConfig['tmuxScope'] })}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'remote', label: 'Remote only' },
              { value: 'all', label: 'All sessions' }
            ]}
          />
        </Field>
        <div className="settings-field">
          <span className="settings-label">Runtime status</span>
          {checkingTmux ? (
            <span className="settings-help" role="status">Checking tmux…</span>
          ) : tmuxError ? (
            <div>
              <p className="settings-help" role="alert">{tmuxError}</p>
              <button type="button" className="settings-btn" onClick={() => void checkTmux()}>
                Retry tmux check
              </button>
            </div>
          ) : tmux ? (
            <span
              className={`terminal-tmux-status opener-row-status opener-row-status--${tmux.installed ? 'ok' : tmuxMissing ? 'warn' : 'muted'}`}
              role="status"
              title={tmux.installed ? tmux.version || 'installed' : `not found — ${tmux.installHint}`}
            >
              {tmux.installed ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
              {tmux.installed ? tmux.version || 'installed' : tmuxMissing ? 'not found' : 'off'}
            </span>
          ) : (
            <p className="settings-help" role="alert">Could not check tmux.</p>
          )}
          {tmuxMissing && (
            <p className="settings-help">Persistence is enabled but unavailable. Install with <code>{tmux.installHint}</code>, then restart Zana.</p>
          )}
        </div>
      </Section>
    </>
  );
}

export async function verifyTmux(
  check: () => Promise<TmuxVerifyResult>
): Promise<{ status: TmuxVerifyResult | null; error: string | null }> {
  try {
    return { status: await check(), error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: null, error: `Could not check tmux: ${message}` };
  }
}

export { TerminalSettingsView as TerminalTab };
