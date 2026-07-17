// notify-submitter.mjs - emails the original feedback submitter when a PR that
// closes their user-reported issue is merged to main.
//
// Invoked by .github/workflows/notify-submitter.yml. Self-contained: uses Node's
// global fetch for the GitHub GraphQL/REST API and nodemailer for SMTP. No
// dependency is added to package.json - the workflow installs nodemailer ad hoc.
//
// TWO MODES:
//   - TEST_MODE=true (workflow_dispatch): sends ONE generic test email to
//     TEST_RECIPIENT only (no CC, no GitHub lookups) to prove SMTP works.
//   - real mode (pull_request merged): resolves the issues the PR closed, keeps
//     the user-reported ones not yet notified, emails each submitter, CC's the
//     team, and adds a silent `submitter-notified` label for idempotency.
//
// Required env (always): MAIL_USERNAME, MAIL_PASSWORD.
// Required env (real mode only): GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER.
// Optional: MAIL_FROM_NAME, NOTIFY_CC (comma-separated), TEST_MODE, TEST_RECIPIENT.

import nodemailer from 'nodemailer'

const API = 'https://api.github.com'
const NOTIFIED_LABEL = 'submitter-notified'
const SUBMITTED_BY_RE = /\*\*Submitted by:\*\*\s*(.+?)\s*<([^>]+)>/

// Team copied on every REAL notification. The NOTIFY_CC repo variable
// (comma-separated) OVERRIDES this default when set; the baked-in default is the
// standing Abonmarche pair - Evan Sailor + Garrick Garcia. The submitter is
// always the To and is filtered out of Cc below, so a submitter who is also on
// this list is not double-addressed. Test mode never CC's.
const CC_RECIPIENTS = (process.env.NOTIFY_CC && process.env.NOTIFY_CC.trim())
  ? process.env.NOTIFY_CC.split(',').map((s) => s.trim()).filter(Boolean)
  : ['esailor@abonmarche.com', 'ggarcia@abonmarche.com']

const {
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
  PR_NUMBER,
  MAIL_USERNAME,
  MAIL_PASSWORD,
  MAIL_FROM_NAME,
  TEST_MODE,
  TEST_RECIPIENT,
} = process.env

const testMode = String(TEST_MODE).toLowerCase() === 'true'
// Actions passes an unset variable as "" (not undefined), so coalesce explicitly.
const fromName = (MAIL_FROM_NAME && MAIL_FROM_NAME.trim()) || 'Abonmarche Cost Estimator'

function requireEnv(name, value) {
  if (!value) {
    console.error(`Missing required env: ${name}`)
    process.exit(1)
  }
}
requireEnv('MAIL_USERNAME', MAIL_USERNAME)
requireEnv('MAIL_PASSWORD', MAIL_PASSWORD)

function makeTransport() {
  return nodemailer.createTransport({
    host: 'smtp.office365.com',
    port: 587,
    secure: false, // upgrade via STARTTLS
    requireTLS: true,
    auth: { user: MAIL_USERNAME, pass: MAIL_PASSWORD },
  })
}

// Generic, intentionally minimal copy.
function buildEmail(title) {
  const subject = 'Your issue has been addressed'
  const text = [
    `Your issue "${title}" has been addressed.`,
    '',
    'If you find it was not substantial enough, please submit another.',
    '',
    `- ${fromName}`,
  ].join('\n')
  return { subject, text }
}

async function graphql(query, variables) {
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json()
  if (!res.ok || json.errors) {
    throw new Error(`GraphQL error: ${res.status} ${JSON.stringify(json.errors ?? json)}`)
  }
  return json.data
}

const ghRest = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
})

// Issues this merged PR closes, with their labels and body.
async function resolveClosedIssues(owner, repo, pr) {
  const data = await graphql(
    `query ($owner: String!, $repo: String!, $pr: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) {
          closingIssuesReferences(first: 20) {
            nodes {
              number
              title
              body
              url
              labels(first: 40) { nodes { name } }
            }
          }
        }
      }
    }`,
    { owner, repo, pr },
  )
  const nodes = data?.repository?.pullRequest?.closingIssuesReferences?.nodes ?? []
  return nodes.map((n) => ({
    number: n.number,
    title: n.title,
    body: n.body ?? '',
    url: n.url,
    labelNames: (n.labels?.nodes ?? []).map((l) => l.name),
  }))
}

