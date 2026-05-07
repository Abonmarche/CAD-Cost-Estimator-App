# Distribution & Auto-Updates

This document covers how Cost Estimator is built, distributed, and auto-updated for non-technical users at Abonmarche. Code signing is intentionally **not** part of this initial flow — see [`docs/code-signing-setup.md`](./code-signing-setup.md) for the planned signing rollout once the unsigned distribution is proven.

## Architecture

```
+---------------+     git tag v0.X.Y       +-----------------------+
|  Developer    | -----------------------> |  GitHub Actions       |
|  (this repo)  |                          |  (.github/workflows/  |
|               |                          |   release.yml)        |
+---------------+                          +-----------+-----------+
                                                       |
                                                       | builds .exe + latest.yml
                                                       | uploads via az CLI
                                                       v
                                           +-----------------------+
                                           |  Azure Blob Storage   |
                                           |  (public container)   |
                                           |                       |
                                           |  Cost Estimator-      |
                                           |    0.X.Y-setup.exe    |
                                           |  *.blockmap           |
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

1. **GitHub** hosts source and triggers releases on tag push.
2. **Azure Blob Storage** hosts the installer + auto-update manifest. It is the only piece end-users hit directly.
3. **electron-updater** (already in `package.json`) runs inside the installed app and polls the Blob Storage container for `latest.yml`.

## One-time Azure setup

Run these from a machine with the [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) installed and `az login` already done. Use your Axea Labs subscription.

```powershell
# Pick names. The storage account name must be globally unique, 3-24 chars,
# lowercase + digits only.
$RG          = "rg-cost-estimator-app"
$LOCATION    = "eastus2"
$STORAGE     = "stcostestimatordist"   # must match electron-builder.yml `publish.url`
$CONTAINER   = "cost-estimator"
$SUBSCRIPTION = "<your-axea-labs-subscription-id-or-name>"

az account set --subscription "$SUBSCRIPTION"

# 1. Resource group
az group create --name $RG --location $LOCATION

# 2. Storage account (Standard_LRS is the cheapest tier; fine for installers)
az storage account create `
  --name $STORAGE `
  --resource-group $RG `
  --location $LOCATION `
  --sku Standard_LRS `
  --kind StorageV2 `
  --allow-blob-public-access true

# 3. Public blob container — anyone with the URL can download the installer.
#    `blob` access means individual blobs are readable but the container
#    itself can't be listed.
az storage container create `
  --account-name $STORAGE `
  --name $CONTAINER `
  --public-access blob

# 4. Grab the access key for GitHub Actions to authenticate with.
az storage account keys list `
  --resource-group $RG `
  --account-name $STORAGE `
  --query "[0].value" -o tsv
