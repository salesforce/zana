import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import * as QuickActions from 'expo-quick-actions';
import { useQuickActionCallback } from 'expo-quick-actions/hooks';

export function QuickActionsHost() {
  const router = useRouter();
  useEffect(() => {
    void QuickActions.setItems([
      {
        id: 'device-settings',
        title: 'This device',
        subtitle: 'Servers and notifications',
        icon: 'symbol:gearshape'
      }
    ]).catch(() => {});
  }, []);
  useQuickActionCallback((action) => {
    if (action.id === 'device-settings') router.navigate('/settings');
  });
  return null;
}
