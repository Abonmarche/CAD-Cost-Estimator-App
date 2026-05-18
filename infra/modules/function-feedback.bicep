// Feedback Function App — Flex Consumption + Easy Auth.
//
// Canonical pattern from abonmarche-app-stack/feedback-function-app skill —
// adapted only to add KEY_VAULT_NAME as an app setting (so the handler's
// lib/keyvault.ts can pull `github-app-private-key` via MI without
// hard-coding the vault name in code).
//
// Flex Consumption specifics:
//   - SKU is FC1 (tier FlexConsumption). FC1 is the only Flex SKU.
//   - kind on the site MUST be 'functionapp,linux' (comma-separated tag list).
//   - The runtime + memory + scale config lives in properties.functionAppConfig,
//     not in siteConfig.linuxFxVersion or appSettings.
//   - AzureWebJobsStorage uses identity-based access (no connection string).
//   - The deployment package container at `app-package-<funcname>` must
//     exist BEFORE the first deploy or `Azure/functions-action@v1` fails
//     with `BlobUploadFailedException: 404 (container does not exist)`.
//
// Easy Auth (authsettingsV2):
//   - V2 issuer URL tenant-locks token validation to this tenant.
//   - allowedAudiences restricts to api://<apiAppId> so a token issued for
//     any other audience (e.g. Microsoft Graph) gets rejected.
//   - unauthenticatedClientAction: 'Return401' means anonymous requests get
//     a clean 401 instead of a 302 to login.microsoftonline.com.

@description('Function App name. Convention: func-<PROJECT_KEY>-feedback.')
param functionAppName string

@description('Flex Consumption plan name. Convention: plan-<PROJECT_KEY>-feedback.')
param planName string

@description('Location.')
param location string

@description('Storage account name (used for AzureWebJobsStorage and deployment package).')
param storageAccountName string

@description('Storage account blob endpoint (e.g. https://stxxxfeedback.blob.core.windows.net/).')
param storageBlobEndpoint string

@description('Application Insights connection string.')
param appInsightsConnectionString string

@description('Tenant ID used for Easy Auth issuer (tenant-lock).')
param tenantId string

@description('API app registration clientId. Easy Auth validates that incoming tokens are issued for this audience.')
param apiAppId string

@description('Key Vault name. Surfaced to the handler via KEY_VAULT_NAME app setting so lib/keyvault.ts can pull github-app-private-key via MI.')
param keyVaultName string

@description('CORS allowed origins. For the Electron desktop client this is not security-relevant (the main process makes the HTTP call, not a browser), but Function Apps require a value. Pass a safe non-wildcard placeholder if no browser callers exist.')
param corsAllowedOrigins array

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: planName
  location: location
  kind: 'functionapp'
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  properties: {
    reserved: true
  }
}

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storageBlobEndpoint}app-package-${functionAppName}'
          authentication: {
            type: 'SystemAssignedIdentity'
          }
        }
      }
      runtime: {
        name: 'node'
        version: '22'
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 40
        instanceMemoryMB: 2048
      }
    }
    siteConfig: {
      cors: {
        allowedOrigins: corsAllowedOrigins
        supportCredentials: false
      }
      appSettings: [
        {
          name: 'AzureWebJobsStorage__accountName'
          value: storageAccountName
        }
        {
          name: 'AzureWebJobsStorage__blobServiceUri'
          value: storageBlobEndpoint
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnectionString
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'KEY_VAULT_NAME'
          value: keyVaultName
        }
      ]
    }
  }
}

resource authSettings 'Microsoft.Web/sites/config@2024-04-01' = {
  parent: functionApp
  name: 'authsettingsV2'
  properties: {
    platform: {
      enabled: true
      runtimeVersion: '~1'
    }
    globalValidation: {
      requireAuthentication: true
      unauthenticatedClientAction: 'Return401'
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          openIdIssuer: '${environment().authentication.loginEndpoint}${tenantId}/v2.0'
          clientId: apiAppId
        }
        validation: {
          allowedAudiences: [
            'api://${apiAppId}'
          ]
        }
      }
    }
    login: {
      tokenStore: {
        enabled: false
      }
    }
  }
}

output functionAppId string = functionApp.id
output functionAppName string = functionApp.name
output functionAppUrl string = 'https://${functionApp.properties.defaultHostName}'
output functionMiPrincipalId string = functionApp.identity.principalId
