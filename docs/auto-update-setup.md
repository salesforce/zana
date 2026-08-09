# Auto-update setup (Developer ID + notarization)

**Status:** upgraded 2026-06-19
**One-line:** The app updates itself across releases via electron-updater +
GitHub Releases, signed with an Apple Developer ID certificate and notarized.

## How it works

- electron-builder publishes `latest-mac.yml` + a `.zip` + `.dmg` to the public
  GitHub Release repo **github.com/salesforce/zana** for each `v*` tag
  (`publish:` block in `electron-builder.yml`).
- On launch (and from **Settings → About → Check for updates**), the packaged
  app fetches `latest-mac.yml` from that public repo **anonymously** (no token,
  no VPN), compares versions, and — if newer — **downloads in the background**
  and **installs on the next quit** (`autoInstallOnAppQuit`). No mid-session
  interruption.
- Wiring: `src/main/updater.ts` (autoUpdater wrapper) → `safeSend` push channels
  (`IPC.updates.*`) → `useUpdates` store + toasts + the About section.
- In dev / any unpackaged run the updater is a **no-op** (reports `disabled`) —
  electron-updater can't run there and throws if asked to.

## Why signing + notarization is required

macOS auto-update uses Squirrel.Mac, which **refuses to update an unsigned app**
and requires the new build to share the **same signing identity** as the running
one. So:

- Every release must be signed with the **same** Developer ID certificate.
- The **first** signed release is only a baseline — you can't auto-update *into*
  it from an older unsigned build. The update path is exercisable from the
  **second** signed release onward.
- With Developer ID + notarization, a **fresh install opens without Gatekeeper
  prompts** — no manual bypass needed. Auto-updates after that are seamless.

## One-time: obtain a Developer ID certificate

### 1. Enroll in the Apple Developer Program

