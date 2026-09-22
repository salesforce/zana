import { useEffect, useRef, useState } from 'react';
import { View, Switch, ActivityIndicator, Keyboard } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useProfiles } from '../src/state';
import { Action, Field, Heading, Label, Screen, useColors } from '../src/ui';
import { normalizeServerUrl, parsePairingPayload } from '../src/lib/urls';
import { pairServer, probeDirect } from '../src/lib/client';
import { saveProfile } from '../src/lib/profiles';
export default function Connect() {
  const router = useRouter();
  const { state, ready, update } = useProfiles();
  const params = useLocalSearchParams<{ payload?: string; server?: string }>();
  const [server, setServer] = useState(params.server ?? '');
  const [label, setLabel] = useState('My Zana');
  const [code, setCode] = useState('');
  const [direct, setDirect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const scanActive = useRef(false);
  const connecting = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const c = useColors();
  function stopScanning() {
    scanActive.current = false;
    setScanning(false);
  }
  function accept(raw: string) {
    // A rejected scan must not leave an older code ready to redeem.
    setCode('');
    setDirect(false);
    try {
      const parsed = parsePairingPayload(raw);
      setServer(parsed.serverUrl);
      setCode(parsed.code);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      stopScanning();
    }
  }
  useEffect(() => {
    if (params.payload) accept(params.payload);
  }, [params.payload]);
  async function connect() {
    if (connecting.current || !ready) return;
    connecting.current = true;
    Keyboard.dismiss();
    stopScanning();
    setBusy(true);
    setError('');
    try {
      const serverUrl = normalizeServerUrl(server);
      const credential = direct
        ? (await probeDirect(serverUrl), {})
        : await pairServer(serverUrl, code, label);
      await update((current) =>
        saveProfile(current, { id: randomUUID(), label, serverUrl, ...credential })
      );
      router.replace('/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      connecting.current = false;
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Heading>Your agents, with you.</Heading>
      <Label muted>
        Connect to Zana running on your computer. Generate a mobile pairing code on your computer,
        then scan it or enter the server and code below.
      </Label>
      {scanning && permission?.granted ? (
        <CameraView
          style={{ height: 280, borderRadius: 20 }}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => {
            if (scanActive.current) accept(data);
          }}
        />
      ) : (
        <Action
          secondary
          title="Scan pairing QR"
          disabled={busy}
          onPress={() => {
            Keyboard.dismiss();
            void (async () => {
              try {
                const result = permission?.granted ? permission : await requestPermission();
                if (result.granted) {
                  setError('');
                  scanActive.current = true;
                  setScanning(true);
                } else setError('Camera access is disabled. Enter the pairing code below.');
              } catch {
                setError('Could not open the camera. Enter the pairing code below.');
              }
            })();
          }}
        />
      )}
      {scanning ? <Action secondary title="Cancel scan" onPress={stopScanning} /> : null}
      <Field
        testID="server-name"
        label="Server name"
        value={label}
        onChangeText={setLabel}
        maxLength={80}
      />
      <Field
        testID="server-url"
        label="Server URL"
        value={server}
        onChangeText={setServer}
        placeholder="https://your-mac.example"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      {!direct ? (
        <Field
          testID="pairing-code"
          label="Pairing code"
          value={code}
          onChangeText={setCode}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={100}
        />
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12
        }}
      >
        <View style={{ flex: 1 }}>
          <Label>Direct connection</Label>
          <Label muted>For a simulator or an existing private server.</Label>
        </View>
        <Switch accessibilityLabel="Direct connection" value={direct} onValueChange={setDirect} />
      </View>
      {error ? <Label>{error}</Label> : null}
      {busy ? <ActivityIndicator color={c.accent} /> : null}
      <Action
        title={busy ? 'Connecting…' : 'Connect'}
        testID="connect-server"
        disabled={busy || !ready || !server.trim() || (!direct && !code.trim())}
        onPress={() => void connect()}
      />
      {state.profiles.length ? (
        <Action secondary title="Back to servers" onPress={() => router.replace('/settings')} />
      ) : null}
    </Screen>
  );
}
