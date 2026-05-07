# Code Signing Setup (Azure Artifact Signing)

**Status:** Planned. Not yet implemented. Distribution currently runs unsigned per [`docs/distribution.md`](./distribution.md). Follow this document when ready to add signing — typically after the initial pilot has validated the app and we want to roll out more broadly without forcing every user through the SmartScreen "Run anyway" dance, and to satisfy any Abonmarche IT signing policies on managed laptops.

## Why we'll sign

Without a code signature, Windows shows a full-screen blue **"Windows protected your PC — Unknown publisher"** SmartScreen panel on every install of every version. Non-technical users routinely close this assuming the app is malware. Corporate Application Control policies (WDAC, AppLocker) may also block unsigned binaries outright.

With an **Azure Artifact Signing** signature attached:

- The UAC prompt (if any) shows a clean blue *"Verified publisher: Abonmarche Consultants"*.
- SmartScreen reputation accrues to the publisher identity, so warnings fade with each install during the pilot and are typically gone by broader rollout.
- Subsequent versions inherit the publisher reputation — auto-updates run silently.
- Corporate AV products (CrowdStrike, SentinelOne, Microsoft Defender for Endpoint) apply much lighter heuristics to signed binaries.
- Most corporate signing-required policies are satisfied by a Microsoft-managed CA chain.

## Why Azure Artifact Signing specifically

