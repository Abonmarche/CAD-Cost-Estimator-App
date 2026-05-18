/**
 * Submit feedback to the feedback Function App.
 *
 * Called from the renderer over IPC. Auto-decorates the description with
 * desktop-context info that the web-app pattern doesn't have access to:
 * app version, AutoCAD connection status, OS user, Windows hostname.
 * Triage benefits from these even when the user forgets to mention them.
 */

import { app } from 'electron';
import { userInfo, hostname, platform, release } from 'node:os';

import type { FeedbackResult, FeedbackSubmission } from '@shared/types';

import { getApiToken } from './auth/tokens';
import { getServerStatus } from './tools/autocad/status';

function buildContextBlock(): string {
  let autocad = '_(not checked)_';
  try {
    const status = getServerStatus();
    autocad = status.connected
      ? `connected (${status.document ?? 'untitled'}, units: ${status.drawing_units ?? 'unknown'})`
      : `disconnected (${status.error ?? 'no AutoCAD instance found'})`;
  } catch (err) {
    autocad = `error (${(err as Error).message})`;
  }
  return [
    '---',
    '',
    '### Auto-attached context',
    `- App version: \`${app.getVersion()}\``,
    `- AutoCAD: ${autocad}`,
    `- OS: \`${platform()} ${release()}\``,
    `- User: \`${userInfo().username}@${hostname()}\``,
  ].join('\n');
}

export async function submitFeedback(
  submission: FeedbackSubmission,
): Promise<FeedbackResult> {
  const url = process.env.FEEDBACK_API_URL;
  if (!url) {
    return {
      ok: false,
      error: {
        code: 'server_misconfigured',
        message: 'FEEDBACK_API_URL is not baked into this build.',
      },
    };
  }

  let token: string;
  try {
    token = await getApiToken('feedback');
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'unauthorized',
        message: `Could not acquire feedback token: ${(err as Error).message}`,
      },
    };
  }

  const decorated: FeedbackSubmission = {
    ...submission,
    description: `${submission.description}\n\n${buildContextBlock()}`,
  };

  let res: Response;
  try {
    res = await fetch(`${url.replace(/\/+$/, '')}/api/submit-feedback`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(decorated),
    });
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'upstream_error',
        message: `Could not reach feedback API: ${(err as Error).message}`,
      },
    };
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return {
      ok: false,
      error: {
        code: 'unexpected_response',
        message: `HTTP ${res.status} with non-JSON body`,
      },
    };
  }
  return (await res.json()) as FeedbackResult;
}
