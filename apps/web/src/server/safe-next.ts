/** Only same-site paths, so a crafted sign-in link cannot send people elsewhere. */
export function safeNext(value: unknown, fallback = '/all'): string {
  if (typeof value !== 'string') return fallback
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback
  return value
}
