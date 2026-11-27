import { isRedirectError } from 'next/dist/client/components/redirect-error'

/** Pulls a human message out of a Better Auth APIError (or any error). */
export function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'body' in error) {
    const body = (error as { body?: { message?: string } }).body
    if (body?.message) return body.message
  }
  return fallback
}

/** Next.js implements redirect() by throwing; never swallow it. */
export function rethrowRedirect(error: unknown): void {
  if (isRedirectError(error)) throw error
}