// Ensure the idempotency label exists (idempotent; ignores "already exists").
async function ensureNotifiedLabel(owner, repo) {
  const res = await fetch(`${API}/repos/${owner}/${repo}/labels`, {
    method: 'POST',
    headers: ghRest(GITHUB_TOKEN),
    body: JSON.stringify({
      name: NOTIFIED_LABEL,
      color: '0e8a16',
      description: 'Submitter has been emailed that their request was addressed',
    }),
  })
  if (!res.ok && res.status !== 422) {
    console.warn(`Could not ensure label '${NOTIFIED_LABEL}': ${res.status}`)
  }
}

async function markNotified(owner, repo, issueNumber) {
  const res = await fetch(`${API}/repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
    method: 'POST',
    headers: ghRest(GITHUB_TOKEN),
    body: JSON.stringify({ labels: [NOTIFIED_LABEL] }),
  })
  if (!res.ok) throw new Error(`Failed to label issue #${issueNumber}: ${res.status}`)
}

// --- TEST MODE: prove SMTP works by emailing one address, nothing else. -------
async function runTest() {
  const to = (TEST_RECIPIENT && TEST_RECIPIENT.trim()) || MAIL_USERNAME
  const { subject, text } = buildEmail('[TEST] Sample issue title')
  const transport = makeTransport()
  await transport.sendMail({
    from: { name: fromName, address: MAIL_USERNAME },
    to,
    subject: `[TEST] ${subject}`,
    text,
  })
  console.log(`Test email sent to ${to}.`)
}

// --- REAL MODE: notify submitters of issues this merged PR closed. ------------
async function runReal() {
  requireEnv('GITHUB_TOKEN', GITHUB_TOKEN)
  requireEnv('GITHUB_REPOSITORY', GITHUB_REPOSITORY)
  requireEnv('PR_NUMBER', PR_NUMBER)
  const [owner, repo] = GITHUB_REPOSITORY.split('/')
  const pr = Number(PR_NUMBER)

  const issues = await resolveClosedIssues(owner, repo, pr)
  if (issues.length === 0) {
    console.log(`PR #${pr} closes no issues - nothing to notify.`)
    return
  }

  const targets = []
  for (const issue of issues) {
    if (!issue.labelNames.includes('user-reported')) {
      console.log(`Skip #${issue.number}: not a user-reported issue.`)
      continue
    }
    if (issue.labelNames.includes(NOTIFIED_LABEL)) {
      console.log(`Skip #${issue.number}: already notified.`)
      continue
    }
    const m = issue.body.match(SUBMITTED_BY_RE)
    const email = m?.[2]?.trim()
    if (!email || email.toLowerCase() === 'unknown') {
      console.log(`Skip #${issue.number}: no parseable submitter email.`)
      continue
    }
    targets.push({ ...issue, email })
  }

  if (targets.length === 0) {
    console.log('No eligible issues to notify.')
    return
  }

  await ensureNotifiedLabel(owner, repo)
  const transport = makeTransport()

  let failures = 0
  for (const t of targets) {
    const { subject, text } = buildEmail(t.title)
    // Don't CC someone who is already the primary recipient.
    const cc = CC_RECIPIENTS.filter((a) => a.toLowerCase() !== t.email.toLowerCase())
    try {
      await transport.sendMail({
        from: { name: fromName, address: MAIL_USERNAME },
        to: t.email,
        cc,
        subject,
        text,
      })
      console.log(`Emailed ${t.email} (cc ${cc.join(', ')}) re #${t.number}.`)
      // Only mark after a confirmed send so a failed send retries on re-run.
      await markNotified(owner, repo, t.number)
    } catch (err) {
      failures++
      console.error(`Failed to notify #${t.number} (${t.email}): ${err.message}`)
    }
  }

  if (failures > 0) {
    process.exit(1) // surface SMTP/permission problems as a failed run
  }
}

async function main() {
  if (testMode) {
    await runTest()
  } else {
    await runReal()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
