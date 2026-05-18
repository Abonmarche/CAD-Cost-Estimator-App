import type { IssuePayload } from './issue-body.js'

export interface CreatedIssue {
  number: number
  htmlUrl: string
}

// CUSTOMIZE: replace cost-estimator in the User-Agent with your project slug.
const USER_AGENT = 'cost-estimator-Feedback/1.0'

export async function createIssue(
  token: string,
  owner: string,
  repo: string,
  payload: IssuePayload,
): Promise<CreatedIssue> {
  const res = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
    {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify(payload),
    },
  )

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GitHub create-issue failed: ${res.status} ${body.slice(0, 300)}`)
  }

  const data = (await res.json()) as { number: number; html_url: string }
  return { number: data.number, htmlUrl: data.html_url }
}
