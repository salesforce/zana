# Zana Mobile

Expo 57 / React Native shell for the Zana web application, based on BB's current mobile architecture. Native routes own pairing and device settings; threads and plugins run in the server's WebView. See [the architecture, setup and release guide](../../docs/mobile-app.md).

```sh
pnpm mobile:ios        # from repository root; Xcode + CocoaPods required
pnpm mobile:serve      # in another terminal, with the current Zana desktop running
```

Use the printed server URL and pairing code in Add server. A physical phone needs a reachable private-network or HTTPS gateway URL.

- `app/`: Expo Router routes, including validated inbound deep links.
- `src/lib/`: platform-independent profiles, authentication, links and bridge policy, covered by Vitest.
- `src/state.tsx`: serialized SecureStore persistence.
- `src/session.tsx`: one session and cookie owner above the router. Screens retained by deep links must never mint their own competing sessions.
- `src/notifications.tsx`: opt-in Expo push and notification taps.
- `e2e/flows/`: native Maestro flows.
- `eas.json`: development, preview and production build profiles. No signing accounts are embedded.
- `app.config.ts`: optional EAS identity and Android Firebase client config from the build environment; see `.env.example`.

Keep credentials native. Do not add Node/Electron imports to this package. Keep phone UI in the existing renderer when it represents product state; native screens own device capabilities only.

URL validation imports Expo's `whatwg-url-minimum` parser explicitly. React Native's fallback global URL behaves differently for custom schemes and path normalization; do not replace it based only on Node tests. Run the native acceptance flow after changing pairing, cookies or deep links (see the guide).

The pinned `@react-native-cookies/cookies@6.2.1` dependency has an Android-only pnpm patch in the repository's `patches/` directory: Maven Central replaces the removed Gradle `jcenter()` API, and the library namespace moves from its manifest to Gradle. Keep this patch until migrating to a maintained cookie library; its upstream is archived. Re-run both platforms' session acceptance when replacing it. A fresh Android build in `mobile-android.yml` guards native compatibility separately from bundle export. If an existing Android build still resolves the old pnpm path after applying the patch, remove only `android/build/generated/autolinking/autolinking.json` and rebuild to regenerate that cache.

Keep the WebView Back handler scoped to screen focus, so it cannot swallow Back on native settings. Both platforms need the shell’s height-based `KeyboardAvoidingView`; visual viewport handling inside the page alone does not keep the composer above the keyboard. iOS also disables root WebView scrolling and the keyboard accessory bar: the renderer owns inner scroll areas, and WKWebView must not pan the entire document out of view when the keyboard resizes it. Android exposes clipped WebView text as zero-height accessibility nodes; bound conversation selectors below the web header and above the composer when testing visibility. The native acceptance flow sends with the software keyboard visible and then scrolls a conversation longer than the viewport in both directions before checking settings and Android Back.

Pairing review guards: invalid scans clear the previous code; a scan only fills the form; Connect explicitly redeems it once. Ignore queued camera callbacks after accepting or cancelling a scan. Keep camera-permission failures recoverable through manual entry. Native forms resize around the Android keyboard and use iOS keyboard insets; Connect and Scan dismiss the keyboard to expose recovery controls. `src/connect.test.ts` mounts the real form/UI with mocked camera and network boundaries. The native expired-code and offline flows wait for the first screen and center fields before tapping because iOS accessibility can report a control behind the keyboard as visible.

The phone composer is renderer-owned: `ThreadComposerToolbar` and `mobile-shell.css` keep model/Send/Stop visible and disclose the other controls without remounting them. Returning focus to the editor closes the options so the software keyboard cannot leave them crowding the conversation. Do not swap editor instances on viewport changes; that would discard drafts. The mobile E2E checks 320px/390px geometry, draft retention, disclosure/Escape, touch-sized model rows, and the desktop transition. Keep the sponsor banner out of mobile composer views consistently; hiding it only while the editor has focus moves controls during a tap.

The timeline observes its own viewport as well as row sizes while following the latest message. Keyboard/options resize must not strand it above the reply. A successful local send resumes following, including queued sends that have no optimistic row; failed-send cleanup and another thread’s events must preserve scrollback. `ThreadTimeline.scroll.test.tsx` covers these boundaries; native acceptance verifies the reply is actually inside the visible conversation area after Send.
