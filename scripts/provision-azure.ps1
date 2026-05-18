<#
.SYNOPSIS
    Provision the Azure infrastructure for the Cost Estimator's MSAL +
    Function-App-proxy stack.

.DESCRIPTION
    Adapted from abonmarche-app-stack/feedback-function-app/scripts/
    provision-azure.sh for two differences:

    1. TWO Function Apps (LLM proxy + feedback) in one resource group,
       provisioned by ./infra/main.bicep.
    2. THREE Entra app registrations — a public-client desktop app
       (this Electron app's identity) plus two API server apps (one per
       Function App), with the desktop app pre-authorized on both APIs.

    What this script does:
      1. Pre-flight: subscription, naming conflict checks, RG.
      2. Creates three app registrations + Graph PATCHes:
           - cost-estimator-desktop      public client, redirect msal-cost-estimator://auth
           - cost-estimator-llm-api      exposes access_as_user
           - cost-estimator-feedback-api exposes access_as_user
         Both API apps pre-authorize the desktop app (so users see no
         second consent prompt on first LLM call / first feedback submit).
      3. Bicep deploys all ARM resources (./infra/main.bicep).
      4. Imports the Anthropic API key from .env into kv-cost-estimator-llm
         as secret `anthropic-api-key`.
      5. Creates TWO CI deploy app registrations + federated credentials:
           - cost-estimator-llm-deploy
           - cost-estimator-feedback-deploy
      6. Adds deploy SP role assignments to each Function App + storage.
      7. Writes the JSON contract to ./.azure/provision-output.json for the
         orchestrator and the Electron baked-env wiring.

    Idempotent where Azure permits — re-run on partial failure.

    PREREQUISITES:
      - az CLI logged in to the Abonmarche tenant
      - az subscription set to the target subscription (defaults to current)
      - PowerShell 7+ recommended (works in Windows PowerShell 5.1 too)

    USAGE (from repo root):
      pwsh ./scripts/provision-azure.ps1

      Or with overrides:
      pwsh ./scripts/provision-azure.ps1 -ProjectKey cost-estimator -Location eastus2

.PARAMETER ProjectKey
    Short slug used in resource names. Lowercase, hyphenated.
    Default: cost-estimator (matches existing rg-cost-estimator-app).

.PARAMETER ResourceGroup
    Azure resource group. Default: rg-cost-estimator-app (already exists).

.PARAMETER Location
    Azure region. Default: eastus2.

.PARAMETER Org
    GitHub org. Default: Abonmarche.

.PARAMETER Repo
    GitHub repo. Default: CAD-Cost-Estimator-App.

.PARAMETER EnvFile
    Path to .env containing ANTHROPIC_API_KEY. Default: ./.env.

.PARAMETER SkipKeyImport
    If set, skips the Anthropic key import step (useful for re-runs after
    the key has already been imported).
#>

[CmdletBinding()]
param(
  [string]$ProjectKey    = 'cost-estimator',
  [string]$ResourceGroup = 'rg-cost-estimator-app',
  [string]$Location      = 'eastus2',
  [string]$Org           = 'Abonmarche',
  [string]$Repo          = 'CAD-Cost-Estimator-App',
  [string]$EnvFile       = './.env',
  [switch]$SkipKeyImport
)

$ErrorActionPreference = 'Stop'

# ─── helpers ────────────────────────────────────────────────────────────────

function Step($msg)  { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)    { Write-Host "  ok   $msg" -ForegroundColor Green }
function Note($msg)  { Write-Host "  note $msg" -ForegroundColor Yellow }
function Fail($msg)  { Write-Host "`nERROR $msg" -ForegroundColor Red; exit 1 }

function Invoke-AzJson {
  # Run an az command and parse the JSON output. PowerShell quoting around
  # az args is treacherous; this helper accepts an argument array.
  #
  # NOTE: do NOT merge stderr (no 2>&1). az emits warnings to stderr (e.g.
  # extension-update notices) and PowerShell's merge wraps those in
  # ErrorRecord objects that corrupt the JSON when joined with stdout. We
  # also pass --only-show-errors to suppress chatty info-level output that
  # some az subcommands emit to stdout.
  param([string[]]$AzArgs)
  $allArgs = @($AzArgs) + @('--only-show-errors')
  $raw = & az @allArgs
  if ($LASTEXITCODE -ne 0) {
    Fail "az $($AzArgs -join ' ') failed (exit $LASTEXITCODE)"
  }
  $joined = ($raw -join "`n").Trim()
  if ([string]::IsNullOrWhiteSpace($joined)) { return $null }
  return ($joined | ConvertFrom-Json)
}

