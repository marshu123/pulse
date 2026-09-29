import { ApiError, NetworkError, UnexpectedResponseError } from './api';

/**
 * Turn a thrown value into something worth reading.
 *
 * The three failure modes need different advice, so they must not collapse into
 * one message. A proxy login page, a CORS block and a dead backend all used to
 * report as "could not reach the API", which sent debugging in the wrong
 * direction.
 */
export function describeError(caught: unknown): string {
  if (caught instanceof ApiError) return caught.message;

  if (caught instanceof UnexpectedResponseError) {
    return `${caught.message} (body started: "${caught.bodyPreview}")`;
  }

  if (caught instanceof NetworkError) return caught.message;

  return 'Something went wrong. Please try again.';
}
