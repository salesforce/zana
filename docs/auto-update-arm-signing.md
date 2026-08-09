# Arming auto-update: one-time signing setup

**Status:** TODO — auto-update is wired but NOT live (no signing cert).
**Context:** see `docs/auto-update-setup.md` for the full design. This file is the
short, run-it-now checklist to make auto-update actually work.

## Why it's not working today

- Repo `salesforce/zana` has **no `CSC_LINK` / `CSC_KEY_PASSWORD` secrets**
  (verified `gh secret list` → empty).
- So the release workflow takes its `CSC_IDENTITY_AUTO_DISCOVERY=false` path and
  publishes **unsigned** builds (v0.6.0 is unsigned).
- Squirrel.Mac **refuses to auto-update an unsigned app** — installed copies will
  never self-update until a signed baseline + a signed successor both exist.

## Step 1 — create the cert (you, in Keychain Access — can't be scripted)

`Keychain Access → Certificate Assistant → Create a Certificate`:

- **Name:** `ZCC Self-Signed`
- **Identity Type:** Self-Signed Root
- **Certificate Type:** Code Signing
- Create → it lands in the **login** keychain.

Then export it as a `.p12`: right-click the cert → **Export** → set a password
(remember it). Save as e.g. `~/ZCC-SelfSigned.p12`.

## Step 2 — set the two repo secrets

> `gh`'s active account is the Salesforce host, so **every command is pinned with
> `GH_HOST=github.com`** (account `grebmann1`). Without it the secret would land
> on the wrong host or fail.

```sh
# CSC_LINK = base64 of the .p12 (read straight from the file, no clipboard step)
GH_HOST=github.com gh secret set CSC_LINK \
  --repo salesforce/zana \
  --body "$(base64 -i /Users/grebmann/Documents/ZCC-SelfSigned.p12)"

# CSC_KEY_PASSWORD = the .p12 export password (prompts; paste, then Ctrl-D)
GH_HOST=github.com gh secret set CSC_KEY_PASSWORD \
  --repo salesforce/zana

# verify both now exist
GH_HOST=github.com gh secret list --repo salesforce/zana
```

Expected last output:

```
CSC_KEY_PASSWORD  Updated 2026-06-16T...
CSC_LINK          Updated 2026-06-16T...
```

## Step 3 — publish a signed baseline

package.json is at **0.8.0** but only v0.6.0 (unsigned) was ever published. Tag a
signed baseline:

```sh
git tag v0.8.0
git push origin v0.8.0          # → triggers .github/workflows/release.yml
```

Watch it:

```sh
GH_HOST=github.com gh run watch --repo salesforce/zana
```

When done, confirm the build actually signed (workflow log should say
`Signing enabled (CSC_LINK present).`, not the UNSIGNED branch).

## Step 4 — exercise the update path

The baseline can't be auto-updated *into* from the unsigned v0.6.0 — you have to
install v0.8.0 fresh once (Privacy & Security → Open Anyway). The update path is
only provable from the **second** signed release:

```sh
# bump package.json to 0.8.1, commit, then:
git tag v0.8.1
git push origin v0.8.1
```

Relaunch the installed v0.8.0 → it should toast "Downloading… / ready — installs
when you quit", and after quit+relaunch About shows v0.8.1.

## Notes

- Self-signed can't be notarized, so each **fresh `.dmg` install** still needs the
  one-time Gatekeeper bypass. Silent auto-updates work after that.
- CI builds **arm64 only**. Intel/Windows/Linux targets exist in
  `electron-builder.yml` but are not in the release matrix — add a matrix entry to
  ship them.
