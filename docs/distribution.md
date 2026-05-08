# Distribution & Auto-Updates

This document covers how Cost Estimator is built, distributed, and auto-updated for non-technical users at Abonmarche. Code signing is intentionally **not** part of this initial flow — see [`docs/code-signing-setup.md`](./code-signing-setup.md) for the planned signing rollout once the unsigned distribution is proven.

## Architecture

```
+----------------+    pwsh ./scripts/    +-----------------------+
|  Developer     |    release.ps1        |  Azure Blob Storage   |
|  workstation   | --------------------> |  (public container)   |
|  (Windows +    |    (npm run package   |                       |
|   AutoCAD VS   |     + az upload)      |  Cost Estimator-      |
|   Build Tools) |                       |    0.X.Y-setup.exe    |
+----------------+                       |  *.blockmap           |
                                         |  latest.yml           |
                                         +-----------+-----------+
                                                     |
                        +----------------------------+----------------------------+
                        |                                                         |
                        v                                                         v
            +-----------------------+                            +-----------------------+
            |  First-time install:  |                            |  Installed app:       |
            |  user clicks the      |                            |  electron-updater     |
            |  setup.exe download   |                            |  polls latest.yml on  |
            |  link in their email  |                            |  launch and prompts   |
            |  / SharePoint         |                            |  user to restart      |
            +-----------------------+                            +-----------------------+
```

**Three components:**

1. **A Windows developer workstation** with the local toolchain (Node, VS 2022 Build Tools with C++ workload, AutoCAD optional). Runs `scripts/release.ps1` to build + upload.
2. **Azure Blob Storage** hosts the installer + auto-update manifest. It is the only piece end-users hit directly.
3. **electron-updater** (already in `package.json`) runs inside the installed app and polls the Blob Storage container for `latest.yml`.

## Why we build releases from a developer machine instead of CI

Per [ROADMAP.md](../ROADMAP.md) ("CI narrowed to skip native module compile"), `winax` is brittle to compile on GitHub-hosted Windows runners — node-gyp / Visual Studio version drift, missing ATL components, and (as of mid-2026) `windows-latest` being promoted to a VS 2026 image that bundled node-gyp doesn't recognize. Two release attempts via CI (v0.2.0 with VS 2026 → version detection failure, v0.2.1 with `windows-2022` pin → C++ compile errors against newer V8 headers) confirmed the rabbit hole.

The team's documented stance is to keep CI on JS-only checks and revisit a full CI build once `winax` is replaced by the planned .NET sidecar (ROADMAP item #3). Until then, releases are cut from a developer workstation that already has a working local toolchain.

## One-time Azure setup

Already done for this repo:

- Resource group **rg-cost-estimator-app** (eastus2)
- Storage account **stcostestimatordist** with public-blob container **cost-estimator**
- GitHub repo secrets: `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_KEY`, `AZURE_STORAGE_CONTAINER` (used for the future CI release path)

If you ever need to recreate from scratch:

```powershell
$RG          = "rg-cost-estimator-app"
$LOCATION    = "eastus2"
$STORAGE     = "stcostestimatordist"   # must match electron-builder.yml `publish.url`
$CONTAINER   = "cost-estimator"
$SUBSCRIPTION = "<your-axea-labs-subscription-id-or-name>"

az account set --subscription "$SUBSCRIPTION"
az group create --name $RG --location $LOCATION
az storage account create --name $STORAGE --resource-group $RG --location $LOCATION `
  --sku Standard_LRS --kind StorageV2 --allow-blob-public-access true --min-tls-version TLS1_2
az storage container create --account-name $STORAGE --name $CONTAINER --public-access blob
az storage account keys list --resource-group $RG --account-name $STORAGE --query "[0].value" -o tsv
```

> **Note on public access:** the container is publicly readable so non-technical users can download the installer with one click and so `electron-updater` can fetch `latest.yml` without auth. This is appropriate for an internal tool that isn't sensitive. If you later need to gate downloads, options include rotating SAS tokens, Entra ID-gated access via Azure Static Web Apps, or moving the container behind a VPN.

## One-time developer-workstation setup

Required on whatever Windows machine cuts releases:

1. **Node.js 20+, Visual Studio 2022 Build Tools (Desktop development with C++), Python 3.x** — the same prereqs as the README. If `npm run rebuild` works locally, you're set.
2. **Azure CLI** (`winget install Microsoft.AzureCLI` or [download here](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli)). Sign in with `az login` to your Axea Labs subscription.
3. **Windows Developer Mode** — required so `electron-builder` can extract its `winCodeSign` cache, which contains symlinks. **This is a one-time toggle** that costs nothing:

   - Open **Settings → Privacy & security → For developers**
   - Turn **Developer Mode** on
   - Confirm the prompt

   Without Developer Mode, `npm run package` fails with `Cannot create symbolic link : A required privilege is not held by the client` during the winCodeSign cache extraction. Once Developer Mode is on (or the cache has been extracted once from an admin terminal), all future builds work normally.

## Cutting a release

```powershell
# 1. Bump the version in package.json (this is the version that ends up in
#    the installer filename and in latest.yml).

# 2. Commit on a feature branch, open a PR, get the build CI green, merge.
#    The repo enforces PRs on main (no direct pushes).

# 3. After merge, sync local main and tag the release commit:
git checkout main
git pull
git tag v0.X.Y
git push origin v0.X.Y

