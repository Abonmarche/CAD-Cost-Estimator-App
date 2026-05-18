#!/usr/bin/env node
// Automated GitHub App + Key Vault + Function App wiring for the feedback system.
//
// Generalized from Abonmarche/ACI-CRM `scripts/setup-feedback-github-app.mjs`.
// All project-specific values come from env vars so the same script works for
// any project that follows the feedback-loop-toolkit pattern.
//
// Required env vars:
//   ORG              GitHub org. Example: Abonmarche
//   REPO             GitHub repo. Example: ACI-CRM
//   RESOURCE_GROUP   Azure resource group. Example: rg-aci-crm
//   FUNCTION_APP     Azure Function App name. Example: func-aci-crm-feedback
//   KEY_VAULT        Azure Key Vault name. Example: kv-aci-crm-fb
//
// Optional env vars:
//   SECRET_NAME      Default: github-app-private-key
//   APP_NAME         GitHub App display name. Default: "<REPO> Feedback"
//   APP_DESCRIPTION  Default: "Creates GitHub issues from the in-app feedback form."
//
// Flow:
//   1. Local HTTP server starts on a free port; prints a URL.
//   2. User opens URL -> "Create GitHub App for <ORG>" (browser click 1).
//   3. GitHub redirects to install page -> user picks repo + clicks Install (click 2).
//   4. Script captures App ID + private key + installation ID.
//   5. Uploads pem to Key Vault via `az`.
//   6. Sets Function App settings (App ID, Installation ID, KV URL, etc.).
//   7. Restarts Function App.

import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { writeFile, unlink } from 'node:fs/promises'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'

const execFile = promisify(execFileCb)

const ORG = required('ORG')
const REPO = required('REPO')
const RESOURCE_GROUP = required('RESOURCE_GROUP')
const FUNCTION_APP = required('FUNCTION_APP')
const KEY_VAULT = required('KEY_VAULT')
const SECRET_NAME = process.env.SECRET_NAME ?? 'github-app-private-key'
const APP_NAME = process.env.APP_NAME ?? `${REPO} Feedback`
const APP_DESCRIPTION =
  process.env.APP_DESCRIPTION ?? 'Creates GitHub issues from the in-app feedback form.'

const STATE = randomBytes(16).toString('hex')
const AZ = process.platform === 'win32' ? 'az.cmd' : 'az'
// Node 18.20+ / 20.12+ / 22+ refuses to spawn .cmd / .bat files via execFile
// without shell:true (CVE-2024-27980 mitigation). On Windows we MUST opt in.
// Quoting is fine here because every value we pass is a controlled constant
// or a server-issued ID/URL — never user-supplied free text.
const EXEC_OPTS = process.platform === 'win32' ? { shell: true } : {}

function required(name) {
  const v = process.env[name]
  if (!v) {
    process.stderr.write(`ERROR: env var ${name} is required\n`)
    process.exit(1)
  }
  return v
}

function log(level, msg) {
  const color = { info: '36', ok: '32', warn: '33', err: '31' }[level] ?? '0'
  process.stdout.write(`\x1b[${color}m[${level}]\x1b[0m ${msg}\n`)
}

function manifest(port) {
  // Do NOT include `hook_attributes` - per GitHub's manifest docs, the block
  // is optional, and *if present* requires a `url` field even when `active`
  // is false. Omitting the whole block opts out of webhooks cleanly.
  return {
    name: APP_NAME,
    url: `https://github.com/${ORG}/${REPO}`,
    description: APP_DESCRIPTION,
    public: false,
    default_permissions: { issues: 'write' },
    default_events: [],
    redirect_url: `http://127.0.0.1:${port}/callback`,
    setup_url: `http://127.0.0.1:${port}/installed`,
    setup_on_update: false,
  }
}

