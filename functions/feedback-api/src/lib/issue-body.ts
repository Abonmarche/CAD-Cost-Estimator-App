import type { FeedbackInput } from './validate.js'
import type { Caller } from './client-principal.js'

export interface IssuePayload {
  title: string
  body: string
  labels: string[]
}

export function buildIssuePayload(input: FeedbackInput, caller: Caller): IssuePayload {
  const typeLabel = input.type === 'bug' ? 'bug' : 'enhancement'

  const body = [
    `**Submitted by:** ${input.submitterName} <${input.submitterEmail}>`,
    '',
    `**Type:** ${input.type === 'bug' ? 'Bug report' : 'Enhancement request'}`,
    '',
    `**Description**`,
    '',
    input.description,
    '',
    '---',
    '',
    `*Submitted via the in-app feedback form. Authenticated Entra ID object: \`${caller.oid}\`.*`,
  ].join('\n')

  return {
    title: input.title,
    body,
    labels: [typeLabel, 'user-reported'],
  }
}
