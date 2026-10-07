App opens, visible activity, and coarse page views in your Google Analytics 4
property. Runs independently alongside PostHog so you can compare the two.

## What you get

- App-open events and a visible-app activity ping every minute.
- Initial page views and navigation between fixed sections such as Agents,
  Inbox, Settings, Explorer, and Library.
- A disconnect switch and a separate switch for presence-only measurement.

The plugin is installed and enabled by default but sends nothing until a GA4
Web stream's Measurement ID and Measurement Protocol API secret are configured
in plugin Settings or supplied to the product server. Disable or uninstall it
at any time; an uninstall is respected on future launches.

Events use a random installation id. They never include prompts, replies,
titles, paths, actual URLs, or project/thread ids. Google receives the direct
network connection. Visible activity indicates an open app, not typing or an
exact count of people. Measurement Protocol-only reporting has limitations;
verify live events in your own GA4 Realtime report.