async function main() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port

  let resolveCode
  let resolveInstallation
  let appData
  const codeP = new Promise((r) => (resolveCode = r))
  const installationP = new Promise((r) => (resolveInstallation = r))

  server.on('request', async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`)

    if (url.pathname === '/start') {
      // GitHub's manifest flow requires a POST with a form body. Tiny HTML
      // page auto-submits. The manifest value is set via JS to avoid any
      // HTML-attribute-parsing ambiguity with the embedded JSON's quotes.
      const manifestObj = manifest(port)
      const action = `https://github.com/organizations/${ORG}/settings/apps/new?state=${STATE}`
      const html =
        '<!DOCTYPE html><html><head><meta charset="utf-8">' +
        '<title>Redirecting to GitHub...</title>' +
        '<style>body{font-family:system-ui;padding:2rem}</style></head><body>' +
        '<h2>Redirecting to GitHub...</h2>' +
        '<p>If your browser does not redirect automatically, click the button.</p>' +
        `<form id="f" method="POST" action="${action}" accept-charset="utf-8">` +
        '<input type="hidden" name="manifest" id="m">' +
        '<button type="submit">Continue to GitHub</button>' +
        '</form>' +
        '<script>\n' +
        `var data = ${JSON.stringify(manifestObj)};\n` +
        'document.getElementById("m").value = JSON.stringify(data);\n' +
        'document.getElementById("f").submit();\n' +
        '</script>' +
        '</body></html>'
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }

    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      if (state !== STATE) {
        res.writeHead(400).end('state mismatch — refusing')
        return
      }
      try {
        const r = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'feedback-loop-toolkit-setup',
          },
        })
        if (!r.ok) {
          const body = await r.text()
          res.writeHead(500).end(`manifest exchange failed: ${r.status} ${body}`)
          log('err', `manifest exchange failed: ${r.status} ${body.slice(0, 200)}`)
          return
        }
        appData = await r.json()
        log('ok', `GitHub App created: ID ${appData.id}, slug ${appData.slug}`)
        resolveCode(appData)
        res.writeHead(302, { Location: `${appData.html_url}/installations/new` })
        res.end()
      } catch (err) {
        log('err', `exchange error: ${err.message}`)
        res.writeHead(500).end(err.message)
      }
      return
    }

    if (url.pathname === '/installed') {
      const installationId = url.searchParams.get('installation_id')
      if (installationId) {
        log('ok', `App installed: installation ID ${installationId}`)
        resolveInstallation(installationId)
      }
      res
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(
          '<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem"><h2>✓ Setup complete.</h2><p>You can close this tab.</p></body></html>',
        )
      return
    }

    res.writeHead(404).end('not found')
  })

  const startUrl = `http://127.0.0.1:${port}/start`

  console.log()
  log('info', `Local callback server running on 127.0.0.1:${port}`)
  console.log()
  console.log('\x1b[1;33m  Open this URL in your browser:\x1b[0m')
  console.log()
  console.log(`  ${startUrl}`)
  console.log()
  console.log(`  1. Click "Create GitHub App for ${ORG}".`)
  console.log('  2. Your browser will redirect to the install page. Click "Install".')
  console.log(`  3. When prompted, choose to install on \x1b[1m${ORG}/${REPO}\x1b[0m only.`)
  console.log()
  log('info', 'Waiting for "Create" click (ctrl-C to abort)...')

  await codeP
  log('info', 'Waiting for "Install" click...')
  const installationId = await installationP
  server.close()

  log('info', 'Uploading private key to Key Vault...')
  const pemPath = join(tmpdir(), `feedback-app-${Date.now()}.pem`)
  await writeFile(pemPath, appData.pem, { mode: 0o600 })
  try {
    await execFile(AZ, [
      'keyvault', 'secret', 'set',
      '--vault-name', KEY_VAULT,
      '--name', SECRET_NAME,
      '--file', pemPath,
      '-o', 'none',
    ], EXEC_OPTS)
    log('ok', `Private key stored as ${KEY_VAULT}/${SECRET_NAME}`)
  } finally {
    await unlink(pemPath).catch(() => {})
  }

  log('info', 'Setting Function App settings...')
  await execFile(AZ, [
    'functionapp', 'config', 'appsettings', 'set',
    '-n', FUNCTION_APP,
    '-g', RESOURCE_GROUP,
    '--settings',
    `GITHUB_APP_ID=${appData.id}`,
    `GITHUB_INSTALLATION_ID=${installationId}`,
    `GITHUB_OWNER=${ORG}`,
    `GITHUB_REPO=${REPO}`,
    `KEY_VAULT_URL=https://${KEY_VAULT}.vault.azure.net/`,
    `KEY_VAULT_SECRET_NAME=${SECRET_NAME}`,
    '-o', 'none',
  ], EXEC_OPTS)
  log('ok', 'Function App settings applied.')

  log('info', 'Restarting Function App...')
  await execFile(AZ, [
    'functionapp', 'restart',
    '-n', FUNCTION_APP,
    '-g', RESOURCE_GROUP,
    '-o', 'none',
  ], EXEC_OPTS)
  log('ok', 'Function App restarted.')

  console.log()
  log('ok', 'Feedback system is wired up.')
  console.log()
  console.log(`  GitHub App page:   ${appData.html_url}`)
  console.log(`  App ID:            ${appData.id}`)
  console.log(`  Installation ID:   ${installationId}`)
  console.log(`  App slug:          ${appData.slug}    <-- use this for allowed_bots in workflows`)
  console.log(`  Private key:       Key Vault ${KEY_VAULT} / secret '${SECRET_NAME}'`)
  console.log()
  console.log(JSON.stringify({
    appId: appData.id,
    installationId,
    slug: appData.slug,
    htmlUrl: appData.html_url,
  }))
}

main().catch((err) => {
  log('err', err.stack ?? err.message)
  process.exit(1)
})
