import {
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
  type TextInputProps
} from 'react-native';
import type { ReactNode } from 'react';
import { useProfiles } from './state';
export function useColors() {
  const { state } = useProfiles();
  const system = useColorScheme();
  const dark = state.appearance === 'dark' || (state.appearance === 'system' && system === 'dark');
  return {
    background: dark ? '#10121a' : '#f6f5fa',
    panel: dark ? '#1d2030' : '#ffffff',
    text: dark ? '#f4f3fc' : '#1c1730',
    muted: dark ? '#b0acc3' : '#625d76',
    accent: dark ? '#b6a5ff' : '#6543c0',
    border: dark ? '#373247' : '#e0dae9',
    danger: dark ? '#ffaaa9' : '#ab233a'
  };
}
export function Label({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  const c = useColors();
  return (
    <Text style={{ color: muted ? c.muted : c.text, fontSize: 16, lineHeight: 24 }}>
      {children}
    </Text>
  );
}
export function Heading({ children }: { children: ReactNode }) {
  const c = useColors();
  return (
    <Text
      accessibilityRole="header"
      style={{ color: c.text, fontSize: 28, fontWeight: '700', marginBottom: 8 }}
    >
      {children}
    </Text>
  );
}
export function Action({
  title,
  onPress,
  disabled = false,
  secondary = false,
  testID
}: {
  title: string;
  onPress(): void;
  disabled?: boolean;
  secondary?: boolean;
  testID?: string;
}) {
  const c = useColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        paddingHorizontal: 18,
        paddingVertical: 12,
        borderRadius: 14,
        justifyContent: 'center',
        backgroundColor: secondary ? c.panel : c.accent,
        opacity: disabled ? 0.5 : pressed ? 0.75 : 1
      })}
    >
      <Text
        style={{
          color: secondary ? c.text : c.background,
          fontSize: 16,
          fontWeight: '600',
          textAlign: 'center'
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        style={{
          color: c.text,
          backgroundColor: c.panel,
          borderColor: c.border,
          borderWidth: 1,
          borderRadius: 12,
          padding: 14,
          fontSize: 16,
          minHeight: 50
        }}
      />
    </View>
  );
}
export function Screen({ children }: { children: ReactNode }) {
  const c = useColors();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'android' ? 'height' : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        style={{ flex: 1, backgroundColor: c.background }}
        contentContainerStyle={styles.content}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  content: {
    padding: 24,
    gap: 18,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    paddingBottom: 48
  }
});