# 4. Run the release script. Reads AZURE_STORAGE_KEY from env, or you can
#    pass -StorageKey explicitly:
$env:AZURE_STORAGE_KEY = (az storage account keys list `
  --resource-group rg-cost-estimator-app `
  --account-name stcostestimatordist `
  --query "[0].value" -o tsv)
pwsh ./scripts/release.ps1
```

The script:

1. Reads the version from `package.json`.
2. Runs `npm run package`. Takes ~2-5 minutes on a warm cache (downloads Electron the first time, ~115 MB).
3. Uploads `Cost Estimator-X.Y.Z-setup.exe`, `*.blockmap`, and `latest.yml` to Azure Blob Storage.
4. Sets `Cache-Control: no-cache` on `latest.yml` so installed apps see the new version on the next launch.

Anyone with the app already installed will see an "Update ready" prompt the next time they launch it.

To re-release without bumping the version (e.g. an upload was interrupted), just re-run the script with `-SkipBuild` if `dist/` is still populated, or with no flags to rebuild from scratch.

## How users install

The first install is hands-on for the pilot. Send the user the direct download URL:

```
https://stcostestimatordist.blob.core.windows.net/cost-estimator/Cost%20Estimator-0.2.3-setup.exe
```

(Replace the version with whatever's currently shipped — `latest.yml` always describes the current version.)

Steps for the user:

1. Click the link → browser downloads `Cost Estimator-0.2.2-setup.exe`.
2. Double-click to run it.
3. **Windows SmartScreen will show a blue "Windows protected your PC" panel** because the installer is unsigned. Tell users in advance:
   - Click **More info** (small link, easy to miss).
   - The dialog expands to show a **Run anyway** button. Click it.
4. The NSIS installer runs. The app installs per-user under `%LOCALAPPDATA%\Programs\cost-estimator` and creates a Start Menu + desktop shortcut. No admin needed.
5. Launch the app from the Start Menu or desktop.

Once installed, the SmartScreen dance is **not repeated for auto-updates** — those download in the background and apply on next quit.

> **Corporate IT note.** If Abonmarche IT enforces AppLocker, WDAC, or Microsoft Defender Application Control on managed laptops, an unsigned installer may be blocked outright with no "Run anyway" option. Have a brief conversation with IT before broader rollout. The signing rollout in `docs/code-signing-setup.md` resolves this cleanly.

## How auto-updates work

When the app launches in production, [`src/main/auto-updater.ts`](../src/main/auto-updater.ts):

1. Reads the publish URL baked into the installer (`https://stcostestimatordist.blob.core.windows.net/cost-estimator/`).
2. Fetches `latest.yml` from Azure Blob Storage.
3. Compares the version in `latest.yml` to the installed version.
4. If newer, downloads the installer in the background, verifies its SHA512 against the manifest.
5. Pops up "Cost Estimator X.Y.Z is ready to install — Restart now / Later".
6. On Restart now, runs `quitAndInstall()` which silently runs the new installer and relaunches.

If the user picks "Later", the new installer is applied automatically when they next quit the app (`autoInstallOnAppQuit: true`).

## Testing the update flow locally

You can verify the wiring without exposing anything to real users:

1. Bump `package.json` to a fake high version (e.g. `0.99.0`).
2. Run `pwsh ./scripts/release.ps1` to upload that "future" build.
3. Bump `package.json` back, do another release at the real version.
4. Install the lower-version build locally. On launch, the auto-updater will see `0.99.0` in `latest.yml` and prompt to restart.
5. After verifying, manually delete the fake `0.99.0-setup.exe` blob from the container and re-upload the real `latest.yml`.

## Costs

Azure Blob Storage Standard_LRS in `eastus2`:

- Storage: ~$0.018/GB/month. A `0.X.Y-setup.exe` is ~150-200 MB; you'll have a few versions in the bucket → maybe 1-2 GB total. **<$0.05/month.**
- Egress: $0.0–0.087/GB depending on tier. ~50 users × 200 MB initial download + occasional updates ≈ <$1/month.

Effectively rounding-error money for an internal tool.

## Troubleshooting

**`npm run package` fails with "Cannot create symbolic link : A required privilege is not held by the client"**
You haven't enabled Windows Developer Mode (one-time). Settings → Privacy & security → For developers → Developer Mode → On. Re-run `npm run package`. The 7z error is from the winCodeSign cache extraction.

**`npm run package` fails with `gyp ERR! find VS could not find a version of Visual Studio 2017 or newer to use`**
You're missing Visual Studio 2022 Build Tools, or only the C# workload is installed. Open the Visual Studio Installer, modify your VS 2022 install, add **Desktop development with C++**, and retry. Then `npm run rebuild` to recompile `winax` against the newly available toolchain.

**`scripts/release.ps1` fails on the upload step with `AuthenticationFailed`**
Either `AZURE_STORAGE_KEY` is unset or has rotated. Refresh it:
```powershell
$env:AZURE_STORAGE_KEY = (az storage account keys list `
  --resource-group rg-cost-estimator-app --account-name stcostestimatordist `
  --query "[0].value" -o tsv)
```

**"Users see the SmartScreen warning every time they launch the app"**
SmartScreen only fires on *install* of an unsigned binary, not on launch of an already-installed app. If users see warnings during normal use, something else (corporate AV, WDAC) is involved — see the corporate IT note above.

**"Auto-updates don't work"**
1. Verify `latest.yml` is in the container and publicly readable: open `https://stcostestimatordist.blob.core.windows.net/cost-estimator/latest.yml` in a browser. You should see YAML, not an XML error.
2. Verify the version in `latest.yml` is greater than the installed app's `package.json` version.
3. If `latest.yml` shows the new version but installed apps aren't seeing it, browser/CDN caching is the usual cause. The release script sets `Cache-Control: no-cache, max-age=0` on `latest.yml` to prevent this; if you uploaded manually, pass `--content-cache-control "no-cache, max-age=0"` to `az storage blob upload`.
