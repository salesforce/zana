import { ActionSheetIOS, Alert, Platform } from 'react-native';

export function showConnectionMenu(actions: {
  label: string;
  share(): void;
  reload(): void;
  settings(): void;
}): void {
  const items = [
    { text: 'Share', onPress: actions.share },
    { text: 'Reload', onPress: actions.reload },
    { text: 'This device', onPress: actions.settings }
  ];
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: actions.label,
        options: [...items.map((item) => item.text), 'Cancel'],
        cancelButtonIndex: 3
      },
      (index) => items[index]?.onPress()
    );
  } else {
    Alert.alert(actions.label, undefined, items, { cancelable: true });
  }
}
