// Key Vault — RBAC mode, soft-delete 90d, purge protection OFF.
//
// Purge-protection is intentionally OFF. It's irreversible once enabled and
// prevents clean teardown of test/sandbox deployments. For production
// secrets that warrant tamper resistance, flip it on with a follow-up
// `az keyvault update --enable-purge-protection true` AFTER the project has
// stabilized — NOT here in the template, because that would lock every
// fresh deploy.
//
// Two role assignments live elsewhere:
//   - Function MI -> Key Vault Secrets User (in roles.bicep, needs MI principalId)
//   - Current operator -> Key Vault Secrets Officer (here, principalId from param)
// The operator gets Secrets Officer (not Reader) so they can `az keyvault
// secret set` the Anthropic API key (LLM vault) or GitHub App private key
// (feedback vault) post-provisioning.

@description('Key Vault name. Must be 3-24 chars, alphanumeric + hyphens.')
@minLength(3)
@maxLength(24)
param keyVaultName string

@description('Location.')
param location string

@description('Tenant ID for the Key Vault.')
param tenantId string

@description('Object ID of the user running the deployment. Will be granted Key Vault Secrets Officer. Do NOT commit this value to source control — pass it from the provisioning script.')
param currentUserObjectId string

var secretsOfficerRoleId = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'

resource keyVault 'Microsoft.KeyVault/vaults@2024-04-01-preview' = {
  name: keyVaultName
  location: location
  properties: {
    tenantId: tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: null
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

resource operatorSecretsOfficer 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(keyVault.id, currentUserObjectId, secretsOfficerRoleId)
  properties: {
    principalId: currentUserObjectId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', secretsOfficerRoleId)
  }
}

output keyVaultId string = keyVault.id
output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
