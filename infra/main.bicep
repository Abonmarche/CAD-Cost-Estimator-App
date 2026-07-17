// Cost Estimator Azure infrastructure — root template.
//
// Provisions both halves of the in-app authenticated services:
//
//   * LLM proxy stack:     storage, observability, KV, Function App (no Easy
//                          Auth — manual JWT validation in handler)
//   * Feedback API stack:  storage, observability, KV, Function App with
//                          Easy Auth (canonical pattern from
//                          abonmarche-app-stack/feedback-function-app)
//
// Both are provisioned in the existing resource group `rg-cost-estimator-app`
// (which also contains `stcostestimatordist`, the pre-existing installer
// auto-update blob storage — not touched by this template).
//
// What is NOT in this template (and stays in provision-azure.ps1):
//   * Three Entra app registrations (desktop public client + two API server
//     apps), scope exposure, pre-authorization (Microsoft Graph operations,
//     not ARM).
//   * Two CI deploy SPs + federated credentials (Graph).
//   * Deploy SP role assignments on each Function App + storage account
//     (created post-Bicep because they need the deploy SP objectIds).
//   * Importing the Anthropic API key into kv-cost-estimator-llm
//     (`az keyvault secret set` after the vault exists).
//
// Sequence (orchestrated by provision-azure.ps1):
//   1. Bash/PowerShell creates three app registrations + Graph PATCHes
//   2. Calls this template (both API app reg IDs are required parameters)
//   3. Imports the Anthropic key into the LLM vault
//   4. Creates two deploy SPs + federated creds
//   5. Adds deploy SP role assignments using Bicep outputs

targetScope = 'resourceGroup'

// ─── Parameters ─────────────────────────────────────────────────────────────

@description('Location for all resources.')
param location string = resourceGroup().location

@description('Tenant ID. Used for Easy Auth issuer (feedback) and JWT validation (LLM proxy).')
param tenantId string = subscription().tenantId

@description('Object ID of the operator running the deployment. Gets Key Vault Secrets Officer on BOTH vaults.')
param currentUserObjectId string

// LLM proxy stack
@description('LLM proxy: storage account name. 3-24 chars, lowercase alphanumeric.')
param llmStorageAccountName string

@description('LLM proxy: Function App name.')
param llmFunctionAppName string

@description('LLM proxy: Flex Consumption plan name.')
param llmPlanName string

@description('LLM proxy: Key Vault name. 3-24 chars.')
param llmKeyVaultName string

@description('LLM proxy: Log Analytics workspace name.')
param llmWorkspaceName string

@description('LLM proxy: Application Insights name.')
param llmAppInsightsName string

@description('LLM proxy: API app registration clientId. Used for JWT audience validation in the proxy handler.')
param llmApiAppId string

// Feedback API stack
@description('Feedback: storage account name. 3-24 chars, lowercase alphanumeric.')
param feedbackStorageAccountName string

@description('Feedback: Function App name.')
param feedbackFunctionAppName string

@description('Feedback: Flex Consumption plan name.')
param feedbackPlanName string

@description('Feedback: Key Vault name. 3-24 chars.')
param feedbackKeyVaultName string

@description('Feedback: Log Analytics workspace name.')
param feedbackWorkspaceName string

@description('Feedback: Application Insights name.')
param feedbackAppInsightsName string

@description('Feedback: API app registration clientId. Easy Auth audience.')
param feedbackApiAppId string

@description('Feedback: CORS allowed origins (comma-separated string). Not security-relevant for the Electron client (main process makes the call), but Function Apps require a value.')
param feedbackCorsAllowedOrigins string = 'http://localhost'

// Feedback GitHub-App identity. These four are otherwise set OUT OF BAND by
// scripts/setup-feedback-github-app.mjs after deploy; passing them here (with the
// app's real non-secret IDs as defaults) makes redeploys PRESERVE them instead of
// wiping the appSettings block. The private key stays in Key Vault.
@description('Feedback: GitHub App ID (non-secret).')
param githubAppId string = '3758135'
@description('Feedback: GitHub App installation ID (non-secret).')
param githubInstallationId string = '133469931'
@description('Feedback: GitHub org/owner issues are filed under.')
param githubOwner string = 'Abonmarche'
@description('Feedback: GitHub repo issues are filed under.')
param githubRepo string = 'CAD-Cost-Estimator-App'

// ─── Helpers ────────────────────────────────────────────────────────────────

var feedbackCorsOriginsArray = split(feedbackCorsAllowedOrigins, ',')

// ─── LLM proxy stack ────────────────────────────────────────────────────────

module llmStorage 'modules/storage.bicep' = {
  name: 'llm-storage'
  params: {
    storageAccountName: llmStorageAccountName
    location: location
    deploymentContainerName: 'app-package-${llmFunctionAppName}'
  }
}

