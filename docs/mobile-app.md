# Zana Mobile

Zana Mobile is an Expo / React Native iOS and Android shell around the existing Zana web application. Threads, composer, approvals, projects, files and plugin panels use the same renderer and product API as desktop. Agent execution stays on the computer.

## What BB does, and what we adopted

Inspected `/Users/grebmann/zcc-workspace/bb` at commit `9e1641114`, especially `apps/mobile/README.md`, `apps/mobile/src/screens/webview/ProfileWebViewScreen.tsx`, `useShellBridge.ts`, the profile/session/link modules, `packages/mobile-bridge`, `packages/connect-client`, and the mobile plans.

BB's **current implementation** is its WebView shell (#2515). Its older `plans/bb-mobile-expo.md` / progress log describes an earlier effort to recreate product screens natively; that is not the current app architecture. Copying those historical plans would produce the wrong implementation.

| Concern | BB | Zana implementation |
| --- | --- | --- |
| Product UI | Server's web app in React Native WebView | Existing Zana renderer and `/api/v1` + `/ws` |
| Native shell | Expo 57, Router, native server/device screens | `apps/mobile` with the same shell structure |
| Phone authentication | BB Connect account machine enrollment and desktop-session cookie | Opt-in local mobile gateway, one-use pairing code, revocable device credential and HttpOnly browser session |
| Saved servers | SecureStore profiles | Serialized, validated SecureStore profiles, max 12 |
| Device bridge | Versioned, schema-validated messages | MIT-licensed BB bridge adapted as `@zana-ai/zcc-mobile-bridge`; original license retained |
| Deep links | BB scheme / hosted universal links | `zana://connect` and `zana://open`; only saved servers open automatically |
| Navigation | Phone web layout | Drawer through 1024px on web/mobile, keyboard viewport sizing, full-width file panel; desktop layout preserved. A cold start opens the new-thread page unless a deep link or notification requests a path; the last visited page is held in memory only (never persisted) so a cookie refresh, Reload or WebView process recovery restores where the user is, while a new deep link still wins |
| Inbox and main views | Shared responsive renderer | Inbox opens Feed/Saved reports as a full-width detail with Back; filters and list position survive. Documents stack, Agents list previews sit below the list, and page controls wrap on narrow screens. |
| Composer | Responsive product UI | Model and Send/Stop stay visible; an expandable options panel holds mode, thinking effort and send behavior. Phone controls and picker rows have 44px touch targets; drafts survive resizing. |
| Push | Expo push registration and backend plugin | Opt-in per-device Expo push registration and one gateway subscription; generic completion / attention alerts |
| Builds | EAS and native Xcode/Android builds | Local native commands and EAS development, preview and production profiles |

ZCC's existing Connect plugin is a host-tunnel status surface; it does not implement BB's hosted accounts, machine-code redemption or cloud gateway. This change does not point Zana at BB's production services, copy its EAS project, or reuse its signing identities.

## Install on your phone with AI

In the desktop app, open **Settings → Phone → Install with AI**. The button opens the standard agent composer with an editable installation prompt; press **Send** to start. The agent identifies the connected physical phone, checks the tools and source, builds and installs the app, and helps pair it with the running desktop. Opening the composer does not start an agent or enable phone access.

1. Connect and unlock your phone over USB.
2. On iPhone, trust the Mac and enable **Settings → Privacy & Security → Developer Mode**, restart, then confirm **Turn On**. Local installation requires macOS, Xcode and an Apple signing account. On Android, enable **Developer options → USB debugging** and accept the computer's authorization prompt; the agent can help prepare the Android SDK tools.
3. Keep both devices on the same trusted network. In desktop **Settings → Phone**, enable phone access and show the pairing QR. In the installed app, select **Add server → Scan pairing QR → Connect**, and allow local-network access if requested. Keep Zana desktop running.

