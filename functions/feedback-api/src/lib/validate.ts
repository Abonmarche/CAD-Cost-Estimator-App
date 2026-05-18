export type FeedbackType = 'bug' | 'enhancement'

export interface FeedbackInput {
  type: FeedbackType
  title: string
  description: string
  submitterName: string
  submitterEmail: string
}

export class ValidationError extends Error {
  constructor(
    public field: string,
    message: string,
  ) {
    super(message)
    this.name = 'ValidationError'
  }
}

const MAX_TITLE = 200
const MAX_DESCRIPTION = 10_000
const MAX_NAME = 200
const MAX_EMAIL = 320

export function validateFeedback(raw: unknown): FeedbackInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ValidationError('body', 'Request body must be a JSON object')
  }
  const body = raw as Record<string, unknown>

  const type = body.type
  if (type !== 'bug' && type !== 'enhancement') {
    throw new ValidationError('type', 'type must be "bug" or "enhancement"')
  }

  const title = requireString(body.title, 'title', MAX_TITLE)
  const description = requireString(body.description, 'description', MAX_DESCRIPTION)
  const submitterName = requireString(body.submitterName, 'submitterName', MAX_NAME)
  const submitterEmail = requireString(body.submitterEmail, 'submitterEmail', MAX_EMAIL)

  if (!isPlausibleEmail(submitterEmail)) {
    throw new ValidationError('submitterEmail', 'submitterEmail is not a valid email address')
  }

  return { type, title, description, submitterName, submitterEmail }
}

function requireString(value: unknown, field: string, maxLen: number): string {
  if (typeof value !== 'string') {
    throw new ValidationError(field, `${field} is required and must be a string`)
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new ValidationError(field, `${field} must not be empty`)
  }
  if (trimmed.length > maxLen) {
    throw new ValidationError(field, `${field} exceeds max length of ${maxLen}`)
  }
  return trimmed
}

function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}