module llmObservability 'modules/observability.bicep' = {
  name: 'llm-observability'
  params: {
    workspaceName: llmWorkspaceName
    appInsightsName: llmAppInsightsName
    location: location
  }
}

module llmKeyvault 'modules/keyvault.bicep' = {
  name: 'llm-keyvault'
  params: {
    keyVaultName: llmKeyVaultName
    location: location
    tenantId: tenantId
    currentUserObjectId: currentUserObjectId
  }
}

module llmFunction 'modules/function-llm.bicep' = {
  name: 'llm-function'
  params: {
    functionAppName: llmFunctionAppName
    planName: llmPlanName
    location: location
    storageAccountName: llmStorage.outputs.storageAccountName
    storageBlobEndpoint: llmStorage.outputs.blobEndpoint
    appInsightsConnectionString: llmObservability.outputs.appInsightsConnectionString
    tenantId: tenantId
    llmApiAppId: llmApiAppId
    keyVaultName: llmKeyvault.outputs.keyVaultName
  }
}

module llmRoles 'modules/roles.bicep' = {
  name: 'llm-roles'
  params: {
    functionMiPrincipalId: llmFunction.outputs.functionMiPrincipalId
    storageAccountName: llmStorage.outputs.storageAccountName
    keyVaultName: llmKeyvault.outputs.keyVaultName
    appInsightsName: llmObservability.outputs.appInsightsName
  }
}

// ─── Feedback API stack ─────────────────────────────────────────────────────

module feedbackStorage 'modules/storage.bicep' = {
  name: 'feedback-storage'
  params: {
    storageAccountName: feedbackStorageAccountName
    location: location
    deploymentContainerName: 'app-package-${feedbackFunctionAppName}'
  }
}

module feedbackObservability 'modules/observability.bicep' = {
  name: 'feedback-observability'
  params: {
    workspaceName: feedbackWorkspaceName
    appInsightsName: feedbackAppInsightsName
    location: location
  }
}

module feedbackKeyvault 'modules/keyvault.bicep' = {
  name: 'feedback-keyvault'
  params: {
    keyVaultName: feedbackKeyVaultName
    location: location
    tenantId: tenantId
    currentUserObjectId: currentUserObjectId
  }
}

module feedbackFunction 'modules/function-feedback.bicep' = {
  name: 'feedback-function'
  params: {
    functionAppName: feedbackFunctionAppName
    planName: feedbackPlanName
    location: location
    storageAccountName: feedbackStorage.outputs.storageAccountName
    storageBlobEndpoint: feedbackStorage.outputs.blobEndpoint
    appInsightsConnectionString: feedbackObservability.outputs.appInsightsConnectionString
    tenantId: tenantId
    apiAppId: feedbackApiAppId
    keyVaultName: feedbackKeyvault.outputs.keyVaultName
    corsAllowedOrigins: feedbackCorsOriginsArray
    githubAppId: githubAppId
    githubInstallationId: githubInstallationId
    githubOwner: githubOwner
    githubRepo: githubRepo
  }
}

module feedbackRoles 'modules/roles.bicep' = {
  name: 'feedback-roles'
  params: {
    functionMiPrincipalId: feedbackFunction.outputs.functionMiPrincipalId
    storageAccountName: feedbackStorage.outputs.storageAccountName
    keyVaultName: feedbackKeyvault.outputs.keyVaultName
    appInsightsName: feedbackObservability.outputs.appInsightsName
  }
}

// ─── Outputs ────────────────────────────────────────────────────────────────
//
// provision-azure.ps1 reads each via:
//   az deployment group show -g $RG -n $DEPLOY --query "properties.outputs.<name>.value" -o tsv
// and folds them into the JSON contract that downstream phases consume.

// LLM proxy outputs
output llmStorageAccountName string = llmStorage.outputs.storageAccountName
output llmFunctionAppName string = llmFunction.outputs.functionAppName
output llmFunctionAppUrl string = llmFunction.outputs.functionAppUrl
output llmFunctionMiPrincipalId string = llmFunction.outputs.functionMiPrincipalId
output llmKeyVaultName string = llmKeyvault.outputs.keyVaultName
output llmKeyVaultUri string = llmKeyvault.outputs.keyVaultUri

// Feedback API outputs
output feedbackStorageAccountName string = feedbackStorage.outputs.storageAccountName
output feedbackFunctionAppName string = feedbackFunction.outputs.functionAppName
output feedbackFunctionAppUrl string = feedbackFunction.outputs.functionAppUrl
output feedbackFunctionMiPrincipalId string = feedbackFunction.outputs.functionMiPrincipalId
output feedbackKeyVaultName string = feedbackKeyvault.outputs.keyVaultName
output feedbackKeyVaultUri string = feedbackKeyvault.outputs.keyVaultUri
