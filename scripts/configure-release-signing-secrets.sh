#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Configure the GitHub Actions secrets required for signed Zana releases.

Usage:
  scripts/configure-release-signing-secrets.sh [--repo OWNER/REPO] CERTIFICATE.p12

The .p12 must contain a "Developer ID Application" certificate and its private
key. Export it from Keychain Access first. Secret values are prompted without
echo and sent directly to GitHub; this script does not write them to disk.

Environment variables may supply prompted values:
  CSC_KEY_PASSWORD
  APPLE_ID
  APPLE_APP_SPECIFIC_PASSWORD
  APPLE_TEAM_ID
EOF
}

repo="salesforce/zana"
p12_path=""

while (($# > 0)); do
  case "$1" in
    --repo)
      [[ $# -ge 2 ]] || {
        echo "ERROR: --repo requires OWNER/REPO." >&2
        exit 2
      }
      repo="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*)
      echo "ERROR: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      [[ -z "$p12_path" ]] || {
        echo "ERROR: provide exactly one .p12 file." >&2
        exit 2
      }
      p12_path="$1"
      shift
      ;;
  esac
done

[[ -n "$p12_path" ]] || {
  usage >&2
  exit 2
}
[[ -f "$p12_path" ]] || {
  echo "ERROR: certificate file not found: $p12_path" >&2
  exit 1
}
[[ "$p12_path" == *.p12 || "$p12_path" == *.pfx ]] || {
  echo "ERROR: expected a .p12 or .pfx certificate bundle." >&2
  exit 1
}

for command_name in gh openssl base64 tr; do
  command -v "$command_name" >/dev/null || {
    echo "ERROR: required command is missing: $command_name" >&2
    exit 1
  }
done

gh auth status --hostname github.com >/dev/null
gh repo view "$repo" >/dev/null

prompt_secret() {
  local variable_name="$1"
  local prompt="$2"
  local value="${!variable_name:-}"

  if [[ -z "$value" ]]; then
    read -r -s -p "$prompt: " value
    echo >&2
  fi
  [[ -n "$value" ]] || {
    echo "ERROR: $variable_name cannot be empty." >&2
    exit 1
  }
  printf -v "$variable_name" '%s' "$value"
}

prompt_secret CSC_KEY_PASSWORD "Password used when exporting the .p12"

if ! printf '%s\n' "$CSC_KEY_PASSWORD" |
  openssl pkcs12 -in "$p12_path" -noout -passin stdin >/dev/null 2>&1; then
  echo "ERROR: the .p12 could not be opened with that password." >&2
  exit 1
fi

certificate_subject="$(
  printf '%s\n' "$CSC_KEY_PASSWORD" |
    openssl pkcs12 -in "$p12_path" -clcerts -nokeys -passin stdin 2>/dev/null |
    openssl x509 -noout -subject 2>/dev/null
)"
if [[ "$certificate_subject" != *"Developer ID Application"* ]]; then
  echo "ERROR: the .p12 does not contain a Developer ID Application certificate." >&2
  echo "Found: ${certificate_subject:-no certificate subject}" >&2
  exit 1
fi

prompt_secret APPLE_ID "Apple ID email used for notarization"
prompt_secret APPLE_APP_SPECIFIC_PASSWORD "Apple app-specific password"
prompt_secret APPLE_TEAM_ID "Apple Developer Team ID"

[[ "$APPLE_TEAM_ID" =~ ^[A-Z0-9]{10}$ ]] || {
  echo "ERROR: APPLE_TEAM_ID must be a 10-character Apple Team ID." >&2
  exit 1
}

echo
echo "Certificate: $certificate_subject"
echo "Repository:  $repo"
echo "Secrets:     CSC_LINK, CSC_KEY_PASSWORD, APPLE_ID,"
echo "             APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID"
echo
read -r -p "Set these GitHub Actions secrets? [y/N] " confirmation
[[ "$confirmation" =~ ^[Yy]$ ]] || {
  echo "Cancelled."
  exit 0
}

set_secret() {
  local secret_name="$1"
  local secret_value="$2"
  printf '%s' "$secret_value" |
    gh secret set "$secret_name" --repo "$repo" --app actions
}

# electron-builder accepts a newline-free Base64 PKCS#12 value as CSC_LINK.
base64 <"$p12_path" | tr -d '\r\n' |
  gh secret set CSC_LINK --repo "$repo" --app actions
set_secret CSC_KEY_PASSWORD "$CSC_KEY_PASSWORD"
set_secret APPLE_ID "$APPLE_ID"
set_secret APPLE_APP_SPECIFIC_PASSWORD "$APPLE_APP_SPECIFIC_PASSWORD"
set_secret APPLE_TEAM_ID "$APPLE_TEAM_ID"

unset CSC_KEY_PASSWORD APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID

echo
echo "Release signing secrets configured for $repo."
echo "Keep the .p12 in secure storage or remove the local export."
