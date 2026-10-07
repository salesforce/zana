# Google Analytics

An independent GA4 plugin for comparing Google Analytics with PostHog. It is
installed and enabled by default. It sends nothing until a Measurement ID and
Measurement Protocol API secret have been configured. PostHog remains separate:
changing this plugin's settings never changes PostHog's settings.

Open **Plugins → Google Analytics** and enter a **GA4 Measurement ID** (`G-…`)
and a **Measurement Protocol API secret**. Use a Web data stream, preferably a
separate stream for the app. Create the secret under GA4 **Admin → Data streams
→ your Web stream → Measurement Protocol API secrets**. See
[Google's setup guide](https://developer.chrome.com/docs/extensions/how-to/integrate/google-analytics-4#step_1_create_a_web_data_stream).

Turn off **Connect Google Analytics** to disconnect immediately. Turn off
**Track page views** to measure app presence only. Both switches default on
for configured installs. Disabling or uninstalling the plugin stops collection;
an uninstall is respected on the next app launch.

| Event | When | Data |
| --- | --- | --- |
| `app_open` | A visible app window opens, or tracking reconnects | Session id and engagement time |
| `page_view` | Initial visible page and changes of section | Fixed page title and synthetic URL, session id, engagement time |
| `user_engagement` | Every minute while the app document is visible | Session id and engagement time |

An installation has a locally stored random UUID (`client_id`). Multiple windows
share an installation and a session; a session expires after 30 minutes without
recorded activity. Heartbeats indicate a **visible app**, not proof that a person
is actively typing. Hidden/minimized windows do not send heartbeats. Engagement
samples are bounded so suspended/background time is not counted.

Page names include Home, Agents, Inbox, Settings, Plugins, Explorer, Library,
and other fixed project sections. Dynamic plugin destinations are grouped as
Plugin. Actual URLs, query strings, fragments, document titles, project ids,
thread ids, prompts, replies, file paths, and click contents are never sent.
`page_location` is a synthetic `https://app.zana.ai/<fixed-section>` label; it
does not navigate to that address. Advertising consent fields are sent as
`DENIED`. Requests go directly from the plugin server to Google, which receives
the network connection's IP address. The random id is pseudonymous, not an
account or email, and counts installations rather than unique people.

## View and compare

In GA4, use **Reports → Realtime** for recent activity and pages. The plugin
includes `session_id` and `engagement_time_msec`, which
[Google recommends for Realtime](https://developer.chrome.com/docs/extensions/how-to/integrate/google-analytics-4#use_recommended_parameters_session_id_and_engagement_time_msec).
Explore `app_open`, `page_view`, and `user_engagement` to see opens and section
usage. For comparable page numbers, enable page tracking in PostHog as well;
its existing agent lifecycle events are a different activity measure.

This uses GA4 Measurement Protocol without loading remote JavaScript. Google
documents [partial reporting for Measurement Protocol-only collection](https://developers.google.com/analytics/devguides/collection/protocol/ga4#full_server-to-server).
An HTTP success means the collection endpoint accepted the request, not proof
that every event appears in GA4 reports. Live Google receipt must be checked in
the configured property; tests verify the outgoing protocol with a local
collector rather than polluting a real property's reports.

## Server configuration and tests

The plugin reads `ZCC_GA4_MEASUREMENT_ID` and `ZCC_GA4_API_SECRET` as defaults
from the product server environment. The generic plugin build/package loop also
calls this plugin's `build.mjs`, which writes a git-ignored release asset from
those variables. The existing packager ships it via `zcc.extra.runtimeAssets`.
Set the same two GitHub Actions repository secrets to connect future official
releases automatically. Without them, builds remain unconfigured. Runtime
environment values override release defaults; saved credentials override both.
The disconnect switch takes precedence over every credential source. This
change does not embed a real property or secret in the repository. A secret
distributed with a desktop app can be extracted; use a dedicated ingestion
secret that can be rotated, never an account/admin credential.

```sh
pnpm exec vitest run plugins/google-analytics
pnpm test:e2e -- e2e/google-analytics.spec.ts
```

The E2E uses fake credentials and `ZCC_E2E=1` with the plugin-owned
`ZCC_GA4_TEST_ENDPOINT` loopback override. Ordinary use ignores that override.
The server validates the fixed event/page schema, bounds in-flight requests and
remembered windows, times out collection after five seconds, aborts in-flight
requests on disconnect/unload, and logs no secret-bearing URLs or exceptions.
The renderer polls the route once a second instead of wrapping History, so
multiple analytics plugins can coexist and dispose independently.
