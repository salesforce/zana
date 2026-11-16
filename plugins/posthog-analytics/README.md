# PostHog Analytics (retired)

PostHog analytics has been shut down. This plugin is no longer automatically
installed or listed in the plugin catalogue. Startup removes existing first-party
installations and their saved settings when users install an app build containing this change.

The remaining server and renderer entries are inert compatibility stubs. They
never read a key, subscribe to events, observe clicks or navigation, or make
network requests, even when old settings still enable analytics.

Releases no longer bundle a PostHog project key, and local development no longer
loads one from `.env`.

Previously released apps already contain the former project key. Removing the
release secret cannot change those binaries. To stop ingestion from those apps,
rotate the project key in PostHog and delete the backup key for the old value.
See [PostHog API key documentation](https://posthog.com/docs/api).
