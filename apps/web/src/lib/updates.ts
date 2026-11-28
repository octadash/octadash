/**
 * Whether a newer Octadash exists, as owners and admins see it in the menu.
 * A release image (1.4.0) compares with the latest release; an `edge` image,
 * built from main, counts the commits main has after it.
 */
export type UpdateInfo = { kind: 'release'; latest: string } | { kind: 'edge'; behind: number }

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/

/** 1.10.0 is newer than 1.9.3; anything that is not plain x.y.z never is. */
export function isNewer(candidate: string, current: string): boolean {
  const a = SEMVER.exec(candidate)
  const b = SEMVER.exec(current)
  if (!a || !b) return false
  for (let i = 1; i <= 3; i++) {
    const diff = Number(a[i]) - Number(b[i])
    if (diff !== 0) return diff > 0
  }
  return false
}

export function isRelease(version: string): boolean {
  return SEMVER.test(version)
}

/** Where to read about it: the changelog on the site. */
export const CHANGELOG_URL = 'https://octadash.com/changelog/'
