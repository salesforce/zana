import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { product } from '../../lib/product-client.js';
import { Section, CheckboxField, SettingsActionRow } from '@/components/settings/FormFields';
import { AgentLauncher } from '../../components/AgentLauncher.js';
import { MOBILE_INSTALL_PROMPT } from './mobile-install-prompt.js';
import './phone-settings.css';

interface PhoneViewProps {
  config: AppConfig;
  onConfigDraft: (config: AppConfig) => void;
  onUpdate: (patch: Partial<AppConfig>) => Promise<void>;
}

type MobileStatus = Awaited<ReturnType<typeof product.mobile.status>>;
type PairingPayload = Awaited<ReturnType<typeof product.mobile.pair>>;
type MobileDevice = Awaited<ReturnType<typeof product.mobile.devices>>[number];

/** Encode the same JSON the `mobile:serve` CLI puts in its QR so the phone's
 *  scanner (which accepts raw JSON or the `zana://connect` link) reads either. */
function pairingQrText(payload: PairingPayload): string {
  return JSON.stringify(payload);
}
function pairingDeepLink(payload: PairingPayload): string {
  return `zana://connect?payload=${encodeURIComponent(JSON.stringify(payload))}`;
}

/**
 * Settings → Phone. Pair the Zana Mobile app by scanning an on-screen QR. The
 * gateway is a live main-process listener owned by desktop (`window.cc.mobile`);
 * the master toggle rides the `mobileGatewayEnabled` AppConfig flag, whose
 * reactor in main starts/stops the listener. Binding a private LAN IP makes the
 * gateway reachable on the local network — hence the trusted-network caveat.
 */
