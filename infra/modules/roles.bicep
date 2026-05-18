// Function MI role assignments.
//
// All three target resources are owned by this deployment; the principal
// (Function App system MI) is created by function-llm.bicep / function-feedback.bicep.
// This module runs AFTER the function modules so the principalId is known.
//
// Roles:
//   - Storage Blob Data Owner on the storage account
//       Flex Consumption reads its deployment package and writes host
//       metadata via MI. Owner (not Contributor) is required so the runtime
//       can manage blob ACLs on the auto-created `app-package-*` container.
//   - Key Vault Secrets User on the Key Vault
//       The Function code in lib/keyvault.ts pulls the relevant secret
//       (anthropic-api-key for the LLM proxy; github-app-private-key for
//       feedback) via MI. Secrets User grants read-only access — narrower
//       than Secrets Officer (which can write).
//   - Monitoring Metrics Publisher on App Insights
//       Recommended for Flex MI-based telemetry. Without this the runtime
//       still emits logs (via the instrumentation key in the connection
//       string), but MI-authenticated custom metric publishes are blocked.

@description('Function App system MI principal ID. From function-*.bicep outputs.')
param functionMiPrincipalId string

@description('Storage account name.')
param storageAccountName string

@description('Key Vault name.')
param keyVaultName string

@description('Application Insights name.')
param appInsightsName string

// Built-in role definition IDs (these are stable across all Azure tenants).
var storageBlobDataOwnerRoleId = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'
var monitoringMetricsPublisherRoleId = '3913510d-42f4-4e42-8a64-420c390055eb'

resource storage 'Microsoft.Storage/storageAccounts@2024-01-01' existing = {
  name: storageAccountName
}

resource keyVault 'Microsoft.KeyVault/vaults@2024-04-01-preview' existing = {
  name: keyVaultName
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: appInsightsName
}

resource miStorageBlobDataOwner 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, functionMiPrincipalId, storageBlobDataOwnerRoleId)
  properties: {
    principalId: functionMiPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataOwnerRoleId)
  }
}

resource miKeyVaultSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(keyVault.id, functionMiPrincipalId, keyVaultSecretsUserRoleId)
  properties: {
    principalId: functionMiPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
  }
}

resource miMonitoringMetricsPublisher 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: appInsights
  name: guid(appInsights.id, functionMiPrincipalId, monitoringMetricsPublisherRoleId)
  properties: {
    principalId: functionMiPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', monitoringMetricsPublisherRoleId)
  }
}
