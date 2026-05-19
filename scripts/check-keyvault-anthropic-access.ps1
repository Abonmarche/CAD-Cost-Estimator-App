<#
.SYNOPSIS
  Fetches the Anthropic API key our LLM proxy uses (from Key Vault) and
  probes it directly against api.anthropic.com to see which models it
  has access to.

.DESCRIPTION
  Diagnostic for the "claude-sonnet-X-Y may not exist or you may not have
  access to it" errors the desktop app keeps hitting in the Estimator
  Assistant. Bypasses the proxy AND the Electron app AND the Agent SDK
  entirely — just key + Anthropic.

  What it does:
    1. Reads kv-cost-estimator-llm / anthropic-api-key via `az keyvault
       secret show` (uses your existing `az login`).
    2. Calls GET https://api.anthropic.com/v1/models — lists every model
       this key can see.
    3. POSTs a minimal /v1/messages call for each candidate model ID so
       we know which ones actually work (not just listed).
    4. Prints a verdict block.

  The key value is never written to disk or echoed to the console.
  Get-AzKeyVaultSecret would also work but requires the Az PowerShell
  module; we use `az` since you already use it for releases.

.NOTES
  Prereqs:
    - `az login` (your normal account works — you have Get permissions on
      the kv-cost-estimator-llm vault per the provisioning output).
    - Access to https://api.anthropic.com from this machine (no
      corporate proxy blocking it).

.EXAMPLE
  pwsh ./scripts/check-keyvault-anthropic-access.ps1

  # Test additional model IDs beyond the defaults:
  pwsh ./scripts/check-keyvault-anthropic-access.ps1 -ExtraModels claude-opus-4-1, claude-sonnet-4-0
#>

[CmdletBinding()]
param(
  [string] $VaultName  = 'kv-cost-estimator-llm',
  [string] $SecretName = 'anthropic-api-key',
  [string[]] $Models = @(
    'claude-sonnet-4-6',
    'claude-sonnet-4-5',
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-haiku-4-5-20251001'
  ),
  [string[]] $ExtraModels = @()
)

$ErrorActionPreference = 'Stop'
$ApiBase   = 'https://api.anthropic.com'
$ApiVer    = '2023-06-01'

# Combine + de-dupe
$AllModels = ($Models + $ExtraModels) | Where-Object { $_ } | Select-Object -Unique

function Write-Section($title) {
  Write-Host ''
  Write-Host "=== $title ===" -ForegroundColor Cyan
}

# ---- 1. az auth check ----------------------------------------------------

Write-Section 'Azure auth'
$account = az account show --only-show-errors 2>$null | ConvertFrom-Json -ErrorAction SilentlyContinue
if (-not $account) {
  Write-Host "Not logged in. Run 'az login' first." -ForegroundColor Red
  exit 2
}
Write-Host "  Subscription: $($account.name)" -ForegroundColor DarkGray
Write-Host "  User:         $($account.user.name)" -ForegroundColor DarkGray

# ---- 2. Pull the secret from Key Vault -----------------------------------

Write-Section "Reading $SecretName from $VaultName"
$secretJson = az keyvault secret show --vault-name $VaultName --name $SecretName --only-show-errors 2>&1
if ($LASTEXITCODE -ne 0 -or -not $secretJson) {
  Write-Host "  Failed to read secret. Output:" -ForegroundColor Red
  Write-Host $secretJson
  Write-Host ""
  Write-Host "  Likely causes:" -ForegroundColor Yellow
  Write-Host "    - Your account doesn't have 'Get' permission on $VaultName."
  Write-Host "      Grant via: az keyvault set-policy --name $VaultName \``"
  Write-Host "        --upn $($account.user.name) --secret-permissions get list"
  Write-Host "    - Vault uses RBAC instead of access policies. Assign 'Key"
  Write-Host "      Vault Secrets User' role on the vault scope."
  exit 3
}

$secretObj = $secretJson | ConvertFrom-Json
$apiKey = $secretObj.value
$keyVersion = ($secretObj.id -split '/')[ -1 ]
$updated = $secretObj.attributes.updated

if (-not $apiKey) {
  Write-Host "  Secret has no value." -ForegroundColor Red
  exit 4
}
$keyTail = $apiKey.Substring($apiKey.Length - 4)
$keyHead = $apiKey.Substring(0, [Math]::Min(10, $apiKey.Length))
Write-Host "  Got secret: $keyHead..$keyTail" -ForegroundColor Green
Write-Host "  Version:    $keyVersion" -ForegroundColor DarkGray
Write-Host "  Updated:    $updated" -ForegroundColor DarkGray
if (-not $apiKey.StartsWith('sk-ant-')) {
  Write-Host "  WARNING: value doesn't look like an Anthropic API key (sk-ant-...)." -ForegroundColor Yellow
  Write-Host "           That's the kind of mismatch that would explain the symptom." -ForegroundColor Yellow
}

# ---- 3. List models the key can see --------------------------------------

$headers = @{
  'x-api-key'         = $apiKey
  'anthropic-version' = $ApiVer
  'content-type'      = 'application/json'
}

