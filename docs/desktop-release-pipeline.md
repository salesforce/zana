# Desktop release pipeline

`.github/workflows/release.yml` builds macOS Apple Silicon, macOS Intel, and
Windows x64 on native GitHub-hosted runners. Pushing a `v<version>` tag runs
typechecking, unit tests, and the Linux Electron boot/IPC gate before packaging.
All three packages must succeed before the workflow creates a draft release on
`salesforce/zana`. A human publishes the draft.

The Windows job builds an NSIS installer named
`Zana-Command-Center-<version>-win-x64-Setup.exe`. It launches
`dist/win-unpacked/Zana.exe` with an isolated home, exercises renderer/server IPC,
and checks the packaged OpenCode executable and node-pty/ConPTY. It uses the
package's native modules instead of the checkout's modules. A smoke failure
blocks uploading the installer and creating the draft release.

Startup migration and product stores flush file contents before an atomic rename.
They also flush the parent directory on POSIX; Windows skips that unsupported
directory operation while retaining file flushes and conflict checks. The native
smoke probe loads Node built-ins through `process.getBuiltinModule` so it works
in Electron's ESM main process.

Every packaging path prepares compiled plugin runtimes in `out/packaged-plugins`.
The package includes bundled server, app and PTY entries, prebuilt provider host
artifacts, skills and declared runtime assets. Shipped providers validate these
artifacts without recompiling retained source or requiring build dependencies.
Provider startup, reload, corruption and recovery checks run against each
packaged executable.

Mac packages run the same boot/IPC smoke alongside packaged plugin authoring.
Failed Mac checks retain a Playwright report per
architecture, as the Windows job does.

The release includes Windows `.exe`, `.blockmap`, and `latest.yml` assets alongside
the Mac `.dmg`, `.zip`, `.blockmap`, and merged `latest-mac.yml` assets. Both update
feeds use the existing public GitHub repository. Manual `workflow_dispatch` runs
build and test the same packages, retaining them as workflow artifacts without
creating a GitHub release.

Windows signing uses the optional repository secrets `WIN_CSC_LINK` (certificate
file encoded as base64, or an HTTPS certificate URL) and `WIN_CSC_KEY_PASSWORD`.
These are separate from the Mac `CSC_LINK`/Apple notarization secrets. Without
Windows signing credentials, the pipeline produces an unsigned installer. Add
the credentials to produce signed installers; unsigned downloads can prompt
Windows SmartScreen. See the
[electron-builder Windows signing guide](https://www.electron.build/docs/features/code-signing/code-signing-win/).

For local packaging on Windows, run `pnpm dist:win`. Local packaging passes
`--publish never`; release publication belongs to the workflow. OpenCode staging
selects the build host's platform and uses `opencode.exe` on Windows. The POSIX
scheduled supervisor is bundled only on macOS/Linux.

## Release notes and version bumps

A version bump touches `package.json` (and `package-lock.json`),
`apps/mobile/app.json`, the website version pins (`website/.env.example`,
`website/Dockerfile`, `website/heroku.yml`, `website/lib/site.ts`), and adds
`docs/releases/<version>.md`.

That one notes file is shown in three places:

1. **The GitHub release body.** The workflow's `body_path` copies the file into
   the draft release.
2. **The update banner's "What's new" preview, before installing.** The app
   reads the release body back from the update feed and converts it to markdown
   in the main process (`apps/desktop/src/update-release-notes.ts`).
3. **The What's New modal after installing.** electron-builder bundles
   `docs/releases` into the app.

When you bump the version:

- **Write the notes before you tag.** `pnpm run check:release-notes` runs in the
  release `verify` job and fails if the file is missing or shorter than 80
  characters, or if the pushed tag doesn't match `package.json`.
- **Use headings, paragraphs, lists, emphasis, links and code only.** The
  feed conversion drops images, tables and raw HTML, so the guard rejects them.
  It also rejects notes over 32 KB, which the preview would truncate. Bundled
  media, such as the 2.3.0 video, goes in `ReleaseNoteVideo`, keyed by version.
- **Keep the GitHub body in sync after drafting.** The draft body is copied once,
  when the workflow runs. If you fix the notes later, edit
  `docs/releases/<version>.md` *and* the release body on GitHub. Users who
  haven't updated yet read the GitHub copy; users who have updated read the
  bundled one.