Microsoft launched **Azure Trusted Signing** in March 2024 and renamed it to **Azure Artifact Signing** in early 2026 ([product page](https://azure.microsoft.com/en-us/products/artifact-signing), [docs](https://learn.microsoft.com/en-us/azure/artifact-signing/)). Compared to a traditional OV cert from DigiCert / Sectigo / SSL.com:

- **No USB hardware token** to provision or carry around. Microsoft's mid-2023 baseline requirements pushed all third-party OV/EV certs onto hardware HSMs; Artifact Signing is the cloud-native alternative.
- **~$120/yr** (Basic SKU, $9.99/month) instead of $100-250/yr for an OV cert *plus* $80-150/yr for cloud HSM hosting.
- **Same Azure subscription** that already pays for our Blob Storage distribution and CostEstDB MCP.
- **Microsoft-managed CA**, which corporate IT generally accepts cleanly.

Two things to be honest about:

1. **It is not an EV cert.** Microsoft has stated Artifact Signing will not issue EV certs. SmartScreen reputation still has to build; first-pilot installs will still see the SmartScreen panel, but with *"Publisher: Abonmarche Consultants"* visible instead of *"Unknown publisher"* and the **Run anyway** button more prominent. Reputation accrues quickly for our use case (small pilot → broad rollout = exactly the model SmartScreen reputation rewards).
2. **Identity Validation is human-gated.** Microsoft staff review the submission. Historically this took up to a week ("Verification Week"); the 2026 docs suggest it's faster now, but plan for a 1-5 business day gap between submitting validation and being able to issue certificates.

## Eligibility

Per the Microsoft Learn FAQ (May 2026):

- **Public Trust certificates** (the kind needed for SmartScreen recognition) are available to organizations in the **USA, Canada, the European Union, and the United Kingdom**. Abonmarche (US) qualifies.
- **The Microsoft.CodeSigning resource provider is not supported on Free or Trial Azure subscriptions.** Our Axea Labs subscription needs to be a paid tier (Pay-As-You-Go, EA, MCA, or Visual Studio Pro/Enterprise).
- **The certificate Common Name (CN) and Organization (O) cannot be customized** — they are set to the validated legal entity name. Decide before submitting whether to validate as **Abonmarche Consultants** (parent company, what users will see in SmartScreen) or some other legal entity.

## High-level rollout phases

The work splits cleanly into three phases, separated by Microsoft's review timeline:

| Phase | What happens | Who acts | Time |
|---|---|---|---|
| 1. Onboarding | Submit Identity Validation, wait for Microsoft approval. | Us → Microsoft | 1-5 business days |
| 2. Provisioning | Create Artifact Signing account, certificate profile, RBAC roles. | Us | ~30 minutes |
| 3. CI integration | Update `electron-builder.yml` sign hook + `release.yml` to authenticate to Azure and sign during the build. | Us | ~30 minutes + first signed release to verify |

## Phase 1 — Identity Validation

This is the gating step. Begin it well before you need signed builds.

### 1.1 Choose the legal entity

Decide what name will appear in **"Verified publisher: ___"** for the rest of time. For an internal Abonmarche tool, the natural choice is **Abonmarche Consultants**. You'll need:

- Legal entity name as registered with the state/D&B (must match exactly)
- Registered business address
- Primary email address (must be a real mailbox you control, not a distribution list — the verification email expires in 7 days and the link can't be re-sent on the same request)
- D&B / DUNS number or equivalent business registration ID

### 1.2 Register the resource provider

```powershell
$SUBSCRIPTION = "<axea-labs-subscription-id>"
az account set --subscription $SUBSCRIPTION
az provider register --namespace Microsoft.CodeSigning
az provider show --namespace Microsoft.CodeSigning --query "registrationState"
# wait until it returns "Registered"
```

### 1.3 Submit Identity Validation in the portal

Identity Validation submission is **portal-only** — there is no `az` command for it. In the Azure portal:

1. Search for **Trusted Signing Accounts** (the portal blade still uses the old name as of 2026; the resource provider and product page have been renamed to Artifact Signing).
2. **Identity validations** → **+ New identity validation** → choose **Organization**.
3. Fill in the legal entity details from step 1.1.
4. Microsoft sends a verification email to the primary email address. Click the link within 7 days.
5. Microsoft staff review the submission. Status moves through **InProgress** → **Completed** (or **Failed**, in which case Microsoft requests additional documents — you have 3 attempts before the request is permanently denied).

> Don't create duplicate Identity Validation requests for the same entity — it doesn't speed up review and can confuse the validators.

### 1.4 Assign yourself the role to use Identity Validation

If the **+ New identity validation** button is greyed out, you don't have the **Trusted Signing Identity Verifier** role on the subscription. Have a subscription Owner assign it via **IAM → Add role assignment**, or run:

```powershell
$RG = "rg-cost-estimator-signing"
az role assignment create `
  --assignee "<your-entra-id-upn-or-objectid>" `
  --role "Trusted Signing Identity Verifier" `
  --scope "/subscriptions/$SUBSCRIPTION"
```

## Phase 2 — Provision the Artifact Signing account & cert profile

Run these only **after** Identity Validation status shows **Completed**.

```powershell
$RG          = "rg-cost-estimator-app"
$LOCATION    = "eastus2"
$ACCOUNT     = "as-cost-estimator"
$PROFILE     = "abonmarche-public-trust"
$IDV_ID      = "<identity-validation-id from the portal>"

az group create --name $RG --location $LOCATION

# Artifact Signing account (Basic SKU is sufficient for our volume).
az resource create `
  --resource-group $RG `
  --resource-type "Microsoft.CodeSigning/codeSigningAccounts" `
  --name $ACCOUNT `
  --location $LOCATION `
  --properties '{\"sku\":{\"name\":\"Basic\"}}'

# Certificate profile (Public Trust = the kind SmartScreen recognizes).
az resource create `
  --resource-group $RG `
  --resource-type "Microsoft.CodeSigning/codeSigningAccounts/certificateProfiles" `
  --name "$ACCOUNT/$PROFILE" `
  --properties "{\"profileType\":\"PublicTrust\",\"identityValidationId\":\"$IDV_ID\"}"
```

### Grant the signing identity access

The CI workflow needs an Entra identity that can sign. The cleanest approach is **GitHub OIDC federated credentials → Microsoft Entra app registration** (no long-lived secrets stored in GitHub). High level:

1. Create an Entra app registration: `App registrations → New → Cost Estimator CI`.
2. Add a **Federated credential** with subject `repo:<org>/<repo>:ref:refs/tags/v*` and issuer `https://token.actions.githubusercontent.com` (covers tag-triggered releases) plus a second one for `repo:<org>/<repo>:environment:release` if you adopt environment gating.
3. Grant the app the **Trusted Signing Certificate Profile Signer** role on the certificate profile resource:
   ```powershell
   $APP_ID = "<app-registration-client-id>"
   $SCOPE  = "/subscriptions/$SUBSCRIPTION/resourceGroups/$RG/providers/Microsoft.CodeSigning/codeSigningAccounts/$ACCOUNT/certificateProfiles/$PROFILE"
   az role assignment create `
     --assignee $APP_ID `
     --role "Trusted Signing Certificate Profile Signer" `
     --scope $SCOPE
   ```

For full federated-credential setup, see [Configure GitHub Actions OIDC for Azure](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect).

## Phase 3 — Wire signing into the build

### 3.1 Add GitHub repo secrets / variables

| Name | Type | Value |
|---|---|---|
| `AZURE_TENANT_ID` | Variable | Entra tenant ID |
| `AZURE_CLIENT_ID` | Variable | App registration client ID |
| `AZURE_SUBSCRIPTION_ID` | Variable | Axea Labs subscription ID |
| `AZURE_CODE_SIGNING_ACCOUNT` | Variable | `as-cost-estimator` |
| `AZURE_CODE_SIGNING_PROFILE` | Variable | `abonmarche-public-trust` |
| `AZURE_CODE_SIGNING_ENDPOINT` | Variable | `https://eus.codesigning.azure.net/` (regional) |

(All of the above can live as plain variables, not secrets — they're not sensitive on their own. Auth happens via OIDC.)

### 3.2 Add the sign hook for electron-builder

Create `build/sign.js` (referenced from `electron-builder.yml`):

```js
// Custom sign hook invoked by electron-builder once per artifact (the NSIS
// installer + the embedded app .exe). Calls the Azure Trusted Signing dlib
// via SignTool. Authentication flows through the GitHub Actions OIDC token
// (azure/login@v2) which has been exchanged for an Entra access token by
// the time this runs.
const { execFileSync } = require('node:child_process');

exports.default = async function sign(configuration) {
  const file = configuration.path;
  const args = [
    'sign',
    '/v',
    '/debug',
    '/fd', 'SHA256',
    '/tr', 'http://timestamp.acs.microsoft.com',
    '/td', 'SHA256',
    '/dlib', process.env.AZURE_CODE_SIGNING_DLIB,
    '/dmdf', process.env.AZURE_CODE_SIGNING_METADATA,
    file,
  ];
  execFileSync(process.env.SIGNTOOL_PATH, args, { stdio: 'inherit' });
};
```

Add to `electron-builder.yml`:

```yaml
win:
  signtoolOptions:
    sign: build/sign.js
```

And a metadata JSON consumed by SignTool's Azure dlib (`build/azure-codesigning.json`):

```json
{
  "Endpoint": "https://eus.codesigning.azure.net/",
  "CodeSigningAccountName": "as-cost-estimator",
  "CertificateProfileName": "abonmarche-public-trust",
  "CorrelationId": "cost-estimator-build"
}
```

### 3.3 Update `.github/workflows/release.yml`

Insert these steps after **Build (electron-vite)** and before **Package installer**:

```yaml
      - name: Azure login (OIDC, no stored secret)
        uses: azure/login@v2
        with:
          client-id: ${{ vars.AZURE_CLIENT_ID }}
          tenant-id: ${{ vars.AZURE_TENANT_ID }}
          subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}

      - name: Install Azure code-signing dlib + SignTool
        shell: pwsh
        run: |
          # Install the Azure code-signing dlib (Trusted Signing client).
          # Path will be picked up by build/sign.js via env var below.
          Invoke-WebRequest `
            -Uri "https://www.nuget.org/api/v2/package/Microsoft.Trusted.Signing.Client" `
            -OutFile codesign.zip
          Expand-Archive codesign.zip -DestinationPath codesign
          $dlib = (Get-ChildItem codesign\bin\x64\Azure.CodeSigning.Dlib.dll).FullName
          echo "AZURE_CODE_SIGNING_DLIB=$dlib" >> $env:GITHUB_ENV
          echo "AZURE_CODE_SIGNING_METADATA=$pwd\build\azure-codesigning.json" >> $env:GITHUB_ENV
          # SignTool ships with the Windows SDK already installed on the runner.
          $signtool = (Get-ChildItem `
            -Path 'C:\Program Files (x86)\Windows Kits\10\bin' `
            -Recurse -Filter signtool.exe |
            Where-Object { $_.Directory.FullName -match 'x64' } |
            Select-Object -First 1).FullName
          echo "SIGNTOOL_PATH=$signtool" >> $env:GITHUB_ENV
```

Permissions block at the top of the job needs to include `id-token: write` so OIDC can mint a token:

```yaml
permissions:
  contents: read
  id-token: write
```

The existing **Package installer** step then runs `electron-builder`, which invokes `build/sign.js` for each artifact, which shells out to SignTool with the Azure dlib loaded — and SignTool talks to the Azure Trusted Signing endpoint using the OIDC token to obtain a fresh signing certificate (3-day validity, refreshed per call).

### 3.4 First signed release

Cut a real release: bump `package.json` version, `git tag v0.X.Y && git push --tags`. Watch the workflow logs. The signing step typically adds 30-60 seconds to the build.

After publish, verify:

1. Download the new installer from the Azure Blob URL on a clean Windows VM or non-dev account.
2. Right-click → **Properties → Digital Signatures**. You should see **Microsoft ID Verified Code Signing PCA 2021** as the signer chain and **Abonmarche Consultants** as the signer name.
3. Run the installer. The UAC prompt (if any) should show *"Verified publisher: Abonmarche Consultants"* in clean blue, not orange "Unknown."
4. SmartScreen may still show its blue panel for the first install on a fresh machine. The text should now read *"Publisher: Abonmarche Consultants"* with **Run anyway** more prominent. Reputation accrues from here.

## Verifying the signing posture in production

Useful commands:

```powershell
# Inspect the signature chain on an installer.
& 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe' verify /v /pa "Cost Estimator-0.2.0-setup.exe"

# Check timestamp service health (the workflow uses it; if it's down,
# signed binaries technically still work but won't survive certificate
# expiration).
curl http://timestamp.acs.microsoft.com   # 200 OK = healthy
```

## Costs

- **Artifact Signing Basic SKU:** $9.99/month, includes 5,000 signatures/month. Each release signs ~2 artifacts (NSIS installer + embedded .exe) → 24 releases/year × 2 = 48 signatures, well under the included quota.
- **No additional cost** beyond what the existing distribution flow already pays for Blob Storage (~$1/year).

**Total ongoing cost: ~$120/year.**

## Open follow-ups when we revisit this

- Confirm whether Abonmarche IT enforces AppLocker / WDAC on managed laptops, and pre-bless the publisher name with them before broader rollout.
- Decide on a key rotation / incident-response plan in the (unlikely) case the Entra app registration credentials are compromised — Microsoft can revoke certs but operational ownership is on us.
- Once signed releases have been live for a quarter, audit how often SmartScreen warnings still fire for new users and decide whether the OV-equivalent reputation accrual is sufficient or whether to switch to a third-party EV cert.
