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

/**
 * The version next to the name in the menu, like Coolify's "v4.7.9": a
 * release reads "v1.4.0"; an image built from main reads "edge · 4752944",
 * the commit it came from; a local build reads its version as it is.
 */
export function versionLabel(version: string, commit: string): string {
  const match = SEMVER.exec(version)
  if (match) return `v${match[1]}.${match[2]}.${match[3]}`
  const short = /^[0-9a-f]{7,40}$/.test(commit) ? commit.slice(0, 7) : ''
  return short ? `${version} · ${short}` : version
}

/** Where to read about it: the changelog on the site. */
export const CHANGELOG_URL = 'https://octadash.com/changelog/'
