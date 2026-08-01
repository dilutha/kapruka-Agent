/**
 * Friendly error messages
 *
 * Single source of truth for turning a caught error (or an SSE `error`
 * event from the backend) into text that's safe to put in front of a user.
 * Nothing here ever returns a raw `error.message`, an HTTP status line, or a
 * backend exception's internal wording — those are for the console/logs.
 */

export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === 'AbortError';
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

function extractHttpStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const match = /HTTP (\d{3})/.exec(error.message);
  return match ? Number(match[1]) : null;
}

export function getFriendlyHttpMessage(status: number): string {
  switch (status) {
    case 429:
      return 'Too many requests — please wait a moment before trying again.';
    case 503:
      return 'The assistant is temporarily unavailable. Please try again shortly.';
    case 408:
    case 504:
      return 'The request timed out. Please try again.';
    case 404:
      return 'That chat could not be found — it may have been deleted.';
    case 403:
      return "You don't have access to this chat.";
    default:
      if (status >= 500) {
        return 'Something went wrong on our end. Please try again.';
      }
      return 'Something went wrong. Please try again.';
  }
}

/**
 * Maps a caught JS error (network failure, thrown `HTTP {status}` from
 * apiClient, a timed-out fetch) to friendly text. Never returns the raw
 * `error.message` — a `TypeError: Failed to fetch` or an internal backend
 * exception string must never reach the UI verbatim.
 */
export function getFriendlyErrorMessage(error: unknown): string {
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return 'Network error — please check your connection and try again.';
  }

  const status = extractHttpStatus(error);
  if (status !== null) return getFriendlyHttpMessage(status);

  return 'Something went wrong. Please try again.';
}

/**
 * Maps the backend's SSE `error` event to friendly text. `QUOTA_EXCEEDED`
 * is the one case where the backend's own message is trusted verbatim — it's
 * a specific, pre-crafted "try again in N seconds" string (see
 * GeminiQuotaExceededException / chat.service.ts), never raw exception text.
 * Every other code — including ones the frontend doesn't recognize yet —
 * collapses to one safe generic sentence.
 */
export function getFriendlySseErrorMessage(
  code: unknown,
  message: unknown,
): string {
  if (
    code === 'QUOTA_EXCEEDED' &&
    typeof message === 'string' &&
    message.trim().length > 0
  ) {
    return message;
  }

  return 'The assistant encountered an error. Please try again.';
}