function Invoke-AzTsv {
  param([string[]]$AzArgs)
  $allArgs = @($AzArgs) + @('--only-show-errors')
  $raw = & az @allArgs
  if ($LASTEXITCODE -ne 0) {
    Fail "az $($AzArgs -join ' ') failed (exit $LASTEXITCODE)"
  }
  return (($raw -join "`n").Trim())
}

# ─── pre-flight ──────────────────────────────────────────────────────────────

Step "Pre-flight"

$acct = Invoke-AzJson @('account', 'show', '-o', 'json')
$tenantId = $acct.tenantId
$subscriptionId = $acct.id
$signedInUser = $acct.user.name
Ok "az logged in as $signedInUser, tenant $tenantId, subscription $subscriptionId"

$currentUserId = Invoke-AzTsv @('ad', 'signed-in-user', 'show', '--query', 'id', '-o', 'tsv')
Ok "operator object id $currentUserId"

# Derived naming. Flat (no hyphens) used for storage account names.
$projectKeyFlat = $ProjectKey -replace '-', ''

# LLM proxy stack names
$llmStorage      = "st${projectKeyFlat}llm"
$llmFunction     = "func-${ProjectKey}-llm"
$llmPlan         = "plan-${ProjectKey}-llm"
$llmKv           = "kv-${ProjectKey}-llm"
$llmWorkspace    = "log-${ProjectKey}-llm"
$llmAppInsights  = "appi-${ProjectKey}-llm"

# Feedback stack names
$fbStorage      = "st${projectKeyFlat}fb"
$fbFunction     = "func-${ProjectKey}-feedback"
$fbPlan         = "plan-${ProjectKey}-feedback"
$fbKv           = "kv-${ProjectKey}-fb"
$fbWorkspace    = "log-${ProjectKey}-feedback"
$fbAppInsights  = "appi-${ProjectKey}-feedback"

# App registration display names
$desktopAppName   = "Cost Estimator Desktop"
$llmApiAppName    = "Cost Estimator LLM API"
$fbApiAppName     = "Cost Estimator Feedback API"
$llmDeployAppName = "cost-estimator-llm-deploy"
$fbDeployAppName  = "cost-estimator-feedback-deploy"

# Length validation
foreach ($name in @($llmStorage, $fbStorage)) {
  if ($name.Length -gt 24) { Fail "Storage account name '$name' is >24 chars" }
}
foreach ($name in @($llmKv, $fbKv)) {
  if ($name.Length -gt 24) { Fail "Key Vault name '$name' is >24 chars" }
}
Ok "naming validated"

# ─── resource group ──────────────────────────────────────────────────────────

Step "Resource group: $ResourceGroup"
$rgExists = & az group show -n $ResourceGroup -o none 2>$null
if ($LASTEXITCODE -eq 0) {
  Ok "exists"
} else {
  & az group create -n $ResourceGroup -l $Location -o none
  if ($LASTEXITCODE -ne 0) { Fail "Could not create resource group" }
  Ok "created"
}

# ─── helper: get-or-create app registration ──────────────────────────────────

function Get-OrCreateApp {
  param(
    [string]$DisplayName,
    [switch]$IsPublicClient
  )
  $existingId = (& az ad app list --display-name $DisplayName --query "[0].appId" -o tsv 2>$null)
  if (-not [string]::IsNullOrWhiteSpace($existingId) -and $existingId -ne 'null') {
    Ok "$DisplayName exists (appId $existingId)"
    return $existingId
  }
  $appId = Invoke-AzTsv @('ad', 'app', 'create',
    '--display-name', $DisplayName,
    '--sign-in-audience', 'AzureADMyOrg',
    '--query', 'appId', '-o', 'tsv')
  & az ad sp create --id $appId -o none 2>$null  # SP creation is idempotent-failing
  Ok "$DisplayName created (appId $appId)"
  return $appId
}

