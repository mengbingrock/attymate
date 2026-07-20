# AttyMate Desktop

Electron shell around paperclip.attymate.com. Installers are built on CI
(`.github/workflows/desktop-release.yml`) for macOS (Apple Silicon) and Windows
(x64) and attached to the matching GitHub release.

## Installing

### macOS (Apple Silicon)

The app is **ad-hoc code-signed but not notarized** (there is no paid Apple
Developer account), so macOS Gatekeeper shows a warning on first launch:

> *"Apple could not verify 'AttyMate' is free of malware…"*

This is expected. To open it the first time:

1. Double-click **AttyMate**, then dismiss the dialog (**Done** / **Cancel**).
2. Open **System Settings → Privacy & Security**.
3. Scroll to *"AttyMate was blocked to protect your Mac"* → **Open Anyway** →
   confirm with Touch ID / password.

Or clear the quarantine flag in one step:

```sh
xattr -dr com.apple.quarantine "/Applications/AttyMate.app"
```

> Ad-hoc signing is required for arm64 apps to launch at all (an unsigned arm64
> app is killed as "damaged"). Removing the *"could not verify"* dialog entirely
> would require signing with an Apple **Developer ID** certificate and
> notarizing the app with Apple — see "Enabling notarization" below.

### Windows (x64)

Run `AttyMate Setup <version>.exe`. The installer is unsigned, so SmartScreen
may warn about an unknown publisher → **More info → Run anyway**.

## Building locally

```sh
# from the repo root — the runner bundle is an extraResource
pnpm --filter @paperclipai/runner-client build:bundle

# macOS arm64 (ad-hoc signed .dmg + .zip)
pnpm --filter attymate-electron dist:mac-arm64

# Windows x64 (NSIS installer) — requires wine/mono when built off Windows
pnpm --filter attymate-electron dist:win
```

## Releasing

1. Bump `version` in `electron/package.json`.
2. Create the GitHub release/tag `v<version>` (e.g. `v0.3.1`).
3. Push the change on a `release/electron-**` branch (or run the
   **Desktop Release (Electron)** workflow manually). CI builds on native
   macOS arm64 + Windows x64 runners and uploads the installers to the release.

## Enabling notarization (future)

To remove the *"Apple could not verify…"* dialog, an Apple Developer Program
membership is required. Once available:

1. Create a **Developer ID Application** certificate; export it as a `.p12`.
2. Add GitHub secrets: `CSC_LINK` (base64 `.p12`), `CSC_KEY_PASSWORD`, and
   notarization credentials (`APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` +
   `APPLE_TEAM_ID`, or an App Store Connect API key).
3. In the `mac` build config, enable `hardenedRuntime` + entitlements and set
   `notarize: true`, and drop the ad-hoc signing step from
   `scripts/build-mac-arm64.sh` (electron-builder signs + notarizes + staples).