The agent asks for phone-only confirmations as needed and preserves existing app data when updating. It verifies launch and pairing before reporting success. Platform setup references: [Apple Developer Mode](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device), [Android USB debugging](https://developer.android.com/studio/debug/dev-options).

## Start on an iOS simulator

Prerequisites: pnpm, Xcode with an iOS simulator, CocoaPods.

```sh
pnpm install
pnpm mobile:ios
```

Keep Zana desktop running with a **current production build** of this checkout, then in another terminal:

```sh
pnpm mobile:serve
```

This starts the authenticated gateway at `http://127.0.0.1:8785`, forwarding to the running desktop server at `http://127.0.0.1:8780`. If the desktop uses another port, pass `--upstream http://127.0.0.1:<port>`. The gateway prints the URL, pairing code, deep link, terminal QR code and QR payload. In the phone app, choose **Add server → Scan pairing QR**, allow camera access, scan the terminal code, then review the server and tap **Connect**. Scanning only fills the form; it does not connect automatically. The code is single-use and expires after five minutes. Invalid or expired scans clear any previous code. Manual entry remains available if camera access is unavailable. On a simulator, open the printed deep link instead.

The gateway's interactive commands are:

- `pair`: replace the pending code with a fresh five-minute, single-use code.
- `devices`: show paired device IDs and expiry without credentials or push tokens.
- `revoke <id>`: revoke the device, browser sessions and active sockets immediately.
- `quit`: close the gateway and all its sockets.

Device credentials expire after 90 days. The server stores only their SHA-256 hashes in `~/.zcc/mobile/devices.json` (atomic writes, mode 0600, max 20 devices). Browser cookies last 12 hours; the native shell renews them before expiry and when returning to the foreground. Forgetting a server clears its native and WebView session cookies. Restarting the gateway preserves paired devices but expires all browser sessions; use Reload in the phone to mint a fresh session.

`pnpm mobile:dev` starts Metro for a development client. `pnpm mobile:android` builds the Android app when the Android SDK is installed. To use the default loopback gateway on an Android emulator or USB-connected phone, run `adb -s <device-serial> reverse tcp:8785 tcp:8785` and use `http://127.0.0.1:8785` in the app. Remove the mapping with `adb -s <device-serial> reverse --remove tcp:8785` when finished. `adb devices` lists serials. This keeps the gateway local while testing.

## Connect a physical phone

Use a reachable HTTPS URL, for example a private Tailscale Serve endpoint or an HTTPS reverse proxy, targeting the gateway at `127.0.0.1:8785`:

```sh
pnpm mobile:serve --public-url https://your-mac.example --upstream http://127.0.0.1:8780
```

The proxy must preserve the public Host header and support WebSocket upgrades. Public URL validation is exact. Keep the existing ZCC product server loopback-only. The mobile gateway is the remote authentication boundary; it does not forward host enrollment, MCP, installer routes, host credentials or caller-supplied forwarding headers.

For trusted LAN development only, bind explicitly to the computer's LAN address and use that address as the public URL:

```sh
pnpm mobile:serve --host 192.168.1.10 --public-url http://192.168.1.10:8785
```

HTTP is permitted by the native app only for private IPv4 addresses, localhost/loopback and `.local` names. Use HTTPS for access outside that private network. Direct mode in Add server is for an already-private web endpoint or the iOS simulator's loopback product server; paired mode is the normal phone path.

## Notifications and device features

The **…** button in the phone header opens **Share**, **Reload**, and **This device**. On iPhone these appear in a native action sheet. The server name appears in that sheet instead of a second toolbar. Reload renews the native session and restores the current page. If the desktop serves an older interface, or the page cannot load, a compact native header keeps these actions accessible. The integrated menu requires mobile bridge v3 on the phone and the updated desktop renderer.

The phone navigation drawer fills the screen. **New Chat** and **Agents** stay pinned above the scrolling menu, followed by **Inbox**, **History**, and a collapsed **More** section for Scheduler, Plugins, and plugin-contributed destinations. **Projects** opens expanded, including projects with sessions, and **Filter projects** sticks below the pinned actions while you scroll. A project's menu provides **New agent**. The drawer's disclosure state is local to the phone and does not change the saved desktop sidebar layout.

**… → This device → Enable notifications** opts a paired profile into Expo push. The gateway observes live thread transitions independently of the foreground page, so it can deliver completion and pending-input alerts while the app is suspended. Payloads contain only generic status text plus a server URL/thread route; no prompts, code, paths or model output are sent to Expo. Disabling notifications removes the token from the server. Revoking a device also removes its push registration.

Before enabling push on a signed physical device:

1. Create a **Zana-owned** Expo EAS project and configure its project ID (`EXPO_PUBLIC_EAS_PROJECT_ID`, or `extra.eas.projectId`). `app.config.ts` also accepts `EXPO_OWNER`; see `.env.example`.
2. Configure APNs / FCM credentials in that project and your signing identities. For Android, set `GOOGLE_SERVICES_JSON` to the Firebase client `google-services.json` path (an EAS file variable for cloud builds). This becomes `android.googleServicesFile` during prebuild. The FCM service-account private key belongs in EAS Credentials, not in the app or this variable.
3. Rebuild the native app, then enable notifications per saved server.

No remote notifications are sent unless a phone explicitly registers. Expo transport failures are contained, queues and payloads are bounded, and expired device tokens are removed when Expo reports `DeviceNotRegistered`. Delivery remains best-effort; the thread itself is the source of truth.

Native functionality also includes QR scanning, saved-server switching, appearance/haptic preferences, external links, share requests, badge updates, Android back navigation, a home-screen device-settings shortcut, WebView process recovery and notification deep links. Device credentials never travel through the JavaScript bridge.

## Validation

```sh
pnpm mobile:test
pnpm --filter @zana-ai/zcc-mobile typecheck
pnpm --filter @zana-ai/zcc-mobile exec expo install --check
pnpm --filter @zana-ai/zcc-mobile export
pnpm typecheck
pnpm test:e2e -- e2e/mobile-shell.spec.ts e2e/sidebar-shell.spec.ts
```

`e2e/mobile-shell.spec.ts` boots an isolated production Electron build, creates a deterministic fake-provider thread, pairs through the real gateway, opens the renderer at phone size in a browser without Electron preload, sends a message, exercises the drawer and wide-screen resize, and verifies revocation without breaking desktop access. `e2e/mobile-views.spec.ts` checks the main views at 320, 390 and 820 pixels, with populated Inbox/Saved reports, document switching, a fake-provider agent, paused schedules and desktop split-layout restoration. Gateway unit/integration tests use real HTTP and WebSocket sockets. Native Maestro flows are under `apps/mobile/e2e/flows`; pass a freshly generated `PAIR_LINK` for pairing.

With the native app installed on a booted simulator and [Maestro](https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli) / Java 17+ installed, enable the native acceptance step in the same isolated production test:

```sh
MAESTRO_CLI_NO_ANALYTICS=1 ZCC_MOBILE_MAESTRO=maestro \
  ZCC_MOBILE_DEVICE=<simulator-id> \
  pnpm test:e2e -- e2e/mobile-shell.spec.ts
```

This generates a fresh pairing link, drives the native Connect screen, opens the live thread through the real WebView cookie jar, types and sends a message, checks the reply and device settings, and captures a native screenshot in the test's private artifact directory. Both platforms check sending with the software keyboard visible and scrolling a conversation longer than the viewport; Android also checks hardware Back from settings. The standard CI job typechecks the native package and exports both mobile bundles. The separate `mobile-android.yml` workflow builds a standalone Android test APK and retains it for seven days; no signing credentials or iOS simulator are required.

For Android, install the native Release APK first and add `ZCC_MOBILE_ADB`:

```sh
MAESTRO_CLI_NO_ANALYTICS=1 ZCC_MOBILE_MAESTRO=maestro \
  ZCC_MOBILE_DEVICE=emulator-5554 ZCC_MOBILE_ADB="$ANDROID_HOME/platform-tools/adb" \
  pnpm test:e2e -- e2e/mobile-shell.spec.ts
```

The test creates and removes its own port reverse, refuses to replace an existing mapping, and saves Maestro output on failure as well as success. Use a dedicated test simulator/emulator; the native flow saves a test server profile. Native recovery checks can also run without a server:

```sh
maestro --device <device-id> test \
  apps/mobile/e2e/flows/invalid-pairing.yaml \
  apps/mobile/e2e/flows/unreachable-server.yaml
```

These wait for the first native screen before opening links, verify the expired-code message, and manually enter an unreachable server before asserting a real connection error and usable Connect button. They use synthetic data and never submit a real pairing credential. Camera callback tests cover malformed and duplicate scans and permission failures; scanning a physical display with the phone camera still needs device acceptance.

## Installable builds

Run EAS commands from `apps/mobile`. Copy `.env.example` to `.env.local` for local identity settings, then configure the same project ID and owner in the selected EAS environment. Neither value is a secret. Signing credentials are managed separately by EAS.

| Profile | Result | Use |
| --- | --- | --- |
| `development` | iOS simulator development client / Android development client | Metro development |
| `development-device` | Physical-device development client | Metro over a reachable network |
| `preview` | Signed iOS ad hoc app / Android APK | Install on registered iPhones or Android phones without Metro |
| `preview-simulator` | Standalone iOS simulator app | Native acceptance without Metro |
| `production` | Store-signed iOS app / Android AAB | TestFlight / store upload, separate from building |

After the Zana-owned EAS project and signing accounts are configured:

```sh
cd apps/mobile
pnpm dlx eas-cli@latest build --profile preview --platform android
pnpm dlx eas-cli@latest build --profile preview --platform ios
```

Physical iOS preview builds require registered device UDIDs (`eas device:create`) and a provisioning profile containing them. `production` uses EAS-managed build numbers and increments them for each build. Building does not submit to either store. Keep the gateway running at the reachable URL used for pairing.

A local Android Release APK can also be built without EAS:

```sh
pnpm --filter @zana-ai/zcc-mobile exec expo prebuild --platform android
cd apps/mobile/android
./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
adb -s <device-serial> install -r app/build/outputs/apk/release/app-release.apk
```

Expo's generated local Release variant uses its development keystore until a signing configuration is supplied. It is suitable for local acceptance, not store upload. Do not distribute that test key as Zana's release identity. Native build folders and local credentials are ignored by Git.

## Release boundaries and remaining parity

The app source and build profiles are present; no App Store/TestFlight or Play publication has been performed. `ai.zana.mobile` is the project bundle identifier and must be registered with the account used for signing. BB's hosted account discovery, universal links and inbound OS share-extension target are not implemented by this change. BB’s share-intent handler is optional as well: its current package manifest does not install the share-extension module. Arbitrary plugin panels inherit their existing web responsiveness; native desktop-only affordances remain unavailable on a phone. Local native Release builds are available for both platforms. Android uses the repository's version-pinned cookie-library compatibility patch; a JavaScript export alone cannot catch its Gradle and manifest requirements. APNs/FCM delivery requires a signed physical-device acceptance test.

Skills, MCP management and the plugin catalogue currently require desktop APIs. Their mobile/web pages explain where to manage them instead of attempting unavailable calls. Installed plugins remain visible. The responsive view audit checks layout and navigation; it does not imply that every desktop action or third-party plugin is available on mobile.

References: [Expo monorepos](https://docs.expo.dev/guides/monorepos/), [Expo WebView](https://docs.expo.dev/versions/latest/sdk/webview/), [React Native WebView reference](https://github.com/react-native-webview/react-native-webview/blob/master/docs/Reference.md).

Release references: [Expo Android APK builds](https://docs.expo.dev/build-reference/apk/), [FCM credentials and native client configuration](https://docs.expo.dev/push-notifications/fcm-credentials/), [EAS environment variables](https://docs.expo.dev/eas/environment-variables/), [EAS app versions](https://docs.expo.dev/build-reference/app-versions/).
