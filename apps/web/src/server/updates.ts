import { OCTADASH_COMMIT, OCTADASH_VERSION } from '@octadash/core'
import { isNewer, isRelease, type UpdateInfo } from '@/lib/updates'
import { services } from './context'

const REPO = 'https://api.github.com/repos/octadash/octadash'
const DAY_MS = 86_400_000

let cached: { at: number; value: UpdateInfo | null } | undefined

async function github<T>(path: string): Promise<T | null> {
  const response = await fetch(`${REPO}${path}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'octadash-update-check' },
    signal: AbortSignal.timeout(5000),
    cache: 'no-store',
  })
  return response.ok ? ((await response.json()) as T) : null
}

async function ask(): Promise<UpdateInfo | null> {
  if (isRelease(OCTADASH_VERSION)) {
    const latest = await github<{ tag_name: string }>('/releases/latest')
    return latest && isNewer(latest.tag_name, OCTADASH_VERSION)
      ? { kind: 'release', latest: latest.tag_name.replace(/^v/, '') }
      : null
  }
  if (/^[0-9a-f]{40}$/.test(OCTADASH_COMMIT)) {
    const compare = await github<{ ahead_by: number }>(`/compare/${OCTADASH_COMMIT}...main`)
    return compare && compare.ahead_by > 0 ? { kind: 'edge', behind: compare.ahead_by } : null
  }
  // A local build: nothing to compare with.
  return null
}

let pending: Promise<void> | undefined

/**
 * The last answer, at once: the page never waits for GitHub. A stale or
 * missing answer starts one question in the background (at most once a day
 * per process); never when the install turned the check off.
 */
export function updateInfo(now = Date.now()): UpdateInfo | null {
  if (!services().env.OCTADASH_UPDATE_CHECK) return null
  if ((!cached || now - cached.at >= DAY_MS) && !pending) {
    pending = ask()
      .catch(() => cached?.value ?? null)
      .then((value) => {
        cached = { at: Date.now(), value }
      })
      .finally(() => {
        pending = undefined
      })
  }
  return cached?.value ?? null
}
