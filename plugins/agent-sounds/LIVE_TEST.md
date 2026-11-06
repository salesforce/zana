# Verify Sound Studio

Use a private built Electron profile, not the user's config:

```sh
pnpm test:e2e -- e2e/sound-studio-plugin.spec.ts
```

The test copies the plugin outside the checkout and installs that copy through the real native path-install flow. It imports two generated WAVs padded with a valid RIFF JUNK chunk to the 1 MiB per-file limit through the page and actual RPC transport, previews one, enables events, closes the page, opens a second project window, reloads the main renderer, and checks Chromium audio events after real fake-provider idle/input transitions. Disabling the plugin while an idle alert is pending must prevent that alert. Re-enabling must preserve the pack.

For manual development, install the plugin, edit the title in `app.tsx`, run `zcc plugin dev . --once`, and verify the open page updates. Restore the title and reload. Test both app themes and a narrow window. Older hosts must display the explicit update message instead of claiming that automatic notifications work.

Audio and preferences persist transactionally in the plugin SQLite database; the test must not raise the host KV quotas. Unit tests also fill all eight packs with paired 1 MiB clips, reload, and cover failed transaction rollback.
