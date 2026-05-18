// LLM proxy Function App — Flex Consumption, NO Easy Auth.
//
// Why no Easy Auth: the @anthropic-ai/claude-agent-sdk wraps @anthropic-ai/sdk,
// which authenticates with `x-api-key: <key>` (not `Authorization: Bearer`).
// The SDK's `Options.env` field lets us substitute the MSAL token for the
// "key", so the request reaches the proxy as:
//     x-api-key: <msal-bearer-token>
// Easy Auth only validates tokens in the standard Authorization header, so
// we'd get every request rejected. Instead the proxy handler (proxy.ts +
// lib/jwt-validate.ts) does manual JWT validation against the tenant's
// signing keys, accepting tokens from either x-api-key OR Authorization.
//
// Everything else mirrors function-feedback.bicep (Flex Consumption FC1,
// system MI, identity-based storage, workspace-based App Insights).
//
// Extra app settings vs feedback:
//   - TENANT_ID            for JWT issuer validation
//   - LLM_API_APP_ID       for JWT audience validation (api://<this-id>)
//   - KEY_VAULT_NAME       so lib/keyvault.ts can fetch anthropic-api-key
//   - ANTHROPIC_UPSTREAM   the real Anthropic API base URL (parameterized
//                          so we can point at a regional endpoint or a
//                          mock during tests)

@description('Function App name. Convention: func-<PROJECT_KEY>-llm.')
param functionAppName string

@description('Flex Consumption plan name. Convention: plan-<PROJECT_KEY>-llm.')
param planName string

@description('Location.')
param location string

@description('Storage account name.')
param storageAccountName string

@description('Storage account blob endpoint.')
param storageBlobEndpoint string

@description('Application Insights connection string.')
param appInsightsConnectionString string

@description('Tenant ID, surfaced to the proxy for JWT issuer validation.')
param tenantId string

@description('LLM API app registration clientId. Surfaced for JWT audience validation (api://<this-id>).')
param llmApiAppId string

@description('Key Vault name. Surfaced via KEY_VAULT_NAME for lib/keyvault.ts.')
param keyVaultName string

@description('Anthropic upstream base URL. Defaults to the public API; override for testing.')
param anthropicUpstream string = 'https://api.anthropic.com'

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
      // No CORS allowlist — the Electron desktop client makes requests from
      // the main process (Node, not a browser), so CORS is irrelevant.
      // Browsers won't successfully call this endpoint anyway since the
      // JWT validation requires tokens issued for this audience, and only
      // the desktop client app registration is pre-authorized.
      cors: {
        allowedOrigins: [
          'http://localhost'
        ]
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
          name: 'TENANT_ID'
          value: tenantId
        }
        {
          name: 'LLM_API_APP_ID'
          value: llmApiAppId
        }
        {
          name: 'KEY_VAULT_NAME'
          value: keyVaultName
        }
        {
          name: 'ANTHROPIC_UPSTREAM'
          value: anthropicUpstream
        }
      ]
    }
  }
}

// Deliberately NO authsettingsV2 resource. Manual JWT validation lives in
// the handler. If Easy Auth is later enabled at the platform level, it will
// reject the proxy's x-api-key auth pattern.

output functionAppId string = functionApp.id
output functionAppName string = functionApp.name
output functionAppUrl string = 'https://${functionApp.properties.defaultHostName}'
output functionMiPrincipalId string = functionApp.identity.principalId