```

The final command prints a long base64 string — that's the storage account access key. Treat it like a password; anyone with it can write to the container.

> **Note on public access:** the container is publicly readable so non-technical users can download the installer with one click and so `electron-updater` can fetch `latest.yml` without auth. This is appropriate for an internal tool that isn't sensitive. If you later need to gate downloads, options include rotating SAS tokens (more complex client setup), Entra ID-gated access via Azure Static Web Apps, or moving the container behind a VPN.

## One-time GitHub setup

In the repo's GitHub settings → **Secrets and variables → Actions**, add three repository secrets:

| Secret name | Value |
|---|---|
| `AZURE_STORAGE_ACCOUNT` | `stcostestimatordist` (or whatever you used for `$STORAGE`) |
| `AZURE_STORAGE_KEY` | The access key from the last `az` command above |
| `AZURE_STORAGE_CONTAINER` | `cost-estimator` (or whatever you used for `$CONTAINER`) |

The release workflow at `.github/workflows/release.yml` reads these to authenticate with Azure during upload. The values are encrypted at rest in GitHub and only decrypted during workflow runs.

## One-time repo wiring (already done)

These are the changes already committed to the repo to support this flow — listed here so you understand the moving parts:

- **`electron-builder.yml`** — `publish.provider: generic` with `url` pointing at the Blob Storage container. `electron-updater` reads the URL out of the packaged `app-update.yml` baked into the installer at build time.
- **`src/main/auto-updater.ts`** — wires `electron-updater` into the app, prompts the user with "Update ready — restart now?" once a new build has been downloaded.
- **`src/main/index.ts`** — calls `initAutoUpdater(...)` once the window is created.
- **`.github/workflows/release.yml`** — fires on `v*.*.*` tag push, runs the full build (including native winax compile), then uploads the resulting `dist/*setup.exe`, `dist/*.blockmap`, and `dist/latest.yml` to Azure Blob Storage.
- **`dev-app-update.yml`** — lets you test the auto-update flow from `npm run dev` without packaging.

## Cutting a release

```powershell
# 1. Bump the version in package.json (this is the version that ends up in
#    the installer filename and in latest.yml).
#    e.g. "version": "0.2.0"

# 2. Commit the bump and any release content.
git commit -am "Release v0.2.0"
git push

# 3. Tag and push the tag — this triggers .github/workflows/release.yml.
git tag v0.2.0
git push --tags
```

Within ~10-15 minutes (mostly `npm ci` + winax native rebuild), the workflow uploads the new installer + manifest to Blob Storage. Anyone with the app already installed will see an "Update ready" prompt the next time they launch.

To re-run a release without bumping the version (e.g. CI failed mid-upload), delete the tag locally and remotely (`git tag -d v0.2.0; git push origin :refs/tags/v0.2.0`) and re-tag.

You can also kick off a manual build via the **Run workflow** button on the Actions tab — useful for testing CI changes without cutting a real release. The `dry_run` input skips the Azure upload step.

## How users install

The first install is hands-on for the pilot. Send the user the direct download URL (with the version of the most recent release):

```
https://stcostestimatordist.blob.core.windows.net/cost-estimator/Cost%20Estimator-0.2.0-setup.exe
```

Steps for the user:

1. Click the link → browser downloads `Cost Estimator-0.1.0-setup.exe`.
2. Double-click to run it.
3. **Windows SmartScreen will show a blue "Windows protected your PC" panel** because the installer is unsigned. Tell users in advance:
   - Click **More info** (small link, easy to miss).
   - The dialog expands to show a **Run anyway** button. Click it.
4. The NSIS installer runs. The app installs per-user under `%LOCALAPPDATA%\Programs\cost-estimator` and creates a Start Menu + desktop shortcut. No admin needed.
5. Launch the app from the Start Menu or desktop.

Once installed, the SmartScreen dance is **not repeated for auto-updates** — those download in the background and apply on next quit.

> **Corporate IT note.** If Abonmarche IT enforces AppLocker, WDAC, or Microsoft Defender Application Control on managed laptops, an unsigned installer may be blocked outright with no "Run anyway" option. Have a brief conversation with IT before broader rollout. The signing rollout in `docs/code-signing-setup.md` resolves this cleanly.

## How auto-updates work

When the app launches in production, `src/main/auto-updater.ts`:

1. Reads the publish URL baked into the installer.
2. Fetches `latest.yml` from Azure Blob Storage.
3. Compares the version in `latest.yml` to the installed version.
4. If newer, downloads the installer in the background, verifies its SHA512 against the manifest.
5. Pops up "Cost Estimator X.Y.Z is ready to install — Restart now / Later".
6. On Restart now, runs `quitAndInstall()` which silently runs the new installer and relaunches.

If the user picks "Later", the new installer is applied automatically when they next quit the app (`autoInstallOnAppQuit: true`).

## Testing the update flow locally

You can verify the wiring without cutting a real release:

1. Bump `package.json` to a fake high version (e.g. `0.99.0`) and run `npm run package` to produce a "future" installer in `dist/`.
2. Manually upload that one to Azure Blob Storage:
   ```powershell
   az storage blob upload-batch `
     --account-name stcostestimatordist `
     --account-key "<key>" `
     --destination cost-estimator `
     --source dist `
     --pattern "*setup.exe"
   az storage blob upload-batch `
     --account-name stcostestimatordist `
     --account-key "<key>" `
     --destination cost-estimator `
     --source dist `
     --pattern "latest.yml"
   ```
3. Bump `package.json` back to `0.1.0`, `npm run package`, install that build locally.
4. Launch the installed app. Within ~30 seconds you should see the "Update ready" dialog offering 0.99.0.
5. After you've verified, delete the fake 0.99.0 blobs from the container.

## Costs

Azure Blob Storage Standard_LRS in `eastus2`:

- Storage: ~$0.018/GB/month. A `0.1.0-setup.exe` is ~150-200 MB; you'll have a few versions in the bucket → maybe 1-2 GB total. **<$0.05/month.**
- Egress: $0.0–0.087/GB depending on tier. ~50 users × 200 MB initial download + occasional updates ≈ <$1/month.

Effectively rounding-error money for an internal tool.

## Troubleshooting

**"electron-builder fails on `npm ci` in CI"**
The native winax build needs Visual Studio Build Tools and Python 3.x — both are pre-installed on `windows-latest` runners. The workflow pins Python 3.11 and forces the MSVC toolset (`npm_config_clang=0`) to dodge the Node 24+ ClangCL default. If the rebuild ever fails, the most common cause is a winax version drift — re-run `npm install` locally to pick up matching prebuilds, then commit the lockfile.

**"Users see the SmartScreen warning every time they launch the app"**
SmartScreen only fires on *install* of an unsigned binary, not on launch of an already-installed app. If users see warnings during normal use, something else (corporate AV, WDAC) is involved — see the corporate IT note above.

**"Auto-updates don't work"**
1. Verify `latest.yml` is in the container and publicly readable: open `https://<storage>.blob.core.windows.net/<container>/latest.yml` in a browser. You should see YAML, not an XML error.
2. Verify the version in `latest.yml` is greater than the installed app's `package.json` version.
3. Look at the app's main-process logs (`%APPDATA%\cost-estimator\logs\` if you've added logging, or run a dev build to console).
4. If the installer is signed but `latest.yml` was uploaded before signing was wired up, the signature mismatch will block the update. Re-publish a signed release to recover.

**"I uploaded a new version and the app doesn't see it"**
Browser/CDN caching of `latest.yml` is the usual cause. The release workflow sets `Cache-Control: no-cache, max-age=0` on `latest.yml` to prevent this. If you uploaded manually with `az storage blob upload`, pass `--content-cache-control "no-cache, max-age=0"`.
