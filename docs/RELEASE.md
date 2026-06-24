# Release & Code Signing

This document describes the GitHub Actions secrets required for CI to produce signed, notarized builds.

## macOS

All five secrets must be set for signed + notarized `.dmg` builds. If any are missing, the build runs unsigned.

| Secret | Description |
|---|---|
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` developer certificate (export from Keychain Access). |
| `APPLE_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12`. |
| `APPLE_ID` | Apple Developer account email (e.g. `dev@example.com`). |
| `APPLE_PASSWORD` | App-specific password for `notarytool` (create at appleid.apple.com). |
| `APPLE_TEAM_ID` | Apple Team ID (found in Developer Portal → Membership). |

### Exporting the certificate

```bash
# In Keychain Access: My Certificates → right-click → Export
# Save as .p12, then base64-encode:
base64 -i certificate.p12 -o certificate.b64
# Paste the contents of certificate.b64 into the APPLE_CERTIFICATE secret.
```

## Windows

| Secret | Description |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | EV code signing key (PEM or PVK format, depending on provider). |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the signing key. |

## Creating a release

```bash
git tag v0.1.0
git push origin v0.1.0
```

CI will build signed artifacts for macOS (universal `.dmg`) and Windows (`.msi` / `.exe`),
then create a **draft** GitHub Release. Review the draft and publish it.
