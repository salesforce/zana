import { useState } from 'react';
import { devicePushToken } from '../src/notifications';
import { registerPush } from '../src/lib/client';
import { clearNativeProfileSession } from '../src/lib/session-controller';
import CookieManager from '@react-native-cookies/cookies';
import { Alert, Platform, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useProfiles } from '../src/state';
import { Action, Heading, Label, Screen } from '../src/ui';
import { removeProfile } from '../src/lib/profiles';
export default function Settings() {
  const { state, update } = useProfiles();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const run = (job: Promise<unknown>) => {
    void job.catch((e: Error) => Alert.alert('Could not save settings', e.message));
  };
  return (
    <Screen>
      <Heading>This device</Heading>
      <Label muted>Server settings and plugins are available inside Zana.</Label>
      <Label>Saved servers</Label>
      {state.profiles.map((p) => (
        <View key={p.id} style={{ gap: 8 }}>
          <Action
            secondary
            title={`${state.activeId === p.id ? '✓ ' : ''}${p.label}`}
            onPress={() => {
              run(update((s) => ({ ...s, activeId: p.id })).then(() => router.replace('/')));
            }}
          />
          <Label muted>{p.serverUrl}</Label>
          {p.credential ? (
            <Action
              secondary
              disabled={busy}
              title={p.pushEnabled ? 'Disable notifications' : 'Enable notifications'}
              onPress={() => {
                setBusy(true);
                run(
                  (async () => {
                    await registerPush(p, p.pushEnabled ? null : await devicePushToken(true));
                    await update((s) => ({
                      ...s,
                      profiles: s.profiles.map((profile) =>
                        profile.id === p.id ? { ...profile, pushEnabled: !p.pushEnabled } : profile
                      )
                    }));
                  })().finally(() => setBusy(false))
                );
              }}
            />
          ) : null}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Action
              secondary
              title="Pair again"
              onPress={() => router.push({ pathname: '/connect', params: { server: p.serverUrl } })}
            />
            <Action
              secondary
              title="Forget"
              onPress={() =>
                Alert.alert(
                  'Forget this server?',
                  'This removes the credential from this phone. Use “revoke” on the gateway to revoke the device on your computer.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Forget',
                      style: 'destructive',
                      onPress: () =>
                        run(
                          (async () => {
                            if (p.pushEnabled) await registerPush(p, null).catch(() => {});
                            await clearNativeProfileSession(p, {
                              cookies: CookieManager,
                              platform: Platform.OS === 'ios' ? 'ios' : 'android'
                            });
                            await update((s) => removeProfile(s, p.id));
                          })()
                        )
                    }
                  ]
                )
              }
            />
          </View>
        </View>
      ))}
      <Action title="Add server" onPress={() => router.push('/connect')} />
      <Label>Appearance</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(['system', 'light', 'dark'] as const).map((value) => (
          <Action
            key={value}
            secondary={state.appearance !== value}
            title={value[0]!.toUpperCase() + value.slice(1)}
            onPress={() => run(update((s) => ({ ...s, appearance: value })))}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Label>Haptic feedback</Label>
        <Switch
          accessibilityLabel="Haptic feedback"
          value={state.haptics}
          onValueChange={(value) => run(update((s) => ({ ...s, haptics: value })))}
        />
      </View>
      <Label muted>Zana Mobile 0.1.0 · Agent execution stays on your computer.</Label>
    </Screen>
  );
}
