import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Share,
  Text,
  View
} from 'react-native';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewProps } from 'react-native-webview';
import {
  buildBridgeEventScript,
  buildBridgeInjectionScript,
  MOBILE_BRIDGE_VERSION,
  type NativeShellHandshake
} from '@zana-ai/zcc-mobile-bridge';
import { useProfiles } from '../src/state';
import { Action, Label, Screen, useColors } from '../src/ui';
import { useNativeSession } from '../src/session';
import { PairingRequired } from '../src/lib/client';
import { externalUrl, isSameServer, safePath } from '../src/lib/urls';
import { resolveShellLoadPath, shellPathFromUrl } from '../src/lib/shell-path';
import { handleBridgeMessage } from '../src/lib/bridge-handler';

export default function Home() {
  const { state, ready, error: storageError, update } = useProfiles();
  const router = useRouter();
  const c = useColors();
  const params = useLocalSearchParams<{ server?: string; path?: string }>();
  const profile = state.profiles.find((p) => p.id === state.activeId);
  const web = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const currentUrl = useRef('');
  // Where the user actually is, kept in memory only (never persisted) and
  // scoped so an explicit new deep link resets it. A cookie refresh, Reload or
  // WebView process recovery reloads this path instead of the initial one.
  const [visited, setVisited] = useState<{ scope: string; path: string } | null>(null);
  const {
    revision,
    ready: sessionReady,
    error: sessionError,
    resumeRevision,
    reconnect
  } = useNativeSession();
  const [error, setError] = useState('');
  const [authError, setAuthError] = useState(false);
  const [loading, setLoading] = useState(true);
  const unknownServer =
    !!params.server && !state.profiles.some((p) => p.serverUrl === params.server);
  useEffect(() => {
    if (!params.server || !ready) return;
    const target = state.profiles.find((p) => p.serverUrl === params.server);
    if (target && target.id !== state.activeId)
      void update((s) => ({ ...s, activeId: target.id })).catch((e: Error) => setError(e.message));
  }, [params.server, ready, state.activeId]);
  useEffect(() => {
    setError(
      sessionError instanceof Error
        ? sessionError.message
        : sessionError
          ? 'Could not connect.'
          : ''
    );
    setAuthError(sessionError instanceof PairingRequired);
    setLoading(true);
  }, [profile?.id, profile?.credential, revision, sessionError]);
  useEffect(() => {
    if (resumeRevision) web.current?.injectJavaScript(buildBridgeEventScript({ type: 'resume' }));
  }, [resumeRevision]);
  useFocusEffect(
    useCallback(() => {
      const back = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!canGoBack.current) return false;
        web.current?.goBack();
        return true;
      });
      return () => back.remove();
    }, [])
  );
  const rememberPath = useCallback(
    (url: string) => {
      if (!profile) return;
      const scope = `${profile.id}#${profile.serverUrl}#${params.path ?? ''}`;
      const path = shellPathFromUrl(url, profile.serverUrl);
      if (path === null) return;
      setVisited((prev) =>
        prev && prev.scope === scope && prev.path === path ? prev : { scope, path }
      );
    },
    [profile?.id, profile?.serverUrl, params.path]
  );
  const handshake = useMemo<NativeShellHandshake>(
    () => ({
      bridgeVersion: MOBILE_BRIDGE_VERSION,
      appVersion: '0.1.0',
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      profileMode: profile?.credential ? 'connect' : 'direct',
      secureContext: profile?.serverUrl.startsWith('https:') ?? false,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      capabilities: ['haptic', 'badge', 'share', 'open-external', 'open-native', 'safe-area']
    }),
    [profile?.credential, profile?.serverUrl]
  );
  if (storageError)
    return (
      <Screen>
        <Label>{storageError}</Label>
        <Label muted>Device storage could not be read. Restart Zana to retry.</Label>
      </Screen>
    );
  if (!ready) return <ActivityIndicator style={{ flex: 1 }} color={c.accent} />;
  if (!profile) return <Redirect href="/connect" />;
  if (unknownServer)
    return (
      <Screen>
        <Label>This link points to a server you haven’t added.</Label>
        <Action
          title="Add server"
          onPress={() =>
            router.replace({ pathname: '/connect', params: { server: params.server } })
          }
        />
        <Action secondary title="Cancel" onPress={() => router.replace('/')} />
      </Screen>
    );
  if (params.server && params.server !== profile.serverUrl)
    return <ActivityIndicator style={{ flex: 1 }} color={c.accent} />;
  const loadScope = `${profile.id}#${profile.serverUrl}#${params.path ?? ''}`;
  const loadPath = resolveShellLoadPath({
    visitedPath: visited && visited.scope === loadScope ? visited.path : null,
    requestedPath: params.path
  });
  const sourceUrl = profile.serverUrl + safePath(loadPath);
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="height">
      <SafeAreaView
        style={{ flex: 1, backgroundColor: c.background }}
        edges={['top', 'left', 'right', 'bottom']}
      >
        <View
          style={{
            minHeight: 52,
            paddingHorizontal: 12,
            flexDirection: 'row',
            gap: 10,
            alignItems: 'center'
          }}
        >
          <Text
            numberOfLines={1}
            style={{ flex: 1, color: c.text, fontWeight: '600', fontSize: 16 }}
          >
            {profile.label}
          </Text>
          <Action
            secondary
            title="Share"
            onPress={() => {
              void Share.share({
                message: currentUrl.current || sourceUrl,
                ...(Platform.OS === 'ios' ? { url: currentUrl.current || sourceUrl } : {})
              }).catch(() => {});
            }}
          />
          <Action
            secondary
            title="Reload"
            onPress={() => {
              setLoading(true);
              reconnect();
            }}
          />
          <Action secondary title="This device" onPress={() => router.push('/settings')} />
        </View>
        {error ? (
          <Screen>
            <Label>{error}</Label>
            <Action
              title={authError ? 'Pair again' : 'Try again'}
              onPress={() =>
                authError
                  ? router.push({ pathname: '/connect', params: { server: profile.serverUrl } })
                  : reconnect()
              }
            />
            <Action secondary title="Saved servers" onPress={() => router.push('/settings')} />
          </Screen>
        ) : !sessionReady ? (
          <ActivityIndicator style={{ flex: 1 }} color={c.accent} />
        ) : (
          <View style={{ flex: 1 }}>
            <ShellWebView
              ref={web}
              key={`${loadScope}:${revision}`}
              initialUrl={sourceUrl}
              style={{ flex: 1, backgroundColor: c.background }}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled={false}
              javaScriptEnabled
              domStorageEnabled
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction
              hideKeyboardAccessoryView
              // The renderer owns scrolling inside its panels. iOS must not pan
              // the whole document out of view while the keyboard resizes it.
              scrollEnabled={Platform.OS !== 'ios'}
              allowsBackForwardNavigationGestures={false}
              bounces={false}
              pullToRefreshEnabled={false}
              automaticallyAdjustContentInsets={false}
              contentInsetAdjustmentBehavior="never"
              setSupportMultipleWindows
              webviewDebuggingEnabled={__DEV__}
              mixedContentMode="never"
              allowFileAccess={false}
              injectedJavaScriptBeforeContentLoaded={buildBridgeInjectionScript(handshake)}
              onShouldStartLoadWithRequest={(request) => {
                if (isSameServer(request.url, profile.serverUrl)) return true;
                if (request.isTopFrame !== false && externalUrl(request.url))
                  void Linking.openURL(request.url).catch(() => {});
                return false;
              }}
              onOpenWindow={(event) => {
                if (externalUrl(event.nativeEvent.targetUrl))
                  void Linking.openURL(event.nativeEvent.targetUrl).catch(() => {});
              }}
              onNavigationStateChange={(navigation) => {
                canGoBack.current = navigation.canGoBack;
                if (isSameServer(navigation.url, profile.serverUrl)) {
                  currentUrl.current = navigation.url;
                  rememberPath(navigation.url);
                }
              }}
              onMessage={(event) => {
                void handleBridgeMessage(
                  event.nativeEvent.data,
                  event.nativeEvent.url,
                  profile.serverUrl,
                  {
                    inject: (script) => web.current?.injectJavaScript(script),
                    ready: () => setLoading(false),
                    openSettings: () => router.push('/settings'),
                    authRequired: () => {
                      setAuthError(true);
                      setError(
                        'Your connection has expired. Reload to reconnect, or pair this device again.'
                      );
                    },
                    openExternal: Linking.openURL,
                    badge: async (count) => {
                      await Notifications.setBadgeCountAsync(count);
                    },
                    share: async (payload) =>
                      Share.share({
                        title: payload.title,
                        message: [payload.text, payload.url].filter(Boolean).join('\n'),
                        ...(Platform.OS === 'ios' && payload.url ? { url: payload.url } : {})
                      }),
                    haptic: async (kind) => {
                      if (!state.haptics) return;
                      if (kind === 'selection') await Haptics.selectionAsync();
                      else if (kind.startsWith('impact-'))
                        await Haptics.impactAsync(
                          kind === 'impact-heavy'
                            ? Haptics.ImpactFeedbackStyle.Heavy
                            : kind === 'impact-medium'
                              ? Haptics.ImpactFeedbackStyle.Medium
                              : Haptics.ImpactFeedbackStyle.Light
                        );
                      else
                        await Haptics.notificationAsync(
                          kind === 'success'
                            ? Haptics.NotificationFeedbackType.Success
                            : kind === 'warning'
                              ? Haptics.NotificationFeedbackType.Warning
                              : Haptics.NotificationFeedbackType.Error
                        );
                    }
                  }
                );
              }}
              onLoadEnd={() => setLoading(false)}
              onError={(event) => setError(event.nativeEvent.description || 'Zana is unreachable.')}
              onHttpError={(event) => {
                if (event.nativeEvent.url !== sourceUrl) return;
                setAuthError(event.nativeEvent.statusCode === 401);
                setError(
                  event.nativeEvent.statusCode === 401
                    ? 'This device needs to be paired again.'
                    : `Server returned ${event.nativeEvent.statusCode}.`
                );
              }}
              onContentProcessDidTerminate={reconnect}
              onRenderProcessGone={reconnect}
            />
            {loading ? (
              <ActivityIndicator
                accessibilityLabel="Loading Zana"
                style={{ position: 'absolute', top: 16, right: 16 }}
                color={c.accent}
              />
            ) : null}
          </View>
        )}
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

type ShellWebViewProps = Omit<WebViewProps, 'source'> & { initialUrl: string };

/**
 * Captures its source URL once per mount so recording the visited in-app path
 * (React state) never reloads the live page. Only a new `key` — a fresh cookie
 * revision or a changed load scope — remounts and picks up a new URL.
 */
const ShellWebView = forwardRef<WebView, ShellWebViewProps>(function ShellWebView(
  { initialUrl, ...props },
  ref
) {
  const [source] = useState(() => ({ uri: initialUrl }));
  return <WebView {...props} ref={ref} source={source} />;
});