export function PhoneView({ config, onUpdate }: PhoneViewProps) {
  const enabled = config.mobileGatewayEnabled ?? false;
  const [status, setStatus] = useState<MobileStatus | null>(null);
  const [devices, setDevices] = useState<MobileDevice[]>([]);
  const [payload, setPayload] = useState<PairingPayload | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [installComposerOpen, setInstallComposerOpen] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await product.mobile.status());
    } catch {
      /* status is best-effort — leave the last known value */
    }
  }, []);
  const refreshDevices = useCallback(async () => {
    try {
      setDevices(await product.mobile.devices());
    } catch {
      setDevices([]);
    }
  }, []);

  // Poll status while enabling settles (start is async in main); also refresh
  // the paired-device list. A short poll is enough — the panel is small and the
  // listener flips within a tick of the toggle.
  useEffect(() => {
    void refreshStatus();
    void refreshDevices();
    const timer = setInterval(() => void refreshStatus(), 2000);
    return () => clearInterval(timer);
  }, [refreshStatus, refreshDevices, enabled]);

  // Tick a clock for the pairing-code expiry countdown.
  useEffect(() => {
    if (!payload) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [payload]);

  // Render the QR whenever a fresh payload arrives.
  useEffect(() => {
    if (!payload) {
      setQrDataUrl('');
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(pairingQrText(payload), { margin: 2, width: 240 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [payload]);

  const running = status?.running ?? false;
  const codeExpired = payload ? payload.expiresAt <= now : false;
  const secondsLeft = payload ? Math.max(0, Math.ceil((payload.expiresAt - now) / 1000)) : 0;

  const showQr = useCallback(async () => {
    setPairing(true);
    setError(null);
    try {
      const next = await product.mobile.pair();
      setPayload(next);
      setNow(Date.now());
    } catch (err) {
      setPayload(null);
      setError(err instanceof Error ? err.message : 'Could not generate a pairing code.');
    } finally {
      setPairing(false);
    }
  }, []);

  const revoke = useCallback(
    async (id: string) => {
      try {
        await product.mobile.revoke(id);
      } finally {
        void refreshDevices();
      }
    },
    [refreshDevices]
  );

  // Clear a stale QR when phone access is turned off.
  const prevEnabled = useRef(enabled);
  useEffect(() => {
    if (prevEnabled.current && !enabled) {
      setPayload(null);
      setError(null);
    }
    prevEnabled.current = enabled;
  }, [enabled]);

  return (
    <Section
      anchorId="phone"
      title="Phone"
      help="Install Zana on your phone, then pair it with this computer to use your projects and agents on the go."
    >
      <div className="phone-install-guide">
        <SettingsActionRow
          label="Install the mobile app"
          help="Let an AI agent check your setup, build the app, and install it on your connected phone. Review the prepared prompt and press Send to begin."
        >
          <button type="button" className="btn primary" onClick={() => setInstallComposerOpen(true)}>
            Install with AI
          </button>
        </SettingsActionRow>
        <ol className="phone-install-steps" aria-label="Mobile installation steps">
          <li><strong>Connect your phone.</strong> Plug it into this computer with a USB cable and unlock it.</li>
          <li><strong>Install with AI.</strong> Open the prepared prompt above and press Send. The agent handles the build and installation, and guides you through any phone confirmations.</li>
          <li><strong>Pair and connect.</strong> Keep both devices on the same Wi-Fi. Enable phone access below and show the pairing QR. In Zana on your phone, choose Add server → Scan pairing QR, then Connect. Allow local-network access if asked and keep Zana running on this computer.</li>
        </ol>
        <details className="phone-install-device-help">
          <summary>iPhone and Android setup</summary>
          <p><strong>iPhone:</strong> Installation requires a Mac with Xcode and an Apple account for signing. Tap Trust on the phone if asked. In Settings → Privacy &amp; Security → Developer Mode, turn it on, restart the phone, then confirm Turn On and unlock it.</p>
          <p><strong>Android:</strong> Installation requires the Android SDK tools. In Developer options, enable USB debugging and accept the authorization prompt when you connect the phone. The agent can help you prepare the tools.</p>
        </details>
      </div>

      <CheckboxField
        label="Enable phone access"
        help="Start a local, authenticated gateway so the Zana Mobile app can connect to this computer. Off by default. Each phone pairs with a one-time code and its own credential; you can revoke a phone at any time below."
        checked={enabled}
        onChange={(v) => void onUpdate({ mobileGatewayEnabled: v })}
      />

      {enabled && status?.error && (
        <div className="settings-help" role="alert" style={{ color: 'var(--danger, #d33)' }}>
          {status.error}
        </div>
      )}

      {enabled && running && status?.boundLan && (
        <div className="settings-help" role="note">
          ⚠ Reachable on your local network at <code>{status.publicUrl}</code>. Only pair on a
          trusted network — anyone on it can attempt to connect (a valid pairing code is still
          required).
        </div>
      )}
      {enabled && running && status && !status.boundLan && (
        <div className="settings-help" role="note">
          No private network address was found, so the gateway is bound to <code>{status.publicUrl}</code>{' '}
          (loopback). A physical phone cannot reach it — connect the simulator or a reverse proxy.
        </div>
      )}

      {enabled && (
        <SettingsActionRow
          label="Pairing QR code"
          help="Generates a fresh, short-lived pairing code. In the Zana Mobile app tap “Scan pairing QR” and point the camera at this code."
        >
          <button type="button" className="btn" disabled={!running || pairing} onClick={() => void showQr()}>
            {pairing ? 'Generating…' : payload ? 'Regenerate' : 'Show pairing QR'}
          </button>
        </SettingsActionRow>
      )}

      {error && (
        <div className="settings-help" role="alert" style={{ color: 'var(--danger, #d33)' }}>
          {error}
        </div>
      )}

      {payload && (
        <div className="settings-field" data-testid="pairing-qr">
          {qrDataUrl && !codeExpired && (
            <img
              src={qrDataUrl}
              alt="Zana Mobile pairing QR code"
              width={240}
              height={240}
              style={{ background: '#fff', borderRadius: 8, padding: 4 }}
            />
          )}
          {codeExpired ? (
            <p className="settings-help" role="alert">
              This pairing code has expired. Tap Regenerate for a new one.
            </p>
          ) : (
            <p className="settings-help">
              Expires in {secondsLeft}s. Or enter manually — Server: <code>{payload.serverUrl}</code>,
              Code: <code>{payload.code}</code>.
            </p>
          )}
          {!codeExpired && (
            <p className="settings-help settings-field--mono">
              <code>{pairingDeepLink(payload)}</code>
            </p>
          )}
        </div>
      )}

      {enabled && (
        <div className="settings-field">
          <span className="settings-label">Paired phones</span>
          {devices.length === 0 ? (
            <p className="settings-help">No phones paired yet.</p>
          ) : (
            <ul className="settings-device-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {devices.map((device) => (
                <li
                  key={device.id}
                  className="settings-device-row"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
                >
                  <span>{device.label}</span>
                  <button
                    type="button"
                    className="btn btn--danger"
                    aria-label={`Revoke ${device.label}`}
                    onClick={() => void revoke(device.id)}
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {installComposerOpen && (
        <AgentLauncher
          initialPrompt={MOBILE_INSTALL_PROMPT}
          onClose={() => setInstallComposerOpen(false)}
        />
      )}
    </Section>
  );
}

export { PhoneView as PhoneTab };
