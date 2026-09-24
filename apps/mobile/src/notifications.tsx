import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useProfiles } from './state';
import { registerPush } from './lib/client';
import { notificationRoute } from './lib/notification-route';
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: AppState.currentState !== 'active',
    shouldShowList: true,
    shouldPlaySound: AppState.currentState !== 'active',
    shouldSetBadge: true
  })
});
export async function devicePushToken(requestPermission: boolean): Promise<string> {
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  if (!projectId) throw new Error('Push notifications are not configured for this build yet.');
  if (Platform.OS === 'android')
    await Notifications.setNotificationChannelAsync('threads', {
      name: 'Threads',
      importance: Notifications.AndroidImportance.DEFAULT
    });
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && requestPermission)
    permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted)
    throw new Error('Allow notifications in your device settings to enable alerts.');
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}
export function NotificationsHost() {
  const { state, ready } = useProfiles();
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    let active = true;
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response || !active) return;
      const route = notificationRoute(response.notification.request.content.data, state.profiles);
      if (route) {
        router.push(route as '/');
        void Notifications.clearLastNotificationResponseAsync();
      }
    };
    void Notifications.getLastNotificationResponseAsync().then(open);
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => {
      active = false;
      subscription.remove();
    };
  }, [ready, state.profiles]);
  useEffect(() => {
    const profiles = state.profiles.filter((p) => p.pushEnabled && p.credential);
    if (!ready || !profiles.length) return;
    let active = true;
    const refresh = async () => {
      try {
        const token = await devicePushToken(false);
        for (const profile of profiles) {
          if (!active) return;
          await registerPush(profile, token);
        }
      } catch {
        /* Settings provides explicit registration errors; automatic refresh is best-effort. */
      }
    };
    void refresh();
    const subscription = AppState.addEventListener('change', (value) => {
      if (value === 'active') void refresh();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [ready, state.profiles]);
  return null;
}