- Go to [developer.apple.com](https://developer.apple.com/programs/enroll/)
- Enroll as an individual or organization ($99/year)
- Wait for approval (typically 24-48 hours)

### 2. Create a Developer ID Application certificate

On a Mac with Xcode installed:

1. Open **Keychain Access** → *Keychain Access* menu → *Certificate Assistant* →
   *Request a Certificate from a Certificate Authority*
2. Enter your email, check "Saved to disk", Continue
3. Go to [developer.apple.com/account/resources/certificates/list](https://developer.apple.com/account/resources/certificates/list)
4. Click + to add a certificate
5. Select **Developer ID Application** (NOT "Mac App Distribution")
6. Upload the `.certSigningRequest` file you saved, Continue
7. Download the `.cer` file
8. Double-click the `.cer` to install it into your **login** keychain

You should now see "Developer ID Application: Your Name (TEAM_ID)" in Keychain
Access under *My Certificates*.

### 3. Export the certificate as .p12

1. In Keychain Access, find the Developer ID Application cert
2. Right-click → Export "Developer ID Application: ..."
3. File format: **Personal Information Exchange (.p12)**
4. Set a strong password (you'll need this for CI)
5. Save as `ZCC-DeveloperID.p12`

```sh
# base64 the .p12 for the CI secret (copies to clipboard on macOS)
base64 -i ZCC-DeveloperID.p12 | pbcopy
```

## One-time: add GitHub repo secrets

You must configure these secrets in the **salesforce/zana** GitHub repository
(or your own fork if building locally) for CI publishing.

### Finding your secrets

#### APPLE_ID
Your Apple ID email (the one enrolled in the Apple Developer Program).
Example: `dev@example.com`

#### APPLE_APP_SPECIFIC_PASSWORD
Generate an app-specific password (NOT your regular Apple ID password):

1. Go to [appleid.apple.com](https://appleid.apple.com/)
2. Sign in with your Apple ID
3. Security → App-Specific Passwords → Generate Password
4. Label it "Zana Command Center CI" (or similar)
5. Copy the generated password (e.g., `abcd-efgh-ijkl-mnop`)

#### APPLE_TEAM_ID
Your 10-character Apple Developer Team ID:

1. Go to [developer.apple.com/account](https://developer.apple.com/account/)
2. Click "Membership" in the sidebar
3. Copy the **Team ID** (e.g., `A1B2C3D4E5`)

OR find it in Keychain Access: expand your Developer ID Application certificate,
right-click the private key → Get Info → **Organizational Unit** (e.g., `A1B2C3D4E5`)

#### CSC_LINK
The base64-encoded .p12 file from step 3 above (already in your clipboard if you
ran the `base64` command).

#### CSC_KEY_PASSWORD
The password you set when exporting the .p12.

### Adding secrets to GitHub

In the **salesforce/zana** repo (on `github.com`):

1. Settings → Secrets and variables → Actions
2. Click "New repository secret" for each:
   - `CSC_LINK` = base64 string of the .p12
   - `CSC_KEY_PASSWORD` = .p12 export password
   - `APPLE_ID` = your Apple ID email
   - `APPLE_APP_SPECIFIC_PASSWORD` = app-specific password from appleid.apple.com
   - `APPLE_TEAM_ID` = 10-character team ID from developer.apple.com

The release workflow (`.github/workflows/release.yml`) passes all five to
electron-builder, which imports the cert into a temporary keychain, signs, and
submits to Apple's notarization service.

## Local signed + notarized builds

With the Developer ID cert in your login keychain, `npm run dist:mac` signs
automatically (electron-builder auto-discovers the identity). To notarize locally,
export the Apple env vars before building:

```sh
export APPLE_ID="dev@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="A1B2C3D4E5"
npm run dist:mac
```

Notarization takes 1-5 minutes (electron-builder waits for Apple's response).
When complete, the notarization ticket is **stapled** to the .dmg and .zip.

### Verifying the signed + notarized build

```sh
ls dist/                       # expect .dmg, .zip, .blockmap, latest-mac.yml

# Verify code signature
codesign -dv --verbose=4 "dist/mac-arm64/Zana Command Center.app"
# Should show: Authority=Developer ID Application: Your Name (TEAM_ID)
#              Signature=adhoc is WRONG — should show the cert chain

# Verify hardened runtime is enabled
codesign -d --entitlements - "dist/mac-arm64/Zana Command Center.app"
# Should show the entitlements XML (JIT, unsigned memory, etc.)

# Verify Gatekeeper assessment (simulates first launch)
spctl -a -vvv -t install "dist/mac-arm64/Zana Command Center.app"
# Should show: source=Notarized Developer ID
# If it shows "source=no usable signature", notarization failed or wasn't stapled

# Verify notarization ticket is stapled to the .dmg
stapler validate "dist/Zana Command Center-0.8.4-arm64.dmg"
# Should show: The validate action worked!
```

If `spctl` or `stapler` fail, the notarization didn't complete or the ticket
wasn't stapled. Check the electron-builder output for notarization errors.

## Releasing

```sh
git tag v0.5.0 && git push origin v0.5.0
```

CI builds, signs, and attaches `dmg + zip + blockmap + latest-mac.yml` to the
Release. Installed copies pick it up on next launch.

## Verifying the update path end-to-end

Needs **two** signed + notarized releases:

1. Tag `vX`, let CI publish, install the `.dmg`.
2. Launch it once — should open **without any Gatekeeper prompt** (notarization
   clears it automatically).
3. Tag `vX+1`, let CI publish.
4. Relaunch the installed `vX`: it detects the update, toasts
   "Downloading… / ready — installs when you quit", and after quit+relaunch the
   About section shows `vX+1`.

### Troubleshooting first-install Gatekeeper prompts

If the notarized app still prompts on first launch:

1. **Verify notarization:** Run `spctl -a -vvv -t install "path/to/app"`. Should
   show `source=Notarized Developer ID`. If it shows `source=no usable signature`,
   the notarization ticket wasn't stapled — recheck the CI logs for notarization
   errors.

2. **Check the dmg stapling:** Run `stapler validate path/to.dmg`. Should show
   "The validate action worked!". If it fails, electron-builder didn't staple the
   ticket to the dmg (only to the .app inside) — this is a known issue with some
   electron-builder versions. The .app itself is notarized, but users downloading
   the dmg will see a prompt. Workaround: distribute the .zip instead of the .dmg
   for first installs (the .zip is always stapled correctly), or manually staple:
   ```sh
   xcrun stapler staple "path/to.dmg"
   ```

3. **Fallback for stubborn prompts:** If notarization is confirmed but the prompt
   persists (rare, usually a macOS bug), the old workaround still works:
   ```sh
   xattr -dr com.apple.quarantine "/Applications/Zana Command Center.app"
   ```
