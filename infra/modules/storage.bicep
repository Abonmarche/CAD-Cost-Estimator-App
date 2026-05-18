// Storage account for a Function App.
//
// Doubles as: AzureWebJobsStorage (function runtime host metadata) AND the
// Flex Consumption deployment package container. The `app-package-<func>`
// container must exist BEFORE the first deploy (despite some Azure docs
// suggesting otherwise — `Azure/functions-action@v1` will fail with
// `BlobUploadFailedException: 404 (The specified container does not exist)`
// if the container is missing). We pre-create it here.
//
// Identity-based access only (no shared-key reads). The Function App's
// system MI gets Storage Blob Data Owner via the roles module so the runtime
// can read host metadata + the deployment package without connection strings
// or SAS URLs.

@description('Storage account name. Must be 3-24 chars, lowercase alphanumeric.')
@minLength(3)
@maxLength(24)
param storageAccountName string

@description('Location for the storage account.')
param location string

@description('Name of the Flex deployment package container. Convention: app-package-<functionAppName>. Must match functionAppConfig.deployment.storage.value on the Function App resource.')
param deploymentContainerName string

resource storage 'Microsoft.Storage/storageAccounts@2024-01-01' = {
  name: storageAccountName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    publicNetworkAccess: 'Enabled'
    defaultToOAuthAuthentication: true
  }
}

resource blobServices 'Microsoft.Storage/storageAccounts/blobServices@2024-01-01' = {
  parent: storage
  name: 'default'
}

resource deploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' = {
  parent: blobServices
  name: deploymentContainerName
  properties: {
    publicAccess: 'None'
  }
}

output storageAccountId string = storage.id
output storageAccountName string = storage.name
output blobEndpoint string = storage.properties.primaryEndpoints.blob
output deploymentContainerName string = deploymentContainer.name
