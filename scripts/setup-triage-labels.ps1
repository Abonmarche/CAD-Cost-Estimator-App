# Idempotent label creation for the Claude auto-triage system.
# Re-running updates color/description on existing labels via --force.
#
# Required env var:
#   TARGET_REPO   <ORG>/<REPO>, e.g. Abonmarche/ACI-CRM
#
# CUSTOMIZE: edit the area block below to match your project's top-level
# src/ directories or feature groupings.

$ErrorActionPreference = 'Stop'

if (-not $env:TARGET_REPO) {
    Write-Error 'TARGET_REPO env var is required (format: <ORG>/<REPO>)'
    exit 1
}
$Repo = $env:TARGET_REPO

$Labels = @(
    # --- triage outcome --------------------------------------------------
    @{ name = 'triage:actionable';   color = '0e8a16'; desc = 'Clear, in-scope, ready to work' },
    @{ name = 'triage:needs-info';   color = 'fbca04'; desc = 'Submitter must provide repro/screenshot/browser before this can move' },
    @{ name = 'triage:duplicate';    color = 'cccccc'; desc = 'Matches an existing issue (linked in comment)' },
    @{ name = 'triage:out-of-scope'; color = 'b60205'; desc = 'Violates a project non-goal - closed with citation' },
    @{ name = 'triage:not-a-bug';    color = 'd4c5f9'; desc = 'Submitter misunderstood - existing path explained in comment' },

    # --- risk zone (first four are auto-fix-eligible) -------------------
    @{ name = 'risk:safe-zone';         color = 'c2e0c6'; desc = 'Change confined to pure helpers / Tailwind / copy - auto-fix allowed' },
    @{ name = 'risk:port';              color = 'c2e0c6'; desc = 'Mirrors an existing pattern in this repo (do X like Y) - auto-fix allowed' },
    @{ name = 'risk:bug-fix';           color = 'c2e0c6'; desc = 'Clearly broken behavior with a defensible fix - auto-fix allowed' },
    @{ name = 'risk:additive-feature';  color = 'c2e0c6'; desc = 'New feature with small UI footprint (<=2 visible elements) - auto-fix allowed' },
    @{ name = 'risk:human-only';        color = 'b60205'; desc = 'Touches auth / Graph client / schema / deploy - never auto-fix' },
    @{ name = 'risk:design-call';       color = 'fbca04'; desc = 'Subjective: color/copy/UX, taste, oscillating reorganization - needs human judgment' },

    # --- meta + autofix override ----------------------------------------
    @{ name = 'meta:reorganized-before'; color = 'e99695'; desc = 'Triage found prior issues touching this UI element - review history before merging' },
    @{ name = 'autofix:requested';       color = 'ff8c00'; desc = 'Human-approved auto-fix override; bypasses risk/effort gate (hard stops still apply)' },

    # --- trigger label (the feedback Function attaches this; triage filters on it) ---
    @{ name = 'user-reported';          color = 'fef2c0'; desc = 'Filed via the in-app feedback button (triggers Claude triage)' },
    @{ name = 'bug';                    color = 'd73a4a'; desc = 'In-app bug report (also a default GitHub label; idempotent re-creation)' },
    @{ name = 'enhancement';            color = 'a2eeef'; desc = 'In-app enhancement request (also a default GitHub label; idempotent re-creation)' },

    # --- effort (structural footprint, not time) ------------------------
    @{ name = 'effort:atom';        color = 'bfd4f2'; desc = 'Single file, no behavior change (Tailwind class, copy, typo)' },
    @{ name = 'effort:pure';        color = 'bfd4f2'; desc = 'Pure-function add/fix + one Tier 1 unit test' },
    @{ name = 'effort:component';   color = '5319e7'; desc = 'Component change requiring Tier 2 test' },
    @{ name = 'effort:integration'; color = '5319e7'; desc = 'Touches Graph client / hook / multi-module - Tier 3 contract test' },
    @{ name = 'effort:schema';      color = '5319e7'; desc = 'Backend schema change - schema-drift guard update required' },

    # --- area (CUSTOMIZE for your project) -------------------------------
    # These are the ACI-CRM defaults. Replace with your project's top-level
    # product feature groupings.
    @{ name = 'area:dashboard';    color = 'c5def5'; desc = 'Dashboard view, KPIs, charts' },
    @{ name = 'area:leads';        color = 'c5def5'; desc = 'Leads list + edit form' },
    @{ name = 'area:inventory';    color = 'c5def5'; desc = 'Inventory view + filters + detail' },
    @{ name = 'area:tasks';        color = 'c5def5'; desc = 'Tasks view' },
    @{ name = 'area:bulk-import';  color = 'c5def5'; desc = 'CSV/Excel bulk import wizard' },
    @{ name = 'area:auth';         color = 'c5def5'; desc = 'MSAL / sign-in / token acquisition' },
    @{ name = 'area:graph';        color = 'c5def5'; desc = 'Graph client, SharePoint reads/writes' },
    @{ name = 'area:feedback-api'; color = 'c5def5'; desc = 'Azure Function feedback API' }
)

Write-Host "Creating/updating $($Labels.Count) labels in $Repo..." -ForegroundColor Cyan

foreach ($lbl in $Labels) {
    $name = $lbl.name
    $color = $lbl.color
    $desc = $lbl.desc
    & gh label create $name --color $color --description $desc --force --repo $Repo
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create/update label '$name' (gh exit $LASTEXITCODE)"
        exit $LASTEXITCODE
    }
    Write-Host "  ok: $name" -ForegroundColor DarkGray
}

Write-Host "Done. $($Labels.Count) labels are now in place." -ForegroundColor Green