# ─── 3 app registrations ────────────────────────────────────────────────────

Step "Desktop public client app registration: $desktopAppName"
$desktopAppId = Get-OrCreateApp -DisplayName $desktopAppName
$desktopAppObjectId = Invoke-AzTsv @('ad', 'app', 'show', '--id', $desktopAppId, '--query', 'id', '-o', 'tsv')

# Public client config: custom protocol redirect + isFallbackPublicClient=true.
# Done via Graph PATCH because `az ad app update` doesn't support
# publicClient.redirectUris cleanly.
$desktopPatchJson = @'
{
  "isFallbackPublicClient": true,
  "publicClient": {
    "redirectUris": ["msal-cost-estimator://auth"]
  }
}
'@
$desktopPatchFile = [System.IO.Path]::GetTempFileName() + '.json'
$desktopPatchJson | Set-Content -Path $desktopPatchFile -Encoding utf8
& az rest --method PATCH `
  --uri "https://graph.microsoft.com/v1.0/applications/$desktopAppObjectId" `
  --headers "Content-Type=application/json" `
  --body "@$desktopPatchFile" -o none
if ($LASTEXITCODE -ne 0) { Fail "Could not patch desktop app for public client config" }
Remove-Item $desktopPatchFile
Ok "desktop app configured as public client with redirect msal-cost-estimator://auth"

Step "LLM API app registration: $llmApiAppName"
$llmApiAppId = Get-OrCreateApp -DisplayName $llmApiAppName
$llmApiObjectId = Invoke-AzTsv @('ad', 'app', 'show', '--id', $llmApiAppId, '--query', 'id', '-o', 'tsv')
& az ad app update --id $llmApiAppId --identifier-uris "api://$llmApiAppId" -o none

Step "Feedback API app registration: $fbApiAppName"
$fbApiAppId = Get-OrCreateApp -DisplayName $fbApiAppName
$fbApiObjectId = Invoke-AzTsv @('ad', 'app', 'show', '--id', $fbApiAppId, '--query', 'id', '-o', 'tsv')
& az ad app update --id $fbApiAppId --identifier-uris "api://$fbApiAppId" -o none

# Deterministic scope IDs so re-runs are idempotent. SHA-1 of "<appId>-access_as_user"
# folded into UUID form.
function New-DeterministicScopeId {
  param([string]$AppId)
  $sha = [System.Security.Cryptography.SHA1]::Create()
  $bytes = [System.Text.Encoding]::UTF8.GetBytes("$AppId-access_as_user")
  $hash = $sha.ComputeHash($bytes)
  $hex = -join ($hash | ForEach-Object { $_.ToString('x2') })
  return "$($hex.Substring(0,8))-$($hex.Substring(8,4))-$($hex.Substring(12,4))-$($hex.Substring(16,4))-$($hex.Substring(20,12))"
}

# Patch helper: expose access_as_user, then pre-authorize the desktop app.
# Two patches required (Graph rejects preAuthorizedApplications referencing
# a scope ID not yet committed).
function Set-ApiAppScopes {
  param(
    [string]$ApiAppObjectId,
    [string]$ApiAppId,
    [string]$PreAuthClientId  # the desktop app's appId
  )
  $scopeId = New-DeterministicScopeId -AppId $ApiAppId

  $scopePatch = @"
{
  "api": {
    "oauth2PermissionScopes": [
      {
        "id": "$scopeId",
        "value": "access_as_user",
        "type": "User",
        "isEnabled": true,
        "adminConsentDisplayName": "Access this API on behalf of the user",
        "adminConsentDescription": "Allow the Cost Estimator desktop app to call this API on behalf of the signed-in user.",
        "userConsentDisplayName": "Access this API on your behalf",
        "userConsentDescription": "Allow the Cost Estimator to call this API on your behalf."
      }
    ]
  }
}
"@
  $scopeFile = [System.IO.Path]::GetTempFileName() + '.json'
  $scopePatch | Set-Content -Path $scopeFile -Encoding utf8
  & az rest --method PATCH `
    --uri "https://graph.microsoft.com/v1.0/applications/$ApiAppObjectId" `
    --headers "Content-Type=application/json" `
    --body "@$scopeFile" -o none
  if ($LASTEXITCODE -ne 0) { Fail "Could not patch scope on $ApiAppId" }
  Remove-Item $scopeFile

  $preauthPatch = @"
{
  "api": {
    "preAuthorizedApplications": [
      {
        "appId": "$PreAuthClientId",
        "delegatedPermissionIds": ["$scopeId"]
      }
    ]
  }
}
"@
  $preauthFile = [System.IO.Path]::GetTempFileName() + '.json'
  $preauthPatch | Set-Content -Path $preauthFile -Encoding utf8
  & az rest --method PATCH `
    --uri "https://graph.microsoft.com/v1.0/applications/$ApiAppObjectId" `
    --headers "Content-Type=application/json" `
    --body "@$preauthFile" -o none
  if ($LASTEXITCODE -ne 0) { Fail "Could not patch pre-auth on $ApiAppId" }
  Remove-Item $preauthFile
}

Set-ApiAppScopes -ApiAppObjectId $llmApiObjectId -ApiAppId $llmApiAppId -PreAuthClientId $desktopAppId
Ok "LLM API: access_as_user exposed, desktop pre-authorized"
Set-ApiAppScopes -ApiAppObjectId $fbApiObjectId -ApiAppId $fbApiAppId -PreAuthClientId $desktopAppId
Ok "Feedback API: access_as_user exposed, desktop pre-authorized"

# ─── Bicep deployment ────────────────────────────────────────────────────────

Step "Bicep deployment of infra/main.bicep"

$deployName = "cost-estimator-$(Get-Date -Format 'yyyyMMddHHmmss')"

& az deployment group create `
  -g $ResourceGroup `
  -n $deployName `
  --template-file './infra/main.bicep' `
  --parameters `
    location=$Location `
    tenantId=$tenantId `
    currentUserObjectId=$currentUserId `
    llmStorageAccountName=$llmStorage `
    llmFunctionAppName=$llmFunction `
    llmPlanName=$llmPlan `
    llmKeyVaultName=$llmKv `
    llmWorkspaceName=$llmWorkspace `
    llmAppInsightsName=$llmAppInsights `
    llmApiAppId=$llmApiAppId `
    feedbackStorageAccountName=$fbStorage `
    feedbackFunctionAppName=$fbFunction `
    feedbackPlanName=$fbPlan `
    feedbackKeyVaultName=$fbKv `
    feedbackWorkspaceName=$fbWorkspace `
    feedbackAppInsightsName=$fbAppInsights `
    feedbackApiAppId=$fbApiAppId `
  -o none

if ($LASTEXITCODE -ne 0) { Fail "Bicep deployment '$deployName' failed" }
Ok "Bicep deployment '$deployName' succeeded"

# Capture outputs
function Get-DeploymentOutput {
  param([string]$Name)
  return Invoke-AzTsv @('deployment', 'group', 'show',
    '-g', $ResourceGroup,
    '-n', $deployName,
    '--query', "properties.outputs.$Name.value", '-o', 'tsv')
}

$llmFunctionUrl    = Get-DeploymentOutput -Name 'llmFunctionAppUrl'
$llmKvName         = Get-DeploymentOutput -Name 'llmKeyVaultName'
$llmKvUri          = Get-DeploymentOutput -Name 'llmKeyVaultUri'
$llmFunctionMiId   = Get-DeploymentOutput -Name 'llmFunctionMiPrincipalId'
$fbFunctionUrl     = Get-DeploymentOutput -Name 'feedbackFunctionAppUrl'
$fbKvName          = Get-DeploymentOutput -Name 'feedbackKeyVaultName'
$fbKvUri           = Get-DeploymentOutput -Name 'feedbackKeyVaultUri'
$fbFunctionMiId    = Get-DeploymentOutput -Name 'feedbackFunctionMiPrincipalId'
Ok "deployment outputs captured"

# ─── import Anthropic key ────────────────────────────────────────────────────

if (-not $SkipKeyImport) {
  Step "Import ANTHROPIC_API_KEY into $llmKvName as 'anthropic-api-key'"
  if (-not (Test-Path $EnvFile)) {
    Fail ".env not found at $EnvFile. Set -EnvFile or pass -SkipKeyImport."
  }
  $envContent = Get-Content $EnvFile
  $keyLine = $envContent | Where-Object { $_ -match '^\s*ANTHROPIC_API_KEY\s*=' } | Select-Object -First 1
  if (-not $keyLine) { Fail "ANTHROPIC_API_KEY not found in $EnvFile" }
  $anthropicKey = ($keyLine -replace '^\s*ANTHROPIC_API_KEY\s*=\s*', '').Trim().Trim('"').Trim("'")
  if ([string]::IsNullOrWhiteSpace($anthropicKey)) { Fail "ANTHROPIC_API_KEY is empty in $EnvFile" }

  # Wait briefly for KV RBAC propagation
  Start-Sleep -Seconds 5

  & az keyvault secret set `
    --vault-name $llmKvName `
    --name 'anthropic-api-key' `
    --value $anthropicKey `
    -o none
  if ($LASTEXITCODE -ne 0) { Fail "Could not import Anthropic key into $llmKvName" }
  Ok "secret 'anthropic-api-key' set in $llmKvName"
} else {
  Note "skipped Anthropic key import (-SkipKeyImport)"
}

# ─── CI deploy app registrations (one per Function App) ──────────────────────

function New-DeployApp {
  param(
    [string]$DisplayName,
    [string]$RepoOrg,
    [string]$RepoName
  )
  $appId = Get-OrCreateApp -DisplayName $DisplayName
  $appObjectId = Invoke-AzTsv @('ad', 'app', 'show', '--id', $appId, '--query', 'id', '-o', 'tsv')

  function New-Fic {
    param([string]$AppObjectId, [string]$FicName, [string]$Subject)
    $body = @"
{
  "name": "$FicName",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "$Subject",
  "audiences": ["api://AzureADTokenExchange"]
}
"@
    $file = [System.IO.Path]::GetTempFileName() + '.json'
    $body | Set-Content -Path $file -Encoding utf8
    & az rest --method POST `
      --uri "https://graph.microsoft.com/v1.0/applications/$AppObjectId/federatedIdentityCredentials" `
      --headers "Content-Type=application/json" `
      --body "@$file" -o none 2>$null
    if ($LASTEXITCODE -ne 0) { Note "fic '$FicName' may already exist (ignored)" }
    Remove-Item $file
  }

  New-Fic -AppObjectId $appObjectId -FicName 'github-main' -Subject "repo:${RepoOrg}/${RepoName}:ref:refs/heads/main"
  New-Fic -AppObjectId $appObjectId -FicName 'github-pr' -Subject "repo:${RepoOrg}/${RepoName}:pull_request"
  New-Fic -AppObjectId $appObjectId -FicName 'github-env-production' -Subject "repo:${RepoOrg}/${RepoName}:environment:production"
  return $appId
}

