# Zana Mobile beta — privacy notice draft

Updated 28 September 2026 for the next Zana Mobile 2.3.0 beta, bundle `ai.zana.mobile`. The GitHub phone sign-in described here is prepared in source and requires the corresponding service and mobile release.

**Publication status:** draft; not a live privacy-policy URL. Complete the publisher contact and hosted-service retention details below before using this notice in TestFlight. The facts about local storage, pairing and notifications were checked against the mobile and gateway source. Hosted service operation must match the service actually deployed for testers.

## Who operates this beta

Zana Mobile is distributed through the Apple Developer account of Guillaume Rebmann. The publisher's privacy contact is **[confirmed contact email required]**. If you connect to a computer operated by your employer or another person, that operator also controls the projects, agents and records on that computer. Ask that operator about its own data handling.

## What the app does with your information

Zana Mobile connects to a Zana server you select. The server sends the app the projects, conversations and other content you open. Messages and actions you submit from the phone go to that server. Agents run on the connected computer and may send information to the AI providers, tools and plugins configured there. Their processing depends on those services and the computer's settings.

The local sample demo uses scripted replies. Text entered into the demo is held in memory, is not saved as a conversation and is not sent to a Zana server or AI provider. Resetting the demo clears the sample exchange.

## Information saved on your phone

The app saves server addresses and labels, the active server, pairing credentials, account access, pending browser sign-in requests, appearance and haptic preferences. It uses the operating system's secure storage for these settings and credentials. On iPhone, the app requests storage accessible while the device is unlocked and restricted to that device. The embedded web view also uses session cookies and may retain cached content or web storage for the connected server.

In **This device**, choose **Forget** for a saved server to remove that profile and its credential from the app and clear its mobile session cookie. An independently saved account credential remains available to discover other computers; revoke phone access on the account page to invalidate it. This does not delete conversations or project files from the computer, revoke the phone on the server, or promise to erase every web cache. Secure storage may persist across app reinstalls, so uninstalling alone is not a reliable way to revoke access.

## Pairing and connection information

Normal Zana Connect sign-in opens GitHub in the browser and asks you to approve the phone. The app stores a temporary polling secret in secure storage and exchanges it for a revocable account credential over HTTPS. The browser does not receive that credential.

The account service keeps identifiers and authorization records for approved phones. A compatible desktop can receive a temporary session identifier, platform, app version and recent connection time to show that the phone is connected.

Connections pass through Zana Connect on Heroku. The relay operator can access traffic where it terminates HTTPS; this is not a claim of end-to-end encryption. Local Wi-Fi, direct server URLs and QR pairing are no longer supported. Profiles from earlier builds remain on the phone for identification and removal but cannot reconnect.

If you use Zana Connect, the account service associates your signed-in identity with registered computers, devices, pairing codes and sessions so it can authorize access. The current website implementation uses GitHub sign-in and stores the GitHub user identifier, login, avatar URL and account creation time, alongside account and connection records. Hosting and network providers may process connection metadata such as IP addresses, request times and errors. **Before publication, name the deployed service operators and specify their log, account and backup retention and deletion process.**

## Notifications and device permissions

Background push is not yet available for Zana Connect accounts. This build does not register legacy gateway push tokens or offer a notification toggle. Earlier builds may have registered a token with a gateway; removing a saved profile does not contact that gateway. Revoke the old device on its computer to remove that legacy registration. For a device that still has a legacy registration, a notification shows the thread title and a short excerpt of the question or result (control characters and Markdown removed, secrets redacted, never file contents or tool output) through Expo's push service; turning off "Show previews in phone notifications" in Settings > Agents sends generic text instead. Each thread's notification level (All activity, Needs input only, Muted) is stored on the computer only.

The current source does not request camera or local-network permission. Phone sign-in uses browser approval and HTTPS. Notification links retained from older builds are validated against saved profiles and cannot reconnect a retired profile.

When you use the system share sheet or open an external link, information goes to the destination you choose. That app or website's privacy practices apply. Connected desktop features and plugins may also request information or permissions for the actions you use.

## TestFlight diagnostics and feedback

Apple processes beta installation, usage, crash and feedback information through TestFlight and makes relevant information available to the developer. Feedback you choose to send may contain your contact details, screenshots and other content you include. Avoid including passwords, pairing credentials or confidential project information in feedback. Apple's current [TestFlight information](https://testflight.apple.com/) explains its beta data collection.

The native shell does not include a dedicated advertising or analytics SDK in the inspected release dependencies. This does not mean that connected desktop plugins, configured AI services, hosting providers or Apple collect no information. For example, desktop analytics plugins can have their own configuration and data handling.

## Retention, revocation and requests

Saved server profiles remain on the phone until you remove them. Use the account page or desktop **Settings → Phone** to revoke phone access. Legacy local gateway device credentials have a 90-day lifetime in the retained backend implementation. Expiry prevents authorization, but it is not a guarantee of immediate deletion of an expired record from disk. Conversations, project files, logs and backups on the computer follow that computer's retention and deletion settings.

To stop phone access, revoke the phone on the account page and forget saved profiles on the phone. For a hosted account or service, use its available device/session revocation controls and contact the service operator about account information or deletion requests. Contact **[confirmed privacy email required]** about beta feedback or publisher-held information. **Before publication, confirm a specific retention period or retention criteria for publisher-held feedback, hosted account records, service logs and backups, plus a working request/deletion process.**

## Changes to this notice

The published notice will carry its effective date. Update it when the beta's processing or service providers change, and make the current notice reachable from the app and its TestFlight listing.

---

## Implementation evidence for the publisher (remove from the published notice)

- Native storage and profile removal: `apps/mobile/src/state.tsx`, `apps/mobile/src/lib/profiles.ts`, `apps/mobile/src/lib/session-controller.ts`, `apps/mobile/app/settings.tsx`.
- Sign-in/session requests and account discovery: `apps/mobile/src/lib/client.ts`.
- Demo behavior: `apps/mobile/app/demo.tsx`.
- Legacy notification handling and backend payload: `apps/mobile/src/notifications.tsx`, `apps/server/src/mobile/push.ts`, `apps/server/src/mobile/device-store.ts`.
- Native dependency and permission declarations: `apps/mobile/package.json`, `apps/mobile/app.json`.
- Desktop connection presence: `apps/app/src/lib/mobile-readiness.ts`, `apps/server/src/mobile/readiness.ts`.
- Hosted account identity: `website/app/api/auth/github/callback/route.ts`, `website/lib/db/schema.pg.ts`; deployment and retention must be confirmed separately.
- Apple [privacy review guidance](https://developer.apple.com/app-store/review/guidelines/#privacy), [TestFlight information](https://testflight.apple.com/), and Expo [push notification FAQ](https://docs.expo.dev/push-notifications/faq/).

Related release finding: earlier builds displayed the hardcoded footer `Zana Mobile 0.1.0`; source now reads the configured version. Separately, a generated Xcode tree held stale **0.1.0 / build 1** metadata despite Expo declaring 2.3.0. Use signed and installed native metadata for acceptance; neither a footer nor Expo config proves the installed version. These source changes require a new signed build.
