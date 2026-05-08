# Release Checklist

Step-by-step runbook for shipping a new version of Cost Estimator to installed users.

> **TL;DR — The deploy command is `npm run release` from a Windows machine with the local toolchain. Pushing to `main` does not update the installer on Azure. You must run the release script.**

For the architecture / deeper background, see [`distribution.md`](./distribution.md).

---

## When you're cutting a release

### 1. Land all the code first

- Open PRs as usual; let the `build` CI check pass.
- Merge them to `main`.
- **Nothing about merging deploys anything.** The Azure-hosted installer + auto-update manifest are unchanged regardless of how many PRs are merged.

### 2. Decide the version

Open [`package.json`](../package.json) and pick the new version per [semver](https://semver.org/):

- **Patch** (`0.2.2` → `0.2.3`): bug fixes only, no new features
- **Minor** (`0.2.2` → `0.3.0`): new features, backward-compatible
- **Major** (`0.2.2` → `1.0.0`): breaking changes (rare for this app)

The version in `package.json` is the contract. It will appear in the installer filename, in `latest.yml`, and in the SmartScreen prompt that pilot users see.

### 3. Bump the version in a small PR

```powershell
git checkout -b release/v0.X.Y
# edit package.json: bump "version"
git add package.json
git commit -m "release: bump version to v0.X.Y"
git push -u origin release/v0.X.Y
gh pr create --title "release: bump version to v0.X.Y" --body "Routine version bump for release."
```

Wait for CI to pass, merge.

### 4. Tag the release commit on `main`

```powershell
git checkout main
git pull
git tag v0.X.Y
git push origin v0.X.Y
```

The tag is for git history only — pushing it does **not** trigger anything. ([`release.yml`](../.github/workflows/release.yml) is a `workflow_dispatch` noop today.)

### 5. Run the release script

From the same Windows checkout, with `az login` completed:

```powershell
npm run release
```

This:

1. Reads the version from `package.json`
2. Runs `npm run package` (~2-5 minutes)
3. Resolves the Azure Storage key via `az storage account keys list` if `AZURE_STORAGE_KEY` isn't already set in your environment
4. Uploads `Cost Estimator-X.Y.Z-setup.exe`, the blockmap, and `latest.yml` to Azure Blob Storage
5. Sets `Cache-Control: no-cache` on `latest.yml` so installed apps see the new version on next launch

If the upload fails partway through, fix the issue and re-run with `npm run release:upload-only` to skip the rebuild and just retry the upload.

### 6. Verify

```powershell
# Should report version: 0.X.Y
curl https://stcostestimatordist.blob.core.windows.net/cost-estimator/latest.yml

# Should return HTTP 200 with content-type application/x-msdownload
curl -I https://stcostestimatordist.blob.core.windows.net/cost-estimator/Cost%20Estimator-0.X.Y-setup.exe
```

### 7. Notify users

For first-time installers, send the URL:

```
https://stcostestimatordist.blob.core.windows.net/cost-estimator/Cost%20Estimator-0.X.Y-setup.exe
```

Anyone with the app already installed receives the update on next launch automatically — no action from them.

---

## One-time setup (the first person who ever runs a release)

Required on whichever Windows machine cuts releases:

1. Node.js 20+, Visual Studio 2022 Build Tools (Desktop development with C++), Python 3.x — same as the dev README. If `npm run rebuild` works locally, you're set.
2. **Azure CLI** — `winget install Microsoft.AzureCLI`. Then `az login` to your Axea Labs subscription.
3. **PowerShell 7+** — `winget install Microsoft.PowerShell` (the script uses `pwsh`, not Windows PowerShell 5).
4. **Windows Developer Mode** — Settings → Privacy & security → For developers → on. Required so `electron-builder` can extract its `winCodeSign` cache (contains symlinks). One-time toggle.

---

## Common scenarios

### "I want to roll back to a previous version"

There's no automatic rollback. To roll back, bump `package.json` to a higher version (e.g. if `0.2.5` was bad, ship `0.2.6` that contains the v0.2.4 code) and run `npm run release` again. electron-updater compares versions; you cannot push a "lower" version to clients via the auto-update channel.

If you need to disable auto-updates entirely while debugging, you can manually delete `latest.yml` from the Blob container — installed apps will then stay on whatever version they're on. Put it back when you have a fix.

### "I want to test a release without affecting real users"

1. Bump `package.json` to a fake high version (`0.99.0`)
2. `npm run release`
3. Test on a machine with the previous version installed
4. After verifying, manually delete the `Cost Estimator-0.99.0-setup.exe` blob and re-upload the real `latest.yml` for the actual current version

### "I forgot to bump the version and ran the release script"

The script will produce `Cost Estimator-<old version>-setup.exe.blockmap` and update `latest.yml` to point at the same version. Installed apps will not update because the version is unchanged. To fix, bump `package.json`, commit + tag the new version, run `npm run release` again.

### "The release script failed mid-upload"

Re-run `npm run release:upload-only`. It skips the build and re-uploads everything in `dist/` to Azure. Idempotent.

### "I want to use a different release machine for the first time"

Walk through the [one-time setup](#one-time-setup-the-first-person-who-ever-runs-a-release) section above on the new machine, then run `npm run release` as usual.

---

## What does NOT happen automatically

To prevent surprise: this is the explicit list of things that you might *expect* to deploy but do not.

| Action | Updates Azure? |
|---|---|
| Open a PR | No |
| Merge to `main` | No |
| Push a commit to `main` | No |
| Create a `vX.Y.Z` git tag | No |
| Push a `vX.Y.Z` tag to GitHub | No |
| Manually run the `Release` workflow in GitHub Actions | No (it's a noop placeholder) |
| Run `npm run package` | No (builds the installer to `dist/` but doesn't upload) |
| **Run `npm run release`** | **Yes — this is the only thing that updates the installer on Azure** |

The deliberate-deploy model exists because the `winax` native compile is brittle on GitHub-hosted runners, so we build releases from a developer machine that has a working local toolchain. See [ROADMAP.md item #3](../ROADMAP.md) for when this changes (after `winax` is replaced by a .NET sidecar, CI can resume building releases automatically).
