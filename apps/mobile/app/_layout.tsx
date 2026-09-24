import { QuickActionsHost } from '../src/quick-actions';
import { NotificationsHost } from '../src/notifications';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ProfilesProvider } from '../src/state';
import { NativeSessionProvider } from '../src/session';
import { useColors } from '../src/ui';
function Navigator() {
  const c = useColors();
  return (
    <>
      <QuickActionsHost />
      <NotificationsHost />
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.background },
          headerTintColor: c.text,
          contentStyle: { backgroundColor: c.background },
          headerShadowVisible: false
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false, title: 'Zana' }} />
        <Stack.Screen name="connect" options={{ title: 'Add server' }} />
        <Stack.Screen name="settings" options={{ title: 'This device' }} />
      </Stack>
    </>
  );
}
export default function Layout() {
  return (
    <SafeAreaProvider>
      <ProfilesProvider>
        <NativeSessionProvider>
          <Navigator />
        </NativeSessionProvider>
      </ProfilesProvider>
    </SafeAreaProvider>
  );
}