Step "LLM deploy app registration: $llmDeployAppName"
$llmDeployAppId = New-DeployApp -DisplayName $llmDeployAppName -RepoOrg $Org -RepoName $Repo
$llmDeploySpObjectId = Invoke-AzTsv @('ad', 'sp', 'show', '--id', $llmDeployAppId, '--query', 'id', '-o', 'tsv')
Ok "LLM deploy app + federated creds in place"

Step "Feedback deploy app registration: $fbDeployAppName"
$fbDeployAppId = New-DeployApp -DisplayName $fbDeployAppName -RepoOrg $Org -RepoName $Repo
$fbDeploySpObjectId = Invoke-AzTsv @('ad', 'sp', 'show', '--id', $fbDeployAppId, '--query', 'id', '-o', 'tsv')
Ok "Feedback deploy app + federated creds in place"

# ─── deploy SP role assignments ─────────────────────────────────────────────

function Assign-Role {
  param(
    [string]$Role,
    [string]$Scope,
    [string]$AssigneeObjectId
  )
  # Check if already assigned
  $existing = (& az role assignment list `
    --assignee-object-id $AssigneeObjectId `
    --scope $Scope `
    --query "[?roleDefinitionName=='$Role'] | length(@)" -o tsv 2>$null)
  if ($existing -and $existing -match '^[1-9]') {
    Ok "$Role on $(Split-Path $Scope -Leaf) (already assigned)"
    return
  }

  # Retry loop for Entra propagation
  for ($i = 1; $i -le 6; $i++) {
    $errFile = [System.IO.Path]::GetTempFileName()
    & az role assignment create `
      --role $Role `
      --assignee-object-id $AssigneeObjectId `
      --assignee-principal-type ServicePrincipal `
      --scope $Scope -o none 2>$errFile
    if ($LASTEXITCODE -eq 0) {
      Ok "$Role -> $(Split-Path $Scope -Leaf)"
      Remove-Item $errFile -ErrorAction SilentlyContinue
      return
    }
    $errText = Get-Content $errFile -Raw -ErrorAction SilentlyContinue
    Remove-Item $errFile -ErrorAction SilentlyContinue
    if ($errText -match 'PrincipalNotFound|does not exist in the directory') {
      Note "principal not yet visible to RBAC (Entra propagation), attempt $i/6 - retrying in 10s..."
      Start-Sleep -Seconds 10
      continue
    }
    Fail "az role assignment create for '$Role' failed: $errText"
  }
  Fail "Role '$Role' could not be assigned after 6 attempts"
}

Step "Deploy SP role assignments"

$llmFuncResId = Invoke-AzTsv @('functionapp', 'show', '-n', $llmFunction, '-g', $ResourceGroup, '--query', 'id', '-o', 'tsv')
$llmStorageResId = Invoke-AzTsv @('storage', 'account', 'show', '-n', $llmStorage, '-g', $ResourceGroup, '--query', 'id', '-o', 'tsv')
Assign-Role -Role 'Contributor' -Scope $llmFuncResId -AssigneeObjectId $llmDeploySpObjectId
Assign-Role -Role 'Storage Blob Data Contributor' -Scope $llmStorageResId -AssigneeObjectId $llmDeploySpObjectId

$fbFuncResId = Invoke-AzTsv @('functionapp', 'show', '-n', $fbFunction, '-g', $ResourceGroup, '--query', 'id', '-o', 'tsv')
$fbStorageResId = Invoke-AzTsv @('storage', 'account', 'show', '-n', $fbStorage, '-g', $ResourceGroup, '--query', 'id', '-o', 'tsv')
Assign-Role -Role 'Contributor' -Scope $fbFuncResId -AssigneeObjectId $fbDeploySpObjectId
Assign-Role -Role 'Storage Blob Data Contributor' -Scope $fbStorageResId -AssigneeObjectId $fbDeploySpObjectId

# ─── write the JSON contract ────────────────────────────────────────────────

$outDir = './.azure'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

$contract = [ordered]@{
  resourceGroup         = $ResourceGroup
  location              = $Location
  tenantId              = $tenantId
  subscriptionId        = $subscriptionId

  desktopAppId          = $desktopAppId
  llmApiAppId           = $llmApiAppId
  feedbackApiAppId      = $fbApiAppId

  llmFunctionApp        = $llmFunction
  llmFunctionUrl        = $llmFunctionUrl
  llmKeyVault           = $llmKvName
  llmKeyVaultUri        = $llmKvUri
  llmFunctionMiId       = $llmFunctionMiId
  llmDeployAppId        = $llmDeployAppId

  feedbackFunctionApp   = $fbFunction
  feedbackFunctionUrl   = $fbFunctionUrl
  feedbackKeyVault      = $fbKvName
  feedbackKeyVaultUri   = $fbKvUri
  feedbackFunctionMiId  = $fbFunctionMiId
  feedbackDeployAppId   = $fbDeployAppId
}

$contractPath = Join-Path $outDir 'provision-output.json'
$contract | ConvertTo-Json -Depth 5 | Set-Content -Path $contractPath -Encoding utf8

Step "DONE"
Write-Host "  contract -> $contractPath" -ForegroundColor Green
Write-Host ""
$contract | ConvertTo-Json -Depth 5