Write-Section '/v1/models — what does this key see?'
$visibleIds = @()
try {
  $modelsResp = Invoke-RestMethod -Method Get -Uri "$ApiBase/v1/models" -Headers $headers -TimeoutSec 30
  $visibleIds = $modelsResp.data | ForEach-Object { $_.id }
  Write-Host "  Key has $($visibleIds.Count) models visible:" -ForegroundColor Green
  foreach ($mid in $visibleIds) {
    $marker = ''
    if ($AllModels -contains $mid) { $marker = '  <- candidate' }
    Write-Host "    $mid$marker"
  }
} catch {
  $resp = $_.Exception.Response
  $statusCode = if ($resp) { [int]$resp.StatusCode } else { '?' }
  $body = ''
  if ($resp) {
    try {
      $stream = $resp.GetResponseStream()
      $reader = New-Object System.IO.StreamReader($stream)
      $body = $reader.ReadToEnd()
    } catch {}
  }
  Write-Host "  /v1/models failed: HTTP $statusCode" -ForegroundColor Red
  if ($body) { Write-Host "  body: $body" -ForegroundColor Red }
  # Continue anyway — the messages probe might still reveal something.
}

# ---- 4. Probe each candidate model with a tiny /v1/messages call --------

function Test-Model([string] $model) {
  $body = @{
    model      = $model
    max_tokens = 4
    messages   = @(@{ role = 'user'; content = 'ping' })
  } | ConvertTo-Json -Depth 5 -Compress

  try {
    $resp = Invoke-RestMethod -Method Post -Uri "$ApiBase/v1/messages" `
      -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 30
    $reply = ($resp.content | Where-Object { $_.type -eq 'text' } | Select-Object -First 1).text
    $usage = "in=$($resp.usage.input_tokens) out=$($resp.usage.output_tokens)"
    return @{ ok = $true; reply = $reply; usage = $usage; status = 200; error = $null }
  } catch {
    $r = $_.Exception.Response
    $status = if ($r) { [int]$r.StatusCode } else { -1 }
    $errBody = ''
    if ($r) {
      try {
        $stream = $r.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $errBody = $reader.ReadToEnd()
      } catch {}
    }
    $errType = '?'; $errMsg = '?'
    if ($errBody) {
      try {
        $parsed = $errBody | ConvertFrom-Json
        if ($parsed.error) {
          $errType = $parsed.error.type
          $errMsg = $parsed.error.message
        }
      } catch { $errMsg = $errBody }
    } else {
      $errMsg = $_.Exception.Message
    }
    return @{
      ok = $false; reply = $null; usage = $null
      status = $status; errorType = $errType; error = $errMsg
    }
  }
}

Write-Section '/v1/messages probe — does each candidate actually work?'
$results = @{}
foreach ($model in $AllModels) {
  Write-Host ''
  Write-Host "  model=$model" -ForegroundColor White
  $r = Test-Model $model
  $results[$model] = $r
  if ($r.ok) {
    $reply = if ($r.reply) { $r.reply.Trim().Substring(0, [Math]::Min(40, $r.reply.Trim().Length)) } else { '' }
    Write-Host "    PASS  HTTP 200  reply='$reply'  $($r.usage)" -ForegroundColor Green
  } else {
    Write-Host "    FAIL  HTTP $($r.status)  type=$($r.errorType)" -ForegroundColor Red
    if ($r.error) { Write-Host "          $($r.error)" -ForegroundColor Red }
  }
}

# ---- 5. Verdict ----------------------------------------------------------

Write-Section 'Summary'
$colWidth = ($AllModels | Measure-Object -Property Length -Maximum).Maximum + 4
foreach ($model in $AllModels) {
  $r = $results[$model]
  $listed = if ($visibleIds -contains $model) { '(in /v1/models)' } else { '(NOT in /v1/models)' }
  $verdict = if ($r.ok) { 'PASS' } else { 'FAIL' }
  $color = if ($r.ok) { 'Green' } else { 'Red' }
  $line = ('  {0,-6} {1,-' + $colWidth + '} {2}') -f $verdict, $model, $listed
  Write-Host $line -ForegroundColor $color
}

Write-Host ''
$has46 = $results['claude-sonnet-4-6'] -and $results['claude-sonnet-4-6'].ok
$has45 = $results['claude-sonnet-4-5'] -and $results['claude-sonnet-4-5'].ok
$anyOk = ($results.Values | Where-Object { $_.ok }).Count -gt 0

if ($has46) {
  Write-Host 'Verdict: the Key Vault key DOES have access to claude-sonnet-4-6.' -ForegroundColor Green
  Write-Host '         The Electron app failure must be on our side (proxy,' -ForegroundColor Green
  Write-Host '         Agent SDK plumbing, or how the model name reaches the API).' -ForegroundColor Green
} elseif ($has45) {
  Write-Host 'Verdict: this key works against claude-sonnet-4-5 but NOT 4-6.' -ForegroundColor Yellow
  Write-Host '         Your account does not have 4-6 rolled out yet. Either:' -ForegroundColor Yellow
  Write-Host '         (a) Check console.anthropic.com for model access requests' -ForegroundColor Yellow
  Write-Host '         (b) Stay on claude-sonnet-4-5 in the app' -ForegroundColor Yellow
} elseif ($anyOk) {
  Write-Host 'Verdict: key works for SOME models but neither Sonnet 4-5 nor 4-6.' -ForegroundColor Yellow
  Write-Host '         Switch the app to whichever of the above PASS-ed.' -ForegroundColor Yellow
} else {
  Write-Host 'Verdict: this key cannot reach ANY model. Key may be invalid,' -ForegroundColor Red
  Write-Host '         revoked, out of credit, or org-restricted. Check' -ForegroundColor Red
  Write-Host '         console.anthropic.com.' -ForegroundColor Red
}

# Belt-and-suspenders: clear the key from the local variable.
$apiKey = $null
[System.GC]::Collect()
