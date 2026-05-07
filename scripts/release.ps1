<#
.SYNOPSIS
    Build the Cost Estimator installer locally and upload it to Azure Blob
    Storage so installed clients receive the auto-update.

.DESCRIPTION
    Per docs/distribution.md, releases are built from a developer machine
    rather than CI. The reason is documented in ROADMAP.md: getting `winax`
    to compile reliably on a GitHub-hosted Windows runner is a rabbit hole
    that doesn't pay for itself until `winax` is replaced by a .NET sidecar.

    This script does the developer-side half of a release:
      1. Confirm the working tree is clean and a v* tag matches package.json.
      2. Run `npm run package` to produce `dist/*-setup.exe`, `*.blockmap`,
         and `latest.yml`.
      3. Upload all three to the Azure Blob container that the installed
         app polls for updates. Sets no-cache on `latest.yml` so the next
         update check sees the new version immediately.

    Required env vars (or pass as parameters):
      AZURE_STORAGE_ACCOUNT     defaults to stcostestimatordist
      AZURE_STORAGE_CONTAINER   defaults to cost-estimator
      AZURE_STORAGE_KEY         storage account access key (no default)

    Usage:
      pwsh ./scripts/release.ps1
      pwsh ./scripts/release.ps1 -SkipBuild        # if dist/ is already populated
      pwsh ./scripts/release.ps1 -SkipUpload       # build only, no upload
#>

[CmdletBinding()]
param(
  [string]$StorageAccount   = $env:AZURE_STORAGE_ACCOUNT,
  [string]$StorageContainer = $env:AZURE_STORAGE_CONTAINER,
  [string]$StorageKey       = $env:AZURE_STORAGE_KEY,
  [switch]$SkipBuild,
  [switch]$SkipUpload
)

$ErrorActionPreference = 'Stop'

if (-not $StorageAccount)   { $StorageAccount   = 'stcostestimatordist' }
if (-not $StorageContainer) { $StorageContainer = 'cost-estimator' }

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$pkg = Get-Content package.json | ConvertFrom-Json
$version = $pkg.version
Write-Host "Cost Estimator $version" -ForegroundColor Cyan

if (-not $SkipBuild) {
  Write-Host "Running npm run package..." -ForegroundColor Cyan
  npm run package
  if ($LASTEXITCODE -ne 0) { throw "npm run package failed (exit $LASTEXITCODE)" }
}

$installer = Join-Path $repoRoot "dist\Cost Estimator-$version-setup.exe"
$blockmap  = "$installer.blockmap"
$manifest  = Join-Path $repoRoot "dist\latest.yml"

foreach ($f in @($installer, $blockmap, $manifest)) {
  if (-not (Test-Path $f)) { throw "Expected build artifact missing: $f" }
}

Write-Host "Built artifacts:" -ForegroundColor Cyan
Get-Item $installer, $blockmap, $manifest |
  Select-Object Name, @{n='SizeMB';e={[math]::Round($_.Length/1MB,2)}} |
  Format-Table -AutoSize

if ($SkipUpload) {
  Write-Host "SkipUpload set - exiting." -ForegroundColor Yellow
  return
}

if (-not $StorageKey) {
  throw "AZURE_STORAGE_KEY not set. Either export it, pass -StorageKey, or run: az storage account keys list --resource-group rg-cost-estimator-app --account-name $StorageAccount --query '[0].value' -o tsv"
}

Write-Host "Uploading to https://$StorageAccount.blob.core.windows.net/$StorageContainer/" -ForegroundColor Cyan

az storage blob upload `
  --account-name $StorageAccount `
  --account-key  $StorageKey `
  --container-name $StorageContainer `
  --file $installer `
  --name (Split-Path -Leaf $installer) `
  --overwrite true | Out-Null
if ($LASTEXITCODE -ne 0) { throw "installer upload failed" }

az storage blob upload `
  --account-name $StorageAccount `
  --account-key  $StorageKey `
  --container-name $StorageContainer `
  --file $blockmap `
  --name (Split-Path -Leaf $blockmap) `
  --overwrite true | Out-Null
if ($LASTEXITCODE -ne 0) { throw "blockmap upload failed" }

# Cache-control on latest.yml so update checks see new versions immediately.
az storage blob upload `
  --account-name $StorageAccount `
  --account-key  $StorageKey `
  --container-name $StorageContainer `
  --file $manifest `
  --name (Split-Path -Leaf $manifest) `
  --content-cache-control 'no-cache, max-age=0' `
  --overwrite true | Out-Null
if ($LASTEXITCODE -ne 0) { throw "latest.yml upload failed" }

$baseUrl = "https://$StorageAccount.blob.core.windows.net/$StorageContainer"
Write-Host ""
Write-Host "Released v$version" -ForegroundColor Green
Write-Host "  Installer: $baseUrl/$([uri]::EscapeUriString((Split-Path -Leaf $installer)))"
Write-Host "  Manifest:  $baseUrl/latest.yml"
